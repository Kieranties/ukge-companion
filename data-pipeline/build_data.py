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
import re
import html
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).parent
COLLECTION = ROOT / "kieranties_collection.json"
UKGE_HTML = ROOT / "ukge_raw.html"
HOTNESS = ROOT / "bgg_hotness.json"
AWARDS = ROOT / "awards.json"
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
    return [parse_card(c) for c in p.cards]


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

    # ---- Recommendations: match collection publishers to exhibitors
    matches = {}
    for g in collection:
        plays = g.get("plays") or 0
        for pub in g.get("publishers", []):
            ex, score = match_publisher(pub["name"], by_full, by_toks)
            if not ex:
                continue
            m = matches.setdefault(ex["slug"], {
                "exhibitor": ex, "games": [], "total_plays": 0, "matched_pubs": set(),
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

    recommendations = []
    for slug, m in matches.items():
        m["matched_pubs"] = sorted(m["matched_pubs"])
        m["games"].sort(key=lambda x: (-x["plays"], -x["score"]))
        raw = sum(min(g["plays"], 25) + 1 for g in m["games"])
        ex_cats = set(m["exhibitor"].get("categories") or [])
        on_topic = (not ex_cats) or bool(ex_cats & BOARDGAME_CATS)
        recommendations.append({
            "exhibitor": m["exhibitor"],
            "games": m["games"],
            "matched_publishers": m["matched_pubs"],
            "total_plays": m["total_plays"],
            "raw_score": raw,
            "score": raw if on_topic else round(raw * 0.3),
            "on_topic": on_topic,
        })
    recommendations.sort(key=lambda r: (-r["score"], -len(r["games"]), r["exhibitor"]["name"].lower()))
    for i, r in enumerate(recommendations, 1):
        r["rank"] = i

    # ---- Discovery: top categories/mechanics × untouched exhibitors
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
                "award": award,
            },
            "exhibitors": matched_ex[:5],
        })
    for i, h in enumerate(hot_at_show, 1):
        h["rank"] = i

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
        },
        "recommendations": recommendations,
        "discovery": discovery,
        "hot_at_show": hot_at_show,
        "all_exhibitors": sorted(exhibitors, key=lambda x: (x.get("name") or "").lower()),
        "top_categories": [{"name": c, "weight": w} for c, w in top_cats],
        "top_mechanics": [{"name": m, "weight": w} for m, w in top_mechs],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    print(f"  {len(recommendations)} recommendations · {len(discovery)} discovery · {len(hot_at_show)} hot games")


if __name__ == "__main__":
    main()
