#!/usr/bin/env python3
"""Resolve BGG ids for every game on every UKGE vendor's listing.

Writes the bggId in-place onto each entry of exhibitor_games.json so the
UkgeGames component can render direct BGG links instead of search URLs.

Behaviour:
  - Entries already carrying a `bggId` key are skipped (cached). That
    includes `bggId: null` — once we've confirmed a name has no BGG
    match, we don't re-search every build.
  - BGG_API_TOKEN env var required (Bearer token on /xmlapi2/search).
    Unset → exit 0 without modifying the file (CI without the secret
    still works, local dev keeps using the committed cache).
  - Search strategy: exact match first (single result wins), then a
    non-exact search with the cleaned-up name. Records the first match.
    We don't try to disambiguate (e.g. several editions of the same
    game) — for UKGE chips a direct link to any edition is fine.

This script is idempotent: running it twice in a row is a no-op after
the first run cached the lookups.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).parent
CACHE = ROOT.parent / "web" / "src" / "data" / "exhibitor_games.json"
BASE = "https://boardgamegeek.com/xmlapi2"
UA = "Mozilla/5.0 (UKGE Companion build; +https://github.com/Kieranties/ukge-companion)"
WORKERS = 4
RETRYABLE = {429, 500, 502, 503, 504}


def need_token():
    tok = os.environ.get("BGG_API_TOKEN")
    if not tok:
        print("enrich_exhibitor_games: BGG_API_TOKEN not set — skipping enrichment, "
              "using committed exhibitor_games.json", file=sys.stderr)
        sys.exit(0)
    return tok


def fetch(url, token, max_retries=3):
    last = None
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": UA,
            "Accept": "application/xml",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code in RETRYABLE:
                last = e
                time.sleep(2 ** attempt)
                continue
            raise
        except urllib.error.URLError as e:
            last = e
            time.sleep(2 ** attempt)
    raise last or RuntimeError(f"failed: {url}")


_CLEAN_RE = re.compile(r"[^\w\s&]+", re.UNICODE)


def clean(name):
    """Strip punctuation, collapse whitespace. Helps with names like
    'All's Well That Ends' where the apostrophe varies between sources."""
    s = _CLEAN_RE.sub(" ", name).strip()
    return re.sub(r"\s+", " ", s)


def search_one(name, token):
    """Returns BGG objectid (str) or None."""
    if not name or not name.strip():
        return None
    encoded = urllib.parse.quote(name.strip())
    try:
        body = fetch(f"{BASE}/search?query={encoded}&type=boardgame&exact=1", token)
        root = ET.fromstring(body)
        items = root.findall("item")
        if len(items) >= 1:
            return items[0].attrib.get("id")
    except Exception as e:
        print(f"  warn: exact search failed for {name!r}: {e}", file=sys.stderr)
        return None
    # Fall back to a non-exact search on a cleaned name and pick the top match.
    cleaned = clean(name)
    if not cleaned:
        return None
    encoded = urllib.parse.quote(cleaned)
    try:
        body = fetch(f"{BASE}/search?query={encoded}&type=boardgame", token)
        root = ET.fromstring(body)
        items = root.findall("item")
        if items:
            return items[0].attrib.get("id")
    except Exception as e:
        print(f"  warn: fuzzy search failed for {name!r}: {e}", file=sys.stderr)
    return None


def main():
    token = need_token()
    if not CACHE.exists():
        print("enrich_exhibitor_games: no exhibitor_games.json — nothing to enrich", file=sys.stderr)
        sys.exit(0)
    data = json.loads(CACHE.read_text(encoding="utf-8"))

    # Collect every game entry that doesn't yet have a bggId key.
    pending = []  # (vendor_slug, idx_in_games, name)
    for vendor_slug, vendor in data.items():
        games = (vendor or {}).get("games") or []
        for i, g in enumerate(games):
            if not isinstance(g, dict):
                continue
            if "bggId" in g:
                continue
            name = (g.get("name") or "").strip()
            if not name:
                # Mark so we don't keep checking.
                g["bggId"] = None
                continue
            pending.append((vendor_slug, i, name))

    print(f"enrich_exhibitor_games: {len(pending)} games need BGG lookup", file=sys.stderr)
    if not pending:
        return

    # De-dupe by name so identical titles across vendors only cost one
    # BGG call. Cache the first lookup, then back-fill every occurrence.
    name_to_id = {}
    unique_names = sorted({n for _, _, n in pending})
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(search_one, n, token): n for n in unique_names}
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                name_to_id[name] = fut.result()
            except Exception as e:
                print(f"  warn: {name!r}: {e}", file=sys.stderr)
                name_to_id[name] = None
            done += 1
            if done % 50 == 0 or done == len(unique_names):
                hits = sum(1 for v in name_to_id.values() if v)
                print(f"  {done}/{len(unique_names)} resolved ({hits} hits)", file=sys.stderr)

    for vendor_slug, idx, name in pending:
        bgg_id = name_to_id.get(name)
        data[vendor_slug]["games"][idx]["bggId"] = bgg_id

    CACHE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    hits = sum(1 for v in name_to_id.values() if v)
    print(f"enrich_exhibitor_games: resolved {hits}/{len(unique_names)} unique names -> {CACHE}", file=sys.stderr)


if __name__ == "__main__":
    main()
