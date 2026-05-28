#!/usr/bin/env python3
"""Scrape UKGE's events catalogue into events.json.

The events listing at /events/ paginates 24 per page. We walk every page,
parse each card (id, title, category, day(s), time, subtitle, image), and
write a flat list to data-pipeline/events.json. build_data.py reads from
there and projects relevant categories into dashboard.json.

Card shape is stable enough that regex-per-card is more robust than a
depth-counting HTMLParser (which trips on void <img> and decorative <i>
elements). Concurrency is capped low (4) to be polite.
"""
import html as html_mod
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "events.json"

BASE = "https://www.ukgamesexpo.co.uk/events/"
UA = "Mozilla/5.0 (UKGE Companion build script; +https://github.com/Kieranties/ukge-companion)"


def fetch(url, retries=2):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            last_err = e
            time.sleep(0.5 * (attempt + 1))
    raise last_err


def total_pages(html):
    pages = [int(m) for m in re.findall(r"\?page=(\d+)", html)]
    return max(pages) if pages else 1


# ---- card extraction --------------------------------------------------------

CARD_OPEN = re.compile(r'<div class="card-event">')
HREF_DETAIL = re.compile(r'/events/(\d+)-([a-z0-9-]+)/')
BG_IMAGE = re.compile(r"url\(['\"]?([^'\")]+)['\"]?\)")
IMG_SRC = re.compile(r'<img[^>]*\bsrc="([^"]+)"', re.IGNORECASE)
TAG_RE = re.compile(r'<div class="card-event__tag">([^<]+)</div>')
TITLE_RE = re.compile(r'<h2 class="card-event__title">.*?<a [^>]*>([^<]+)</a>', re.DOTALL)
SUBTITLE_RE = re.compile(r'<div class="card-event__subtitle">(.*?)</div>', re.DOTALL)
PRICE_RE = re.compile(r'<div class="card-event__header-price">([^<]+)</div>')
STATS_BLOCK_RE = re.compile(r'<ul class="card-event__stats">(.*?)</ul>', re.DOTALL)
LI_RE = re.compile(r'<li[^>]*>(.*?)</li>', re.DOTALL)
DAY_WORDS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
TIME_RE = re.compile(r"\d{1,2}[:.]\d{2}(?:\s*[-–]\s*\d{1,2}[:.]\d{2})?")


def split_cards(html):
    """Yield raw HTML for each card-event block on the page.

    Cards are introduced by `<div class="card-event">`; one card ends where
    the next begins (or at the end of the document). That tolerance avoids
    having to balance every nested tag inside the card.
    """
    starts = [m.start() for m in CARD_OPEN.finditer(html)]
    if not starts:
        return
    starts.append(len(html))
    for i in range(len(starts) - 1):
        yield html[starts[i]:starts[i + 1]]


def strip_tags(s):
    s = re.sub(r"<[^>]+>", " ", s)
    return html_mod.unescape(re.sub(r"\s+", " ", s)).strip()


def parse_card(block):
    out = {
        "id": None, "slug": None, "url": None, "image": None,
        "title": None, "category": None, "price": None,
        "subtitle": None, "days": [], "time": None,
    }

    m = HREF_DETAIL.search(block)
    if not m:
        return None
    out["id"] = m.group(1)
    out["slug"] = m.group(2)
    out["url"] = f"/events/{m.group(1)}-{m.group(2)}/"

    bg = BG_IMAGE.search(block)
    if bg:
        out["image"] = bg.group(1)
    elif (img := IMG_SRC.search(block)):
        out["image"] = img.group(1)

    if (t := TAG_RE.search(block)):
        out["category"] = html_mod.unescape(t.group(1)).strip()
    if (h := TITLE_RE.search(block)):
        out["title"] = html_mod.unescape(h.group(1)).strip()
    if (s := SUBTITLE_RE.search(block)):
        out["subtitle"] = strip_tags(s.group(1)) or None
    if (p := PRICE_RE.search(block)):
        out["price"] = html_mod.unescape(p.group(1)).strip()

    if (stats := STATS_BLOCK_RE.search(block)):
        for li_m in LI_RE.finditer(stats.group(1)):
            val = strip_tags(li_m.group(1))
            # The sr-only span prefixes "Days: " / "Time: " — strip those
            val = re.sub(r"^(Days|Time|Day|Times)\s*:\s*", "", val, flags=re.IGNORECASE).strip()
            if not val:
                continue
            low = val.lower()
            if any(d in low for d in DAY_WORDS):
                # Multi-day events come through as "Friday 20:00 - Saturday 00:00".
                # Pull out the time first, then the bare day names.
                if (t := TIME_RE.search(val)):
                    out["time"] = out["time"] or t.group(0).strip()
                day_only = re.sub(r"\d{1,2}[:.]\d{2}", " ", val)
                day_only = re.sub(r"[-–]", " ", day_only)
                day_only = re.sub(r"\s+", " ", day_only).strip()
                days = [d.strip().title() for d in re.split(r"[,/&]| and | to ", day_only) if d.strip()]
                seen = set()
                for d in days:
                    # Only keep tokens that are actually day names
                    if d.lower() in DAY_WORDS and d not in seen:
                        seen.add(d)
                        out["days"].append(d)
            elif TIME_RE.search(val):
                out["time"] = val
    return out


def parse_page(html):
    out = []
    for block in split_cards(html):
        card = parse_card(block)
        if card and card["id"]:
            out.append(card)
    return out


# ---- entry ------------------------------------------------------------------

def main():
    print(f"fetching {BASE}?page=1 ...")
    first = fetch(BASE + "?page=1")
    n_pages = total_pages(first)
    print(f"  {n_pages} pages")

    pages = {1: first}
    if n_pages > 1:
        def fetch_page(n):
            return n, fetch(f"{BASE}?page={n}")
        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = [pool.submit(fetch_page, n) for n in range(2, n_pages + 1)]
            for fut in as_completed(futs):
                n, html = fut.result()
                pages[n] = html
                print(f"  page {n} ok")

    all_events = []
    for n in sorted(pages):
        events = parse_page(pages[n])
        all_events.extend(events)
        if n == 1:
            print(f"  page 1 -> {len(events)} events")

    seen = set()
    deduped = []
    for e in all_events:
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        deduped.append(e)

    print(f"\ntotal events: {len(deduped)}")
    by_cat = {}
    for e in deduped:
        by_cat[e["category"] or "(uncategorised)"] = by_cat.get(e["category"] or "(uncategorised)", 0) + 1
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {n:4d}  {cat}")

    OUT.write_text(json.dumps(deduped, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
