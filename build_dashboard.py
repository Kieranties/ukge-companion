#!/usr/bin/env python3
"""Build UKGE 2026 dashboard for Kieranties."""
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
OUTPUT = ROOT / "index.html"
SW_OUTPUT = ROOT / "sw.js"
BGG_USERNAME = "Kieranties"


# ---------------------------------------------------------------------------
# Parse UKGE exhibitor cards. The page uses a flat Tailwind structure; each
# exhibitor is an <a class="group flex flex-col p-4 ..."> ... </a> block.
# ---------------------------------------------------------------------------

class ExhibitorParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_card = False
        self.depth = 0
        self.card_html = []
        self.cards = []

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag == "a" and "group" in (attrs_d.get("class") or "") and "p-4" in (attrs_d.get("class") or ""):
            href = attrs_d.get("href", "")
            if "/whats-on/show/exhibitors/" in href:
                self.in_card = True
                self.depth = 1
                self.card_html = [(tag, attrs_d, "start")]
                return
        if self.in_card:
            self.card_html.append((tag, attrs_d, "start"))
            if tag in ("a",):
                self.depth += 1
            elif tag in ("div", "ul", "li", "h3", "p", "span", "img", "svg", "path", "button"):
                if tag not in ("img", "br", "hr", "path"):
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


def card_text(card):
    """Reconstruct a card's nested text blocks keyed by structural position."""
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
    text = "".join(buf).strip()
    if text:
        out.append(("text", text))
    return out


def parse_exhibitor_card(card):
    href = None
    for tag, attrs, mode in card:
        if tag == "a" and mode == "start" and attrs.get("href"):
            href = attrs["href"]
            break
    slug_m = re.search(r"/exhibitors/([^/?]+)", href or "")
    slug = slug_m.group(1) if slug_m else None

    tokens = card_text(card)

    # First <img> in the card (if present) is the exhibitor logo.
    logo = None
    for t, a in tokens:
        if t == "img" and a.get("src"):
            logo = a["src"]
            break

    # Find h3 contents = name
    name = None
    for i, (t, _) in enumerate(tokens):
        if t == "h3":
            j = i + 1
            while j < len(tokens) and tokens[j][0] != "/h3":
                if tokens[j][0] == "text":
                    name = tokens[j][1]
                    break
                j += 1
            break

    # Find location div (text-sm text-center text-gray-500) — first <span> is hall, second is stand
    hall = stand = None
    in_loc = False
    spans = []
    for t, a in tokens:
        if t == "div" and "text-gray-500" in (a.get("class") or "") and "text-sm" in (a.get("class") or ""):
            in_loc = True
            continue
        if in_loc and t == "/div":
            break
        if in_loc and t == "span":
            spans.append(None)
        if in_loc and t == "text" and spans:
            if spans[-1] is None:
                spans[-1] = a if False else t  # placeholder
        if in_loc and t == "text":
            # capture latest span text
            if spans and spans[-1] is None:
                spans[-1] = a if False else None
    # Simpler: collect spans by walking tokens with state
    hall, stand = None, None
    in_loc = False
    cur_span = None
    span_texts = []
    for t, a in tokens:
        if t == "div" and "text-gray-500" in (a.get("class") or "") and "text-sm" in (a.get("class") or ""):
            in_loc = True
            cur_span = None
            span_texts = []
            continue
        if in_loc and t == "/div":
            in_loc = False
            if len(span_texts) >= 1:
                hall = span_texts[0]
            if len(span_texts) >= 2:
                stand = span_texts[1]
            continue
        if in_loc and t == "span":
            cur_span = []
        elif in_loc and t == "/span" and cur_span is not None:
            span_texts.append(" ".join(cur_span).strip())
            cur_span = None
        elif in_loc and t == "text" and cur_span is not None:
            cur_span.append(a)

    # Categories: <ul> ... <li>cat</li> ...
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

    # Description: <p> ... </p>
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


def parse_exhibitors(html_text):
    p = ExhibitorParser()
    p.feed(html_text)
    return [parse_exhibitor_card(c) for c in p.cards]


# ---------------------------------------------------------------------------
# Publisher / exhibitor name normalisation. Many publishers have suffixes like
# "Games", "Ltd", parenthetical region codes (II), or accents — we strip these
# down to a comparable form.
# ---------------------------------------------------------------------------

STOPWORDS = {
    "games", "game", "publishing", "publishers", "ltd", "limited", "llc", "inc",
    "co", "corp", "corporation", "company", "studios", "studio", "press", "media",
    "books", "book", "the", "and", "&", "uk", "usa", "us", "&amp;",
    "edition", "editions", "international", "intl", "global", "group",
    "spol", "sro", "ag", "gmbh", "sa", "spa", "bv", "ab", "as",
    "republica", "republika", "cz", "polska",
}

# BGG disambiguators like "(II)" and explicit region tags.
REGION_SUFFIX = re.compile(r"\s*\((?:I+|UK|US|USA|EU|EN|FR|DE|UK & EU)\)\s*$", re.IGNORECASE)

# Drop these publisher records entirely — they are BGG placeholders, not real
# publishers, and tokenise to common English words that produce false matches.
JUNK_PUBLISHER_NAMES = {
    "(unknown)", "unknown", "(self-published)", "self-published",
    "(public domain)", "public domain",
}

# Common English adjective/noun tokens that frequently appear in unrelated
# publisher names. Single-token equality matches on these are rejected to
# avoid e.g. "Smart Ltd" (Polish puzzle co) matching "Smart Games" (Belgian
# puzzle co), or "Lucky Duck Games" matching "Lucky Star".
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
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s


def normalize_name(s):
    if not s:
        return ""
    s = html.unescape(s)
    s = fold(s)
    s = REGION_SUFFIX.sub("", s)
    s = re.sub(r"[^a-zA-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def tokens_of(s):
    return [t for t in normalize_name(s).split() if t and t not in STOPWORDS]


def name_key(s):
    return " ".join(tokens_of(s))


# ---------------------------------------------------------------------------
# Match collection publishers to UKGE exhibitors.
# ---------------------------------------------------------------------------

def build_exhibitor_index(exhibitors):
    """Return dicts that let us match a publisher name several ways."""
    by_full_key = {}
    by_token_set = []  # list of (set, exhibitor)
    for e in exhibitors:
        if not e["name"]:
            continue
        full = name_key(e["name"])
        if full and full not in by_full_key:
            by_full_key[full] = e
        toks = set(tokens_of(e["name"]))
        if toks:
            by_token_set.append((toks, e))
    return by_full_key, by_token_set


def match_publisher(pub_name, by_full_key, by_token_set):
    """
    Match a BGG publisher name to a UKGE exhibitor.

    Rules (tightened to avoid common-word collisions like "Smart Ltd" vs
    "Smart Games"):

      * Exact key match accepts only when the (stopword-stripped) key has
        at least 2 tokens. Single-token keys are too prone to false hits
        on common adjectives.
      * Fuzzy fallback requires either a strict subset relationship with
        >= 2 tokens on the contained side, OR a Jaccard >= 0.6 with >= 2
        shared tokens.

    The trade-off: legit short names like "IELLO" / "KOSMOS" still match
    via the single-token equality path only when at least one side has 2+
    distinct tokens, which most genuine UKGE exhibitors do (they list the
    parent company plus a region or trading suffix).
    """
    if not pub_name:
        return None, 0.0
    if pub_name.strip().lower() in JUNK_PUBLISHER_NAMES:
        return None, 0.0
    full = name_key(pub_name)
    if not full:
        return None, 0.0
    full_tokens = full.split()
    if full in by_full_key:
        # Accept single-token equality only when the token isn't a generic
        # English word that frequently collides across unrelated publishers.
        if len(full_tokens) >= 2 or full_tokens[0] not in GENERIC_SINGLE_TOKENS:
            return by_full_key[full], 1.0
    pub_toks = set(full_tokens)
    if not pub_toks:
        return None, 0.0
    best = None
    best_score = 0.0
    for toks, e in by_token_set:
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


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    collection = json.loads(COLLECTION.read_text(encoding="utf-8"))
    print(f"loaded {len(collection)} games")

    ukge_html = UKGE_HTML.read_text(encoding="utf-8")
    exhibitors = parse_exhibitors(ukge_html)
    print(f"parsed {len(exhibitors)} exhibitors")

    by_full, by_toks = build_exhibitor_index(exhibitors)

    # Each game contributes its plays to whichever publishers map to exhibitors.
    # Use a small floor of plays so unplayed-but-owned games still register.
    matches = {}  # exhibitor slug -> {exhibitor, games: [{game, publisher, plays, score}]}
    unmatched_publishers = []

    for g in collection:
        plays = g.get("plays") or 0
        for pub in g.get("publishers", []):
            ex, score = match_publisher(pub["name"], by_full, by_toks)
            if not ex:
                continue
            entry = matches.setdefault(
                ex["slug"],
                {"exhibitor": ex, "games": [], "total_plays": 0, "play_weighted": 0.0, "matched_pubs": set()},
            )
            already = next((x for x in entry["games"] if x["game"]["bggId"] == g["bggId"]), None)
            if already:
                if score > already["score"]:
                    already["score"] = score
                    already["publisher"] = pub["name"]
                continue
            entry["games"].append({"game": g, "publisher": pub["name"], "plays": plays, "score": score})
            entry["total_plays"] += plays
            entry["play_weighted"] += (plays + 1)  # +1 floor so owned-but-unplayed counts
            entry["matched_pubs"].add(pub["name"])

    # Build ranked list. Exhibitors whose UKGE categories are entirely
    # outside our board-game scope (e.g. Hobby Japan's UKGE booth is their
    # RPG arm, not the boardgame distributor we recognise from BGG) still
    # get listed but with their score discounted so they don't dominate.
    BOARDGAME_CATS = {
        "Games Publisher", "Board Games", "Card Games", "Family Games",
        "Party Games", "Mass Market Games", "Roleplaying Card Games",
        "Solo Games", "Strategy Games", "Wargames", "Abstract Games",
        "Cooperative Games", "Family Friendly Games",
    }
    ranked = []
    for slug, m in matches.items():
        m["matched_pubs"] = sorted(m["matched_pubs"])
        m["games"].sort(key=lambda x: (-x["plays"], -x["score"]))
        capped = sum(min(g["plays"], 25) + 1 for g in m["games"])
        ex_cats = set(m["exhibitor"].get("categories") or [])
        # Empty UKGE categories → unknown, don't penalise (Asmodee UK is the
        # canonical example: huge boardgame distributor but UKGE has tagged
        # them with no categories at all).
        on_topic = (not ex_cats) or bool(ex_cats & BOARDGAME_CATS)
        m["on_topic"] = on_topic
        m["raw_score"] = capped
        m["score"] = capped if on_topic else round(capped * 0.3)
        ranked.append(m)
    ranked.sort(key=lambda m: (-m["score"], -len(m["games"]), m["exhibitor"]["name"].lower()))

    # ----- Discovery: top categories/mechanics in user's most-played games,
    # then publishers at expo that share those tags but aren't already matched.
    matched_slugs = set(matches.keys())

    # Tally tags weighted by plays
    cat_weight = {}
    mech_weight = {}
    for g in collection:
        weight = (g.get("plays") or 0) + 1
        for c in g.get("categories", []):
            cat_weight[c] = cat_weight.get(c, 0) + weight
        for m in g.get("mechanics", []):
            mech_weight[m] = mech_weight.get(m, 0) + weight
    top_cats = sorted(cat_weight.items(), key=lambda x: -x[1])[:8]
    top_mechs = sorted(mech_weight.items(), key=lambda x: -x[1])[:8]

    # Build keyword set from top tags
    tag_keywords = set()
    for c, _ in top_cats:
        for t in tokens_of(c):
            tag_keywords.add(t)
    for m, _ in top_mechs:
        for t in tokens_of(m):
            tag_keywords.add(t)
    tag_keywords -= STOPWORDS

    PUBLISHER_CATEGORIES = {"Games Publisher", "Board Games", "Card Games", "Family Games", "Party Games"}
    discovery = []
    for e in exhibitors:
        if e["slug"] in matched_slugs:
            continue
        if not any(c in PUBLISHER_CATEGORIES for c in (e.get("categories") or [])):
            continue
        # Score by overlap with description keywords
        desc_tokens = set(tokens_of(e.get("description") or ""))
        cat_tokens = set()
        for c in (e.get("categories") or []):
            cat_tokens |= set(tokens_of(c))
        overlap = (desc_tokens | cat_tokens) & tag_keywords
        if len(overlap) < 2:
            continue
        discovery.append({"exhibitor": e, "matched_keywords": sorted(overlap), "score": len(overlap)})
    discovery.sort(key=lambda d: (-d["score"], d["exhibitor"]["name"].lower()))

    # ----- Hot games at the show: cross-reference BGG hotness with UKGE.
    hot_at_show = []
    if HOTNESS.exists():
        hotness = json.loads(HOTNESS.read_text(encoding="utf-8"))
        owned_ids = {g["bggId"] for g in collection}
        for h in hotness:
            if h["bggId"] in owned_ids:
                continue  # skip games user already owns
            matched_ex = []
            for pub in h.get("publishers", []):
                ex, score = match_publisher(pub["name"], by_full, by_toks)
                if ex:
                    matched_ex.append({"exhibitor": ex, "publisher": pub["name"], "score": score})
            # Deduplicate exhibitors
            seen = set()
            dedup = []
            for me in matched_ex:
                slug = me["exhibitor"]["slug"]
                if slug in seen:
                    continue
                seen.add(slug)
                dedup.append(me)
            if dedup:
                hot_at_show.append({"hot": h, "exhibitors": dedup})

    print(f"matched exhibitors: {len(ranked)}")
    print(f"discovery candidates: {len(discovery)}")
    print(f"hot games at show: {len(hot_at_show)}")

    build_html(ranked, discovery, collection, exhibitors, top_cats, top_mechs, hot_at_show)


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

def esc(s):
    if s is None:
        return ""
    return html.escape(str(s))


def render_logo(e):
    """Render an exhibitor logo or a coloured letter fallback."""
    logo = e.get("logo")
    name = e.get("name") or ""
    initial = (name.strip()[:1] or "?").upper()
    if logo:
        return f'<div class="ex-logo"><img src="{esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>'
    return f'<div class="ex-logo ex-logo-placeholder">{esc(initial)}</div>'


def render_game_chip(g):
    name = esc(g["game"]["name"])
    year = esc(g["game"]["year"] or "")
    plays = g["plays"]
    pub = esc(g["publisher"])
    rating = g["game"].get("geekRating")
    rating_s = f" · BGG {rating:.2f}" if rating else ""
    return (
        f'<li class="game-chip"><span class="g-name">{name}</span>'
        f'<span class="g-year"> ({year})</span>'
        f'<span class="g-plays" title="Plays">{plays}× plays</span>'
        f'<span class="g-pub" title="Publisher on BGG">via {pub}</span>'
        f'<span class="g-meta">{rating_s}</span></li>'
    )


def render_exhibitor_row(m, idx):
    e = m["exhibitor"]
    name = esc(e["name"])
    hall = esc(e.get("hall") or "")
    stand = esc(e.get("stand") or "")
    cats = " · ".join(esc(c) for c in (e.get("categories") or []))
    desc = esc(e.get("description") or "")
    slug = e["slug"]
    url = f"https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/{slug}/"
    games_html = "\n".join(render_game_chip(g) for g in m["games"])
    n_games = len(m["games"])
    total_plays = m["total_plays"]
    off_topic_badge = "" if m.get("on_topic", True) else (
        f'<span class="off-topic" title="UKGE categories don\'t include core board-game categories; this booth may be a different arm of the same publisher">tangential booth</span>'
    )
    # Aggregate a single haystack used by the global search. Includes
    # exhibitor name, categories, description, every matched game's name,
    # and every matched publisher's name — so a search for "wingspan" or
    # "stonemaier" both surface the right exhibitor.
    haystack_parts = [
        e["name"] or "",
        " ".join(e.get("categories") or []),
        e.get("description") or "",
        hall,
        stand,
    ]
    for g in m["games"]:
        haystack_parts.append(g["game"].get("name") or "")
        haystack_parts.append(g.get("publisher") or "")
    haystack = " ".join(haystack_parts).lower()
    data_attrs = (
        f'data-slug="{esc(slug)}" '
        f'data-name="{esc(e["name"]).lower()}" '
        f'data-hall="{hall.lower()}" '
        f'data-cats="{esc(" ".join(e.get("categories") or [])).lower()}" '
        f'data-score="{m["score"]}" '
        f'data-games="{n_games}" '
        f'data-plays="{total_plays}" '
        f'data-ontopic="{1 if m.get("on_topic", True) else 0}" '
        f'data-haystack="{esc(haystack)}"'
    )
    logo_html = render_logo(e)
    # "Why this is here" tooltip surfaces the actual matched publisher names
    # and counts. Helps you sanity-check a surprising recommendation.
    why_pubs = sorted({g["publisher"] for g in m["games"]})
    why_text = (
        f"Matched on {len(why_pubs)} publisher{'s' if len(why_pubs) != 1 else ''} "
        f"credited on {n_games} of your games: " + ", ".join(why_pubs[:8])
        + ("…" if len(why_pubs) > 8 else "")
    )
    return f"""
    <article class="ex-card" {data_attrs}>
      <header class="ex-head">
        <div class="ex-rank">#{idx}</div>
        {logo_html}
        <div class="ex-title">
          <h3><a href="{url}" target="_blank" rel="noopener">{name}</a> {off_topic_badge}</h3>
          <div class="ex-loc">
            <span class="hall">{hall}</span>
            <span class="stand">{stand}</span>
          </div>
        </div>
        <div class="ex-stats">
          <div class="stat"><strong>{n_games}</strong><span>game{'s' if n_games != 1 else ''}</span></div>
          <div class="stat"><strong>{total_plays}</strong><span>plays</span></div>
          <div class="stat"><strong>{m["score"]}</strong><span>score</span></div>
        </div>
      </header>
      <div class="ex-cats">{cats}</div>
      {f'<p class="ex-desc">{desc}</p>' if desc else ''}
      <details class="ex-games">
        <summary>{n_games} matching {'game' if n_games == 1 else 'games'} in your collection</summary>
        <ul class="game-list">{games_html}</ul>
      </details>
      <button class="why-btn" type="button" data-action="why" title="{esc(why_text)}">why is this here?</button>
      <div class="booth-tools">
        <button class="visit-btn" data-action="toggle-visit" type="button">Mark as visited</button>
        <button class="skip-btn" data-action="toggle-skip" type="button">Skip</button>
        <button class="notes-toggle" data-action="toggle-notes" type="button">Notes</button>
        <div class="notes-area hidden" data-role="notes">
          <textarea data-role="notes-text" placeholder="Notes about this stand — saved on your device only"></textarea>
        </div>
      </div>
    </article>
    """


def render_discovery_row(d, idx):
    e = d["exhibitor"]
    name = esc(e["name"])
    hall = esc(e.get("hall") or "")
    stand = esc(e.get("stand") or "")
    cats = " · ".join(esc(c) for c in (e.get("categories") or []))
    desc = esc(e.get("description") or "")
    slug = e["slug"]
    url = f"https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/{slug}/"
    kw = ", ".join(esc(k) for k in d["matched_keywords"])
    haystack = " ".join([
        e["name"] or "",
        " ".join(e.get("categories") or []),
        e.get("description") or "",
        hall,
        stand,
        " ".join(d["matched_keywords"]),
    ]).lower()
    data_attrs = (
        f'data-slug="{esc(e["slug"])}" '
        f'data-name="{esc(e["name"]).lower()}" '
        f'data-hall="{hall.lower()}" '
        f'data-score="{d["score"]}" '
        f'data-haystack="{esc(haystack)}"'
    )
    logo_html = render_logo(e)
    return f"""
    <article class="dx-card" {data_attrs}>
      <header class="dx-head">
        <div class="dx-rank">#{idx}</div>
        {logo_html}
        <div class="dx-title">
          <h4><a href="{url}" target="_blank" rel="noopener">{name}</a></h4>
          <div class="dx-loc">
            <span class="hall">{hall}</span>
            <span class="stand">{stand}</span>
          </div>
        </div>
        <div class="dx-score">{d["score"]} shared tag{'s' if d["score"] != 1 else ''}</div>
      </header>
      <div class="dx-cats">{cats}</div>
      {f'<p class="dx-desc">{desc}</p>' if desc else ''}
      <div class="dx-kw">matched on: {kw}</div>
      <div class="booth-tools">
        <button class="visit-btn" data-action="toggle-visit" type="button">Mark as visited</button>
        <button class="skip-btn" data-action="toggle-skip" type="button">Skip</button>
        <button class="notes-toggle" data-action="toggle-notes" type="button">Notes</button>
        <div class="notes-area hidden" data-role="notes">
          <textarea data-role="notes-text" placeholder="Notes — saved on your device only"></textarea>
        </div>
      </div>
    </article>
    """


def render_all_vendor_card(e):
    """Compact card for the browse-all section."""
    name = esc(e.get("name") or "")
    hall = esc(e.get("hall") or "")
    stand = esc(e.get("stand") or "")
    cats = " · ".join(esc(c) for c in (e.get("categories") or []))
    desc = esc(e.get("description") or "")
    slug = e["slug"]
    url = f"https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/{slug}/"
    logo_html = render_logo(e)
    haystack = " ".join([
        e.get("name") or "",
        " ".join(e.get("categories") or []),
        e.get("description") or "",
        hall,
        stand,
    ]).lower()
    data_attrs = (
        f'data-slug="{esc(slug)}" '
        f'data-name="{esc(e.get("name") or "").lower()}" '
        f'data-hall="{hall.lower()}" '
        f'data-cats="{esc(" ".join(e.get("categories") or [])).lower()}" '
        f'data-haystack="{esc(haystack)}"'
    )
    return f"""
    <article class="av-card" {data_attrs}>
      <header class="av-head">
        {logo_html}
        <div class="av-title">
          <h4><a href="{url}" target="_blank" rel="noopener">{name}</a></h4>
          <div class="av-loc">
            <span class="hall">{hall}</span>
            <span class="stand">{stand}</span>
          </div>
        </div>
      </header>
      <div class="av-cats">{cats}</div>
      {f'<p class="av-desc">{desc}</p>' if desc else ''}
      <div class="booth-tools booth-tools-compact">
        <button class="visit-btn" data-action="toggle-visit" type="button">Mark as visited</button>
        <button class="skip-btn" data-action="toggle-skip" type="button">Skip</button>
        <button class="notes-toggle" data-action="toggle-notes" type="button">Notes</button>
        <div class="notes-area hidden" data-role="notes">
          <textarea data-role="notes-text" placeholder="Notes — saved on your device only"></textarea>
        </div>
      </div>
    </article>
    """


def render_hot_card(item, idx):
    h = item["hot"]
    bgg_url = f"https://boardgamegeek.com/boardgame/{h['bggId']}"
    name = esc(h.get("name") or "")
    year = esc(h.get("year") or "")
    thumb = esc(h.get("thumb") or "")
    rating = h.get("geekRating") or 0
    rating_s = f"{rating:.2f}" if rating else "—"
    cats = " · ".join(esc(c) for c in (h.get("categories") or [])[:4])
    venues = []
    for me in item["exhibitors"][:3]:
        e = me["exhibitor"]
        url = f"https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/{e['slug']}/"
        loc = f"{esc(e.get('hall') or '')} {esc(e.get('stand') or '')}".strip()
        venues.append(
            f'<a class="hot-venue" href="{url}" target="_blank" rel="noopener">'
            f'<span class="ex-name">{esc(e["name"])}</span>'
            f'<span class="ex-loc-tag">{loc}</span></a>'
        )
    venues_html = "".join(venues)
    img_html = f'<img src="{thumb}" alt="" loading="lazy">' if thumb else '<div class="no-thumb">·</div>'
    haystack = " ".join([
        name, year, " ".join(h.get("categories") or []),
        " ".join(me["exhibitor"]["name"] for me in item["exhibitors"]),
    ]).lower()
    return f"""
    <article class="hot-card" data-haystack="{esc(haystack)}" data-year="{year}" data-rank="{idx}">
      <a class="hot-thumb" href="{bgg_url}" target="_blank" rel="noopener" title="View on BoardGameGeek">{img_html}</a>
      <div class="hot-body">
        <header class="hot-head">
          <div class="hot-rank">#{idx}</div>
          <div class="hot-title">
            <h4><a href="{bgg_url}" target="_blank" rel="noopener">{name}</a></h4>
            <div class="hot-meta">{year} · BGG {rating_s}</div>
          </div>
        </header>
        <div class="hot-cats">{cats}</div>
        <div class="hot-venues">
          <div class="hot-venues-label">See it at:</div>
          {venues_html}
        </div>
      </div>
    </article>
    """


def build_html(ranked, discovery, collection, exhibitors, top_cats, top_mechs, hot_at_show):
    matched_games = set()
    for m in ranked:
        for g in m["games"]:
            matched_games.add(g["game"]["bggId"])
    total_plays = sum(g.get("plays") or 0 for g in collection)
    matched_plays = sum(m["total_plays"] for m in ranked)
    coverage = (len([g for g in collection if g["bggId"] in matched_games]) / max(len(collection), 1)) * 100

    ranked_html = "\n".join(render_exhibitor_row(m, i + 1) for i, m in enumerate(ranked))
    discovery_html = "\n".join(render_discovery_row(d, i + 1) for i, d in enumerate(discovery[:40]))
    hot_html = "\n".join(render_hot_card(h, i + 1) for i, h in enumerate(hot_at_show))
    all_vendors_html = "\n".join(
        render_all_vendor_card(e) for e in sorted(exhibitors, key=lambda x: (x.get("name") or "").lower())
    )

    cats_html = " · ".join(f'<span class="tag">{esc(c)} <span class="tag-w">{w}</span></span>' for c, w in top_cats)
    mechs_html = " · ".join(f'<span class="tag">{esc(m)} <span class="tag-w">{w}</span></span>' for m, w in top_mechs)

    OUTPUT.write_text(TEMPLATE.format(
        ranked_html=ranked_html,
        discovery_html=discovery_html,
        hot_html=hot_html,
        all_vendors_html=all_vendors_html,
        total_games=len(collection),
        total_plays=total_plays,
        matched_exhibitors=len(ranked),
        matched_plays=matched_plays,
        coverage=f"{coverage:.0f}",
        total_exhibitors=len(exhibitors),
        discovery_count=len(discovery),
        hot_count=len(hot_at_show),
        top_cats=cats_html,
        top_mechs=mechs_html,
        bgg_username=BGG_USERNAME,
    ), encoding="utf-8")
    SW_OUTPUT.write_text(SERVICE_WORKER, encoding="utf-8")
    print(f"wrote {OUTPUT}")
    print(f"wrote {SW_OUTPUT}")


SERVICE_WORKER = r"""// UKGE Companion service worker — cache-first for the dashboard so it
// keeps working on the NEC's flaky show-floor wifi.
const CACHE = 'ukge-companion-v1';
const ASSETS = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // Refresh in background.
        fetch(req).then((r) => {
          if (r && r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((r) => {
        if (r && r.ok && new URL(req.url).origin === self.location.origin) {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return r;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
"""


TEMPLATE = (ROOT / "template.html").read_text(encoding="utf-8")



if __name__ == "__main__":
    main()
