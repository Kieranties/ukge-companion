#!/usr/bin/env python3
"""Refresh kieranties_collection.json from BGG's XML API.

BGG recently put the XML API behind a Bearer token. The token is read
from the BGG_API_TOKEN env var. If it's not set (e.g. a contributor
running the build locally without one), this script exits 0 without
touching the committed JSON — the existing snapshot then feeds the
build as a fallback. That way CI without the secret still works, and
local dev doesn't need anyone to chase a token.

Run before build_data.py:
    BGG_API_TOKEN=xxx python fetch_collection.py
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).parent
OUT = ROOT / "kieranties_collection.json"
USERNAME = "Kieranties"

BASE = "https://boardgamegeek.com/xmlapi2"
UA = "Mozilla/5.0 (UKGE Companion build; +https://github.com/Kieranties/ukge-companion)"

# Polite parallelism for the per-game `thing` calls. BGG rate-limits;
# four-at-a-time keeps within their guidance.
THING_WORKERS = 4
# Collection often returns 202 (queued) on first call. Retry up to ~30s.
COLLECTION_MAX_RETRIES = 10
COLLECTION_RETRY_DELAY = 3


def need_token():
    tok = os.environ.get("BGG_API_TOKEN")
    if not tok:
        print("fetch_collection: BGG_API_TOKEN not set — skipping refresh, "
              "using committed kieranties_collection.json", file=sys.stderr)
        sys.exit(0)
    return tok


def fetch(url, token, max_retries=3):
    """GET with Bearer auth. Returns body bytes. Raises on failure."""
    last = None
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": UA,
            "Accept": "application/xml",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read(), resp.status
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                last = e
                time.sleep(2 ** attempt)
                continue
            raise
        except urllib.error.URLError as e:
            last = e
            time.sleep(2 ** attempt)
    raise last or RuntimeError(f"failed: {url}")


def fetch_collection(token):
    """Collection endpoint returns 202 while BGG queues the export. Poll."""
    url = f"{BASE}/collection?username={USERNAME}&own=1&stats=1&excludesubtype=boardgameexpansion"
    for attempt in range(COLLECTION_MAX_RETRIES):
        # We want the 202 distinction so we can retry — don't bubble it as error.
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": UA,
            "Accept": "application/xml",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            body = resp.read()
        if status == 200:
            return body
        if status == 202:
            print(f"fetch_collection: BGG queued the export (try {attempt+1}/{COLLECTION_MAX_RETRIES}), waiting {COLLECTION_RETRY_DELAY}s...", file=sys.stderr)
            time.sleep(COLLECTION_RETRY_DELAY)
            continue
        raise RuntimeError(f"unexpected status {status} from collection endpoint")
    raise RuntimeError("collection endpoint kept returning 202 — BGG too slow")


def parse_collection(body):
    """Return [{bggId, name, year, plays, geekRating, userRating}, ...]."""
    root = ET.fromstring(body)
    out = []
    for item in root.findall("item"):
        bgg_id = item.attrib.get("objectid")
        if not bgg_id:
            continue
        name_el = item.find("name")
        name = (name_el.text or "").strip() if name_el is not None else ""
        year_el = item.find("yearpublished")
        year = (year_el.text or "").strip() if year_el is not None else None
        plays_el = item.find("numplays")
        try:
            plays = int((plays_el.text or "0").strip()) if plays_el is not None else 0
        except ValueError:
            plays = 0
        stats = item.find("stats")
        geek_rating = None
        user_rating = None
        if stats is not None:
            rating = stats.find("rating")
            if rating is not None:
                # Geek rating sits under stats/rating/bayesaverage
                bayes = rating.find("bayesaverage")
                if bayes is not None and bayes.attrib.get("value") not in (None, "0", "N/A"):
                    try:
                        geek_rating = float(bayes.attrib["value"])
                    except ValueError:
                        pass
                ur_val = rating.attrib.get("value", "")
                if ur_val and ur_val != "N/A":
                    try:
                        user_rating = float(ur_val)
                    except ValueError:
                        pass
        out.append({
            "bggId": bgg_id,
            "name": name,
            "year": year,
            "plays": plays,
            "geekRating": geek_rating,
            "userRating": user_rating,
        })
    return out


def fetch_thing(bgg_id, token):
    """Per-game enrichment: publishers, categories, mechanics."""
    body, _ = fetch(f"{BASE}/thing?id={bgg_id}", token)
    root = ET.fromstring(body)
    item = root.find("item")
    if item is None:
        return {"publishers": [], "categories": [], "mechanics": []}
    publishers, categories, mechanics = [], [], []
    for link in item.findall("link"):
        t = link.attrib.get("type", "")
        v = (link.attrib.get("value") or "").strip()
        oid = link.attrib.get("id") or ""
        if not v:
            continue
        if t == "boardgamepublisher":
            publishers.append({"name": v, "objectid": oid})
        elif t == "boardgamecategory":
            categories.append(v)
        elif t == "boardgamemechanic":
            mechanics.append(v)
    return {"publishers": publishers, "categories": categories, "mechanics": mechanics}


def main():
    token = need_token()
    print(f"fetch_collection: pulling {USERNAME}'s collection from BGG...", file=sys.stderr)
    body = fetch_collection(token)
    base_items = parse_collection(body)
    print(f"fetch_collection: {len(base_items)} games owned", file=sys.stderr)

    # Reuse existing enrichment where the BGG id hasn't changed — BGG game
    # metadata is effectively static, and reusing keeps the diff small + the
    # API hits low. Only NEW IDs need a /thing call.
    existing = {}
    if OUT.exists():
        try:
            for row in json.loads(OUT.read_text()):
                if "bggId" in row:
                    existing[row["bggId"]] = row
        except (json.JSONDecodeError, OSError):
            pass

    to_enrich = [g["bggId"] for g in base_items if g["bggId"] not in existing]
    print(f"fetch_collection: {len(to_enrich)} new IDs to enrich via /thing", file=sys.stderr)

    enriched = {}
    if to_enrich:
        with ThreadPoolExecutor(max_workers=THING_WORKERS) as pool:
            futures = {pool.submit(fetch_thing, gid, token): gid for gid in to_enrich}
            for fut in as_completed(futures):
                gid = futures[fut]
                try:
                    enriched[gid] = fut.result()
                except Exception as e:
                    print(f"  warn: thing/{gid} failed: {e}", file=sys.stderr)
                    enriched[gid] = {"publishers": [], "categories": [], "mechanics": []}

    out = []
    for g in base_items:
        extra = enriched.get(g["bggId"])
        if extra is None:
            existing_row = existing.get(g["bggId"], {})
            extra = {
                "publishers": existing_row.get("publishers", []),
                "categories": existing_row.get("categories", []),
                "mechanics": existing_row.get("mechanics", []),
            }
        out.append({**g, **extra})

    OUT.write_text(json.dumps(out, ensure_ascii=False))
    print(f"fetch_collection: wrote {len(out)} games -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
