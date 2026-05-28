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

# Some categories aren't included in the unfiltered /events/ listing — the
# big ones being Demo-on-stand (~335) and Presentation-on-stand (~44), which
# are the events most likely to carry a structured Stand field. We walk them
# explicitly and union by event id so nothing gets counted twice.
EXTRA_CATEGORIES = [
    (5, "Demo-on-stand"),
    (10, "Presentation-on-stand"),
]


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


# ---- detail-page enrichment -------------------------------------------------

META_HEADER_RE = re.compile(r'<div class="meta-box__header">\s*([^<]+)</div>')
META_ITEM_RE = re.compile(
    r'<div class="meta-item__title">\s*([^<]+?)\s*</div>\s*'
    r'<div class="meta-item__content">(.*?)</div>',
    re.DOTALL,
)
DESC_RE = re.compile(
    r'<div class="product__description rich-text">\s*<h2[^>]*>Description</h2>\s*<div class="rich-text">(.*?)</div>\s*</div>',
    re.DOTALL,
)
# Stand field comes in as "Mind Burp Games (3-260)" for exhibitor events.
# Capture name and hall-stand separately.
STAND_RE = re.compile(r"^(.+?)\s*\((\d+[A-Za-z]?)\s*-\s*([^)]+)\)\s*$")


def parse_detail(html):
    """Pull the meta-box fields and a long description out of an event detail
    page. Returns a dict suitable for merging into the listing card.
    """
    out = {
        "event_type": None,       # "Exhibitor Event" / "Workshops" / etc — the meta-box header
        "stand_name": None,       # Exhibitor name as written on the detail page
        "stand_hall": None,       # e.g. "3"
        "stand_code": None,       # e.g. "260"
        "stand_label": None,      # raw "Mind Burp Games (3-260)" / "Hilton - Churchill room"
        "system": None,           # RPG system, if any
        "gm": None,
        "description_full": None,
        "extra_meta": {},         # any meta-item titles we don't recognise
    }
    if (h := META_HEADER_RE.search(html)):
        out["event_type"] = html_mod.unescape(h.group(1)).strip()
    for m in META_ITEM_RE.finditer(html):
        title = m.group(1).strip()
        content = strip_tags(m.group(2))
        if not content:
            continue
        key = title.lower()
        if key == "stand":
            out["stand_label"] = content
            if (sm := STAND_RE.match(content)):
                out["stand_name"] = sm.group(1).strip()
                out["stand_hall"] = sm.group(2).strip()
                out["stand_code"] = sm.group(3).strip()
        elif key == "system":
            out["system"] = content
        elif key == "gm":
            out["gm"] = content
        elif key in ("days", "time"):
            # Already on the listing card — skip
            continue
        else:
            out["extra_meta"][title] = content
    if (d := DESC_RE.search(html)):
        text = strip_tags(d.group(1))
        # Cap at a sensible length; CSS handles overflow ellipsis elsewhere.
        if len(text) > 1200:
            text = text[:1200].rsplit(" ", 1)[0] + "…"
        out["description_full"] = text or None
    return out


def fetch_detail(event_id, slug):
    url = f"https://www.ukgamesexpo.co.uk/events/{event_id}-{slug}/"
    return parse_detail(fetch(url))


def enrich_events(events, max_workers=4):
    """Walk every event and merge in detail-page fields. Polite concurrency.

    A partial failure on a single event isn't fatal — that event keeps its
    listing-page fields and gets no detail enrichment.
    """
    total = len(events)
    done = 0
    errs = 0

    def task(ev):
        try:
            return ev["id"], fetch_detail(ev["id"], ev["slug"]), None
        except Exception as e:
            return ev["id"], None, e

    enriched_by_id = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = [pool.submit(task, ev) for ev in events]
        for fut in as_completed(futs):
            eid, detail, err = fut.result()
            done += 1
            if err:
                errs += 1
                print(f"  [{done:3d}/{total}] {eid}: ERROR {err}")
            else:
                enriched_by_id[eid] = detail
            if done % 25 == 0:
                print(f"  [{done:3d}/{total}] ok ({errs} errors)")

    for ev in events:
        d = enriched_by_id.get(ev["id"])
        if d:
            ev.update(d)
    print(f"detail fetch: {done - errs}/{total} ok, {errs} errors")
    return events


# ---- entry ------------------------------------------------------------------

def fetch_all_pages(url_template, label):
    """Walk every page for a single events listing URL.

    `url_template` must contain a {page} placeholder.
    """
    print(f"fetching {label} ...")
    first = fetch(url_template.format(page=1))
    n_pages = total_pages(first)
    print(f"  {n_pages} pages")
    pages = {1: first}
    if n_pages > 1:
        def fetch_page(n):
            return n, fetch(url_template.format(page=n))
        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = [pool.submit(fetch_page, n) for n in range(2, n_pages + 1)]
            for fut in as_completed(futs):
                n, html = fut.result()
                pages[n] = html
    events = []
    for n in sorted(pages):
        events.extend(parse_page(pages[n]))
    return events


def main():
    sources = [(BASE + "?page={page}", "global /events/")]
    for cid, name in EXTRA_CATEGORIES:
        sources.append((f"{BASE}?page={{page}}&category={cid}", f"category={cid} ({name})"))

    all_events = []
    for tmpl, label in sources:
        events = fetch_all_pages(tmpl, label)
        print(f"  {label}: {len(events)} events")
        all_events.extend(events)

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

    print(f"\nfetching detail pages for {len(deduped)} events ...")
    enrich_events(deduped)

    stand_events = sum(1 for e in deduped if e.get("stand_name"))
    print(f"  events with structured Stand field: {stand_events}/{len(deduped)}")

    OUT.write_text(json.dumps(deduped, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
