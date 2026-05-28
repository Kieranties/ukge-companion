#!/usr/bin/env python3
"""Build dashboard.json — the single source of truth Astro renders from.

Inputs (sibling files):
  kieranties_collection.json  BGG collection with publishers + categories + mechanics
  ukge_raw.html               Saved UKGE 2026 exhibitor listing HTML
  bgg_hotness.json            BGG hotness top ~50 with publishers
  awards.json                 Hand-curated award index by BGG ID

Output:
  ../web/src/data/dashboard.json
"""
import json
import math
import re
import html
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).parent
COLLECTION = ROOT / "kieranties_collection.json"
UKGE_HTML = ROOT / "ukge_raw.html"
HOTNESS = ROOT / "bgg_hotness.json"
HOT_DESCRIPTIONS = ROOT / "hot_descriptions.json"
AWARDS = ROOT / "awards.json"
EVENTS = ROOT / "events.json"
OUT = ROOT.parent / "web" / "src" / "data" / "dashboard.json"
EXHIBITOR_GAMES = ROOT.parent / "web" / "src" / "data" / "exhibitor_games.json"
BGG_USERNAME = "Kieranties"


# ---------- UKGE parser ----------------------------------------------------

class ExhibitorParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_card = False
        self.depth = 0
        self.card_html = []
        self.cards = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag == "a" and "group" in cls and "p-4" in cls:
            href = a.get("href", "")
            if "/whats-on/show/exhibitors/" in href:
                self.in_card = True
                self.depth = 1
                self.card_html = [(tag, a, "start")]
                return
        if self.in_card:
            self.card_html.append((tag, a, "start"))
            if tag in ("a",):
                self.depth += 1
            elif tag in ("div", "ul", "li", "h3", "p", "span", "svg", "button"):
                self.depth += 1

    def handle_endtag(self, tag):
        if not self.in_card:
            return
        self.card_html.append((tag, {}, "end"))
        if tag in ("a", "div", "ul", "li", "h3", "p", "span", "svg", "button"):
            self.depth -= 1
            if self.depth <= 0 and tag == "a":
                self.cards.append(self.card_html)
                self.in_card = False
                self.card_html = []

    def handle_data(self, data):
        if self.in_card:
            self.card_html.append(("__text__", {}, data))


def card_tokens(card):
    out = []
    buf = []
    for tag, attrs, mode in card:
        if tag == "__text__":
            buf.append(mode)
        elif mode == "start":
            text = "".join(buf).strip()
            if text:
                out.append(("text", text))
            buf = []
            out.append((tag, dict(attrs)))
        elif mode == "end":
            text = "".join(buf).strip()
            if text:
                out.append(("text", text))
            buf = []
            out.append(("/" + tag, {}))
    if buf:
        text = "".join(buf).strip()
        if text:
            out.append(("text", text))
    return out


def parse_card(card):
    tokens = card_tokens(card)
    href = next((a["href"] for t, a, m in card if t == "a" and m == "start" and a.get("href")), None)
    slug_m = re.search(r"/exhibitors/([^/?]+)", href or "")
    slug = slug_m.group(1) if slug_m else None
    logo = next((a["src"] for t, a in tokens if t == "img" and a.get("src")), None)

    name = None
    for i, (t, _) in enumerate(tokens):
        if t == "h3":
            for tt, aa in tokens[i + 1:]:
                if tt == "/h3":
                    break
                if tt == "text":
                    name = aa
                    break
            break

    hall = stand = None
    in_loc = False
    cur_span = None
    spans = []
    for t, a in tokens:
        if t == "div" and "text-gray-500" in (a.get("class") or "") and "text-sm" in (a.get("class") or ""):
            in_loc = True
            spans = []
            cur_span = None
            continue
        if in_loc and t == "/div":
            in_loc = False
            hall = spans[0] if spans else None
            stand = spans[1] if len(spans) > 1 else None
            continue
        if in_loc and t == "span":
            cur_span = []
        elif in_loc and t == "/span" and cur_span is not None:
            spans.append(" ".join(cur_span).strip())
            cur_span = None
        elif in_loc and t == "text" and cur_span is not None:
            cur_span.append(a)

    categories = []
    in_ul = False
    cur_li = None
    for t, a in tokens:
        if t == "ul":
            in_ul = True
        elif t == "/ul":
            in_ul = False
        elif in_ul and t == "li":
            cur_li = []
        elif in_ul and t == "/li" and cur_li is not None:
            categories.append(" ".join(cur_li).strip())
            cur_li = None
        elif in_ul and t == "text" and cur_li is not None:
            cur_li.append(a)

    description = None
    in_p = False
    p_text = []
    for t, a in tokens:
        if t == "p":
            in_p = True
            p_text = []
        elif t == "/p" and in_p:
            description = " ".join(p_text).strip() or None
            in_p = False
        elif in_p and t == "text":
            p_text.append(a)

    return {
        "slug": slug,
        "name": name,
        "hall": hall,
        "stand": stand,
        "categories": categories,
        "description": description,
        "logo": logo,
    }


def parse_exhibitors(text):
    p = ExhibitorParser()
    p.feed(text)
    # UKGE has a "map" link that the parser will pick up as an exhibitor card
    # because it sits under /whats-on/show/exhibitors/. Filter it out and any
    # other slug that doesn't represent a real booth.
    excluded_slugs = {"map", "list", "search"}
    cards = [parse_card(c) for c in p.cards]
    return [c for c in cards if c["slug"] and c["slug"] not in excluded_slugs and c["name"]]


# ---------- Publisher matching --------------------------------------------

STOPWORDS = {
    "games", "game", "publishing", "publishers", "ltd", "limited", "llc", "inc",
    "co", "corp", "corporation", "company", "studios", "studio", "press", "media",
    "books", "book", "the", "and", "&", "uk", "usa", "us", "&amp;",
    "edition", "editions", "international", "intl", "global", "group",
    "spol", "sro", "ag", "gmbh", "sa", "spa", "bv", "ab", "as",
    "republica", "republika", "cz", "polska",
}

REGION_SUFFIX = re.compile(r"\s*\((?:I+|UK|US|USA|EU|EN|FR|DE|UK & EU)\)\s*$", re.IGNORECASE)

JUNK_PUBLISHER_NAMES = {
    "(unknown)", "unknown", "(self-published)", "self-published",
    "(public domain)", "public domain",
}

GENERIC_SINGLE_TOKENS = {
    "smart", "lucky", "wild", "blue", "red", "green", "white", "black",
    "lion", "fox", "tiger", "bear", "wolf", "dragon", "cat", "dog",
    "fire", "ice", "happy", "great", "good", "big", "small", "new",
    "alley", "city", "river", "mountain", "star", "moon", "sun",
    "first", "next", "last", "true", "real",
}


def fold(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def tokens_of(s):
    if not s:
        return []
    s = html.unescape(s)
    s = fold(s)
    s = REGION_SUFFIX.sub("", s)
    s = re.sub(r"[^a-zA-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return [t for t in s.split() if t and t not in STOPWORDS]


def name_key(s):
    return " ".join(tokens_of(s))


def build_index(exhibitors):
    by_full = {}
    by_toks = []
    for e in exhibitors:
        if not e["name"]:
            continue
        full = name_key(e["name"])
        if full and full not in by_full:
            by_full[full] = e
        toks = set(tokens_of(e["name"]))
        if toks:
            by_toks.append((toks, e))
    return by_full, by_toks


def match_publisher(pub_name, by_full, by_toks):
    if not pub_name or pub_name.strip().lower() in JUNK_PUBLISHER_NAMES:
        return None, 0.0
    full = name_key(pub_name)
    if not full:
        return None, 0.0
    full_tokens = full.split()
    if full in by_full:
        if len(full_tokens) >= 2 or full_tokens[0] not in GENERIC_SINGLE_TOKENS:
            return by_full[full], 1.0
    pub_toks = set(full_tokens)
    if not pub_toks:
        return None, 0.0
    best = None
    best_score = 0.0
    for toks, e in by_toks:
        if not toks:
            continue
        inter = pub_toks & toks
        if not inter:
            continue
        jaccard = len(inter) / len(pub_toks | toks)
        contained = pub_toks <= toks or toks <= pub_toks
        accept = False
        if contained:
            if pub_toks <= toks and len(pub_toks) >= 2:
                accept = True
            elif toks <= pub_toks and len(toks) >= 2:
                accept = True
        if not accept and jaccard >= 0.6 and len(inter) >= 2:
            accept = True
        if not accept:
            continue
        score = 0.6 * jaccard + 0.4 * (1.0 if contained else 0.0)
        if score > best_score:
            best_score = score
            best = e
    if best_score >= 0.5:
        return best, best_score
    return None, 0.0


# ---------- Build ---------------------------------------------------------

BOARDGAME_CATS = {
    "Games Publisher", "Board Games", "Card Games", "Family Games",
    "Party Games", "Mass Market Games", "Roleplaying Card Games",
    "Solo Games", "Strategy Games", "Wargames", "Abstract Games",
    "Cooperative Games", "Family Friendly Games",
}


def best_award(awards_idx, bgg_id):
    awards = awards_idx.get(str(bgg_id), [])
    if not awards:
        return None
    priority = {
        ("Spiel des Jahres", "winner"): 0,
        ("Kennerspiel des Jahres", "winner"): 1,
        ("Spiel des Jahres", "nominee"): 2,
        ("Kennerspiel des Jahres", "nominee"): 3,
        ("Golden Geek", "winner"): 4,
        ("Spiel des Jahres", "recommended"): 5,
    }
    a = min(awards, key=lambda x: priority.get((x.get("award"), x.get("kind")), 99))
    return a


def main():
    collection = json.loads(COLLECTION.read_text(encoding="utf-8"))
    exhibitors = parse_exhibitors(UKGE_HTML.read_text(encoding="utf-8"))
    hotness = json.loads(HOTNESS.read_text(encoding="utf-8")) if HOTNESS.exists() else []
    hot_descs = {}
    if HOT_DESCRIPTIONS.exists():
        raw = json.loads(HOT_DESCRIPTIONS.read_text(encoding="utf-8"))
        # Strip HTML and decode entities; truncate to ~340 chars (ellipsis
        # in CSS handles the visual cap to 3-4 lines per card).
        for bgg_id, desc in raw.items():
            text = re.sub(r"<[^>]+>", "", desc)
            text = html.unescape(text)
            text = re.sub(r"\s+", " ", text).strip()
            if len(text) > 340:
                text = text[:340].rsplit(" ", 1)[0] + "…"
            hot_descs[bgg_id] = text
    awards_raw = json.loads(AWARDS.read_text(encoding="utf-8")) if AWARDS.exists() else {}
    awards_idx = {k: v for k, v in awards_raw.items() if not k.startswith("_")}
    ex_games_cache = {}
    if EXHIBITOR_GAMES.exists():
        ex_games_cache = json.loads(EXHIBITOR_GAMES.read_text(encoding="utf-8"))

    def ukge_games_for(slug):
        rec = ex_games_cache.get(slug) or {}
        return rec.get("games") or []

    # Decorate every exhibitor with its UKGE-listed games.
    for e in exhibitors:
        e["ukge_games"] = ukge_games_for(e["slug"])

    by_full, by_toks = build_index(exhibitors)

    # ---- Build the user's "taste signal" up front so both recommendations
    # and discovery can use it. cat_w/mech_w are play-weighted; the resulting
    # `tag_keywords` is a token set that represents the categories the user
    # tends to play. Recommendations blend a category-affinity bonus into the
    # ranking; Discovery uses the same set for token-overlap matching.
    cat_w, mech_w = {}, {}
    for g in collection:
        w = (g.get("plays") or 0) + 1
        for c in g.get("categories", []):
            cat_w[c] = cat_w.get(c, 0) + w
        for mc in g.get("mechanics", []):
            mech_w[mc] = mech_w.get(mc, 0) + w
    top_cats = sorted(cat_w.items(), key=lambda x: -x[1])[:8]
    top_mechs = sorted(mech_w.items(), key=lambda x: -x[1])[:8]
    tag_keywords = set()
    for c, _ in top_cats:
        tag_keywords |= set(tokens_of(c))
    for mc, _ in top_mechs:
        tag_keywords |= set(tokens_of(mc))
    tag_keywords -= STOPWORDS

    # Publisher rarity: how many of the user's games each publisher published.
    # A publisher behind 1 game is a more specific taste signal than one
    # behind 20 — score per matched game is divided by log2(n + 1) so big
    # generic publishers (Asmodee, Hasbro) don't drown out smaller indies.
    games_per_pub = {}
    for g in collection:
        seen_pubs = set()
        for p in g.get("publishers", []):
            name = p.get("name")
            if not name or name in seen_pubs:
                continue
            seen_pubs.add(name)
            games_per_pub[name] = games_per_pub.get(name, 0) + 1

    def pub_rarity(pub_name):
        n = games_per_pub.get(pub_name, 1)
        return 1.0 / math.log2(n + 1)

    # User's top-mechanic vocabulary, used to compute per-recommendation
    # mechanic overlap. Top N mechanics by play weight — match against the
    # mechanic list on each matched game (game-level signal, more specific
    # than the exhibitor-category overlap that already feeds cat_affinity).
    top_mech_names = {m for m, _ in top_mechs}

    # ---- Recommendations: match collection publishers to exhibitors
    matches = {}
    for g in collection:
        plays = g.get("plays") or 0
        game_mechs = g.get("mechanics") or []
        for pub in g.get("publishers", []):
            ex, score = match_publisher(pub["name"], by_full, by_toks)
            if not ex:
                continue
            m = matches.setdefault(ex["slug"], {
                "exhibitor": ex, "games": [], "total_plays": 0, "matched_pubs": set(),
                "matched_mechs": set(),
            })
            if any(x["game"]["bggId"] == g["bggId"] for x in m["games"]):
                continue
            game_award = best_award(awards_idx, g["bggId"])
            m["games"].append({
                "game": {
                    "bggId": g["bggId"], "name": g["name"], "year": g.get("year"),
                    "geekRating": g.get("geekRating"),
                    "award": game_award,
                },
                "publisher": pub["name"], "plays": plays, "score": score,
            })
            m["total_plays"] += plays
            m["matched_pubs"].add(pub["name"])
            for mech in game_mechs:
                if mech in top_mech_names:
                    m["matched_mechs"].add(mech)

    recommendations = []
    for slug, m in matches.items():
        m["matched_pubs"] = sorted(m["matched_pubs"])
        matched_mechs = sorted(m["matched_mechs"])
        m["games"].sort(key=lambda x: (-x["plays"], -x["score"]))
        # 1) Publisher contribution — play-weighted, but rarity-scaled so
        #    big generic publishers don't dominate.
        pub_score = 0.0
        for g in m["games"]:
            base = min(g["plays"], 25) + 1
            pub_score += base * pub_rarity(g["publisher"])
        # 2) Category affinity — overlap between the user's taste keywords
        #    and the exhibitor's category/description tokens. Same vocabulary
        #    Discovery uses; weighted lower than publisher matches so it
        #    boosts the ranking without overriding direct play data.
        ex_cat_tokens = set()
        for c in (m["exhibitor"].get("categories") or []):
            ex_cat_tokens |= set(tokens_of(c))
        desc_tokens = set(tokens_of(m["exhibitor"].get("description") or ""))
        cat_overlap = sorted((ex_cat_tokens | desc_tokens) & tag_keywords)
        cat_affinity = 3.0 * len(cat_overlap)
        # 3) Mechanic affinity — game-level overlap between the user's top
        #    mechanics and the matched games' mechanic lists. More specific
        #    than category (which is exhibitor-level) so weight slightly
        #    higher per match.
        mech_affinity = 4.0 * len(matched_mechs)
        # 4) On-topic guard — exhibitors that aren't tagged as a
        #    boardgame-relevant category get heavily penalised.
        ex_cats = set(m["exhibitor"].get("categories") or [])
        on_topic = (not ex_cats) or bool(ex_cats & BOARDGAME_CATS)
        raw = pub_score + cat_affinity + mech_affinity
        final = raw if on_topic else raw * 0.3
        recommendations.append({
            "exhibitor": m["exhibitor"],
            "games": m["games"],
            "matched_publishers": m["matched_pubs"],
            "matched_categories": cat_overlap,
            "matched_mechanics": matched_mechs,
            "total_plays": m["total_plays"],
            "publisher_score": round(pub_score, 1),
            "category_affinity": len(cat_overlap),
            "mechanic_affinity": len(matched_mechs),
            "raw_score": round(raw, 1),
            "score": round(final, 1),
            "on_topic": on_topic,
        })
    recommendations.sort(key=lambda r: (-r["score"], -len(r["games"]), r["exhibitor"]["name"].lower()))
    for i, r in enumerate(recommendations, 1):
        r["rank"] = i

    # ---- Discovery: top categories/mechanics × untouched exhibitors. Uses
    # the taste signal (top_cats / top_mechs / tag_keywords) computed above.
    matched_slugs = {r["exhibitor"]["slug"] for r in recommendations}
    PUB_CATS = {"Games Publisher", "Board Games", "Card Games", "Family Games", "Party Games"}
    discovery = []
    for e in exhibitors:
        if e["slug"] in matched_slugs:
            continue
        if not any(c in PUB_CATS for c in (e.get("categories") or [])):
            continue
        desc_t = set(tokens_of(e.get("description") or ""))
        cat_t = set()
        for c in (e.get("categories") or []):
            cat_t |= set(tokens_of(c))
        overlap = sorted((desc_t | cat_t) & tag_keywords)
        if len(overlap) < 2:
            continue
        discovery.append({
            "exhibitor": e, "matched_keywords": overlap, "score": len(overlap),
        })
    discovery.sort(key=lambda d: (-d["score"], d["exhibitor"]["name"].lower()))
    discovery = discovery[:40]
    for i, d in enumerate(discovery, 1):
        d["rank"] = i

    # ---- Hot games at the show
    owned_ids = {g["bggId"] for g in collection}
    hot_at_show = []
    for h in hotness:
        if h["bggId"] in owned_ids:
            continue
        matched_ex = []
        seen = set()
        for pub in h.get("publishers", []):
            ex, score = match_publisher(pub["name"], by_full, by_toks)
            if not ex or ex["slug"] in seen:
                continue
            seen.add(ex["slug"])
            matched_ex.append({"exhibitor": ex, "publisher": pub["name"], "score": score})
        if not matched_ex:
            continue
        award = best_award(awards_idx, h["bggId"])
        hot_at_show.append({
            "game": {
                "bggId": h["bggId"], "name": h["name"], "year": h.get("year"),
                "geekRating": h.get("geekRating"), "thumb": h.get("thumb"),
                "categories": h.get("categories", []),
                "description": hot_descs.get(h["bggId"]),
                "award": award,
            },
            "exhibitors": matched_ex[:5],
        })
    for i, h in enumerate(hot_at_show, 1):
        h["rank"] = i

    # ---- Events: load the scraped catalogue and best-effort link each event
    # to a known exhibitor by matching its title prefix to the exhibitor name
    # index. Titles often follow "<Publisher>: <event name>", so we feed the
    # full title through name_key — match_publisher already tolerates noise.
    events_raw = json.loads(EVENTS.read_text(encoding="utf-8")) if EVENTS.exists() else []
    day_order = {"Friday": 1, "Saturday": 2, "Sunday": 3}

    def time_sort_key(t):
        if not t:
            return (99, 99)
        m = re.search(r"(\d{1,2})[:.](\d{2})", t)
        if not m:
            return (99, 99)
        return (int(m.group(1)), int(m.group(2)))

    # Index exhibitors by hall+stand for verification of detail-page links.
    by_hall_stand = {}
    for ex in exhibitors:
        hall = (ex.get("hall") or "").strip()
        stand = (ex.get("stand") or "").strip()
        if hall and stand:
            # Hall on UKGE listings reads as "Hall 3"; detail page Stand
            # field uses "3-260". Normalise both to the bare hall number.
            hnum = re.sub(r"[^0-9A-Za-z]", "", hall).lower()
            hnum = re.sub(r"^hall", "", hnum)
            by_hall_stand[(hnum, stand)] = ex

    events = []
    for e in events_raw:
        title = e.get("title") or ""
        exhibitor_slug = None
        exhibitor_name = None
        link_source = None  # diagnostic: how we found it

        # 1) Strongest: detail-page Stand field, parsed into (name, hall, code).
        stand_name = e.get("stand_name")
        stand_hall = e.get("stand_hall")
        stand_code = e.get("stand_code")
        if stand_name:
            ex, _ = match_publisher(stand_name, by_full, by_toks)
            if ex:
                exhibitor_slug = ex["slug"]
                exhibitor_name = ex["name"]
                link_source = "stand_name"
        # 2) Fallback: hall + stand code direct lookup.
        if not exhibitor_slug and stand_hall and stand_code:
            ex = by_hall_stand.get((stand_hall.lower(), stand_code))
            if ex:
                exhibitor_slug = ex["slug"]
                exhibitor_name = ex["name"]
                link_source = "hall_stand"
        # 3) Last resort: fuzzy match on the event title (the old heuristic).
        if not exhibitor_slug:
            candidates = [title]
            if ":" in title:
                candidates.insert(0, title.split(":", 1)[0])
            for cand in candidates:
                ex, _ = match_publisher(cand, by_full, by_toks)
                if ex:
                    exhibitor_slug = ex["slug"]
                    exhibitor_name = ex["name"]
                    link_source = "title"
                    break

        days = e.get("days") or []
        events.append({
            "id": e.get("id"),
            "slug": e.get("slug"),
            "url": e.get("url"),
            "title": title,
            "category": e.get("category"),
            "event_type": e.get("event_type"),
            "subtitle": e.get("subtitle"),
            "description_full": e.get("description_full"),
            "price": e.get("price"),
            "image": e.get("image"),
            "days": days,
            "time": e.get("time"),
            "stand_label": e.get("stand_label"),
            "system": e.get("system"),
            "gm": e.get("gm"),
            "exhibitor_slug": exhibitor_slug,
            "exhibitor_name": exhibitor_name,
            "link_source": link_source,
            # Sort key: first day, then start time. Multi-day events
            # surface under their earliest day; the UI splits them across
            # day buckets at render time.
            "_sort_day": min((day_order.get(d, 9) for d in days), default=9),
            "_sort_time": time_sort_key(e.get("time")),
        })
    events.sort(key=lambda x: (x["_sort_day"], x["_sort_time"], x["title"].lower()))
    for e in events:
        del e["_sort_day"]
        del e["_sort_time"]

    # ---- Stats
    total_plays = sum(g.get("plays") or 0 for g in collection)
    matched_games_count = sum(1 for g in collection if any(
        r["exhibitor"]["slug"] in matched_slugs and any(
            x["game"]["bggId"] == g["bggId"] for x in r["games"]
        ) for r in recommendations
    ))
    # Simpler: how many of your games appear in any recommendation
    games_in_recs = set()
    for r in recommendations:
        for x in r["games"]:
            games_in_recs.add(x["game"]["bggId"])
    coverage = round(len(games_in_recs) / max(len(collection), 1) * 100)

    data = {
        "username": BGG_USERNAME,
        "generated_at_iso": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "stats": {
            "total_games": len(collection),
            "total_plays": total_plays,
            "total_exhibitors": len(exhibitors),
            "matched_exhibitors": len(recommendations),
            "coverage_pct": coverage,
            "hot_count": len(hot_at_show),
            "discovery_count": len(discovery),
            "events_count": len(events),
            "events_linked": sum(1 for e in events if e["exhibitor_slug"]),
        },
        "recommendations": recommendations,
        "discovery": discovery,
        "hot_at_show": hot_at_show,
        "events": events,
        "all_exhibitors": sorted(exhibitors, key=lambda x: (x.get("name") or "").lower()),
        "top_categories": [{"name": c, "weight": w} for c, w in top_cats],
        "top_mechanics": [{"name": m, "weight": w} for m, w in top_mechs],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    print(f"  {len(recommendations)} recommendations | {len(discovery)} discovery | {len(hot_at_show)} hot games | {len(events)} events ({sum(1 for e in events if e['exhibitor_slug'])} linked)")


if __name__ == "__main__":
    main()
