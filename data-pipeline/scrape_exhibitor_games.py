#!/usr/bin/env python3
"""Scrape each UKGE exhibitor page for its games list.

Caches to exhibitor_games.json so subsequent runs only fetch missing slugs.
Run after build_data.py — it reads dashboard.json to get the slug list,
fetches the per-exhibitor pages, and writes exhibitor_games.json into the
web data folder so the Astro build picks it up.

Concurrency is capped low (4) to be polite to UKGE's CDN.
"""
import html as html_mod
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).parent
WEB_DATA = ROOT.parent / "web" / "src" / "data"
CACHE = WEB_DATA / "exhibitor_games.json"
CACHE.parent.mkdir(parents=True, exist_ok=True)

BASE = "https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/"
UA = "Mozilla/5.0 (UKGE Companion build script; +https://github.com/Kieranties/ukge-companion)"


class GamesParser(HTMLParser):
    """
    Extracts <div class="media media--sm-break" id="new-game-N"> blocks.
    For each: pulls the <img src>, the inner <h2>, and the rich-text body
    (plain text). Stops capturing when depth returns to 0.
    """

    def __init__(self):
        super().__init__()
        self.in_block = False
        self.depth = 0
        self.current = None
        self.blocks = []
        # which sub-region we're currently capturing text from
        self.text_target = None
        self.text_buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        gid = a.get("id") or ""
        # Top-level entry
        if not self.in_block and tag == "div" and "media--sm-break" in cls and gid.startswith("new-game-"):
            self.in_block = True
            self.depth = 1
            self.current = {"ukge_game_id": gid.replace("new-game-", ""), "name": None, "image": None, "description": None}
            self.text_target = None
            return
        if not self.in_block:
            return
        # Track nesting depth so we know when to close
        if tag in ("div", "h1", "h2", "h3", "h4", "p", "span", "a", "i", "strong", "em", "ul", "li"):
            self.depth += 1
        if tag == "img" and not self.current.get("image"):
            src = a.get("src")
            if src:
                self.current["image"] = src
        if tag == "h2" and self.current.get("name") is None:
            self.text_target = "name"
            self.text_buf = []
        if tag == "div" and "rich-text" in cls and self.current.get("description") is None:
            self.text_target = "description"
            self.text_buf = []

    def handle_endtag(self, tag):
        if not self.in_block:
            return
        if tag in ("div", "h1", "h2", "h3", "h4", "p", "span", "a", "i", "strong", "em", "ul", "li"):
            self.depth -= 1
        if tag == "h2" and self.text_target == "name":
            self.current["name"] = " ".join(self.text_buf).strip()
            self.text_target = None
            self.text_buf = []
        if tag == "div" and self.text_target == "description":
            # The description div nests <p>s — keep capturing until its closing
            if self.depth <= 1:
                # actually inner divs/p have already closed; capture once outer rich-text div ends
                pass
        if self.depth <= 0:
            self.blocks.append(self.current)
            self.in_block = False
            self.current = None
            self.text_target = None
            self.text_buf = []

    def handle_data(self, data):
        if self.in_block and self.text_target:
            self.text_buf.append(data)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def parse_games(html_text):
    p = GamesParser()
    p.feed(html_text)
    out = []
    for b in p.blocks:
        if not b.get("name"):
            continue
        # Description capture above is imperfect (nested closes); fall back
        # to a single regex pull of the first .rich-text contents.
        out.append({
            "name": b["name"],
            "image": b.get("image"),
            "description": (b.get("description") or "")[:600] or None,
        })
    return out


# Fallback description extraction via regex — robust against nested tags.
DESC_RE = re.compile(
    r'id="new-game-(\d+)".*?<div class="rich-text">(.*?)</div>\s*</div>\s*</div>',
    re.DOTALL,
)
TAGS_RE = re.compile(r"<[^>]+>")


def regex_pull_descriptions(html_text):
    out = {}
    for m in DESC_RE.finditer(html_text):
        gid, inner = m.group(1), m.group(2)
        text = TAGS_RE.sub("", inner)
        text = html_mod.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out[gid] = text[:600]
    return out


def fetch_one(slug):
    url = f"{BASE}{slug}/"
    try:
        html = fetch(url)
    except Exception as e:
        return slug, [], str(e)
    p = GamesParser()
    p.feed(html)
    descs = regex_pull_descriptions(html)
    games = []
    for b in p.blocks:
        if not b.get("name"):
            continue
        gid = b.get("ukge_game_id")
        games.append({
            "name": b["name"],
            "image": b.get("image"),
            "description": descs.get(gid) if gid else None,
        })
    return slug, games, None


def main():
    if not (WEB_DATA / "dashboard.json").exists():
        print("dashboard.json not found — run build_data.py first", file=sys.stderr)
        sys.exit(1)
    dash = json.loads((WEB_DATA / "dashboard.json").read_text(encoding="utf-8"))

    # Gather every slug referenced by the dashboard.
    slugs = set()
    for r in dash["recommendations"]:
        slugs.add(r["exhibitor"]["slug"])
    for r in dash["discovery"]:
        slugs.add(r["exhibitor"]["slug"])
    for h in dash["hot_at_show"]:
        for me in h["exhibitors"]:
            slugs.add(me["exhibitor"]["slug"])
    for e in dash["all_exhibitors"]:
        slugs.add(e["slug"])
    slugs.discard(None)
    print(f"{len(slugs)} exhibitor pages to consider")

    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    to_fetch = [s for s in slugs if s not in cache]
    if not to_fetch:
        print("all slugs cached")
        return
    print(f"fetching {len(to_fetch)} new pages with concurrency 4")
    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(fetch_one, s): s for s in to_fetch}
        for fut in as_completed(futs):
            slug, games, err = fut.result()
            cache[slug] = {"games": games, "error": err}
            done += 1
            if done % 25 == 0 or done == len(to_fetch):
                rate = done / max(time.time() - t0, 1)
                print(f"  {done}/{len(to_fetch)} ({rate:.1f}/s)")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {CACHE} ({CACHE.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
