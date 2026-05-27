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
OUTPUT = ROOT / "index.html"
SW_OUTPUT = ROOT / "sw.js"


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

    print(f"matched exhibitors: {len(ranked)}")
    print(f"discovery candidates: {len(discovery)}")

    build_html(ranked, discovery, collection, exhibitors, top_cats, top_mechs)


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

def esc(s):
    if s is None:
        return ""
    return html.escape(str(s))


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
    return f"""
    <article class="ex-card" {data_attrs}>
      <header class="ex-head">
        <div class="ex-rank">#{idx}</div>
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
      <div class="booth-tools">
        <button class="visit-btn" data-action="toggle-visit" type="button">Mark as visited</button>
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
    return f"""
    <article class="dx-card" {data_attrs}>
      <header class="dx-head">
        <div class="dx-rank">#{idx}</div>
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
        <button class="notes-toggle" data-action="toggle-notes" type="button">Notes</button>
        <div class="notes-area hidden" data-role="notes">
          <textarea data-role="notes-text" placeholder="Notes — saved on your device only"></textarea>
        </div>
      </div>
    </article>
    """


def build_html(ranked, discovery, collection, exhibitors, top_cats, top_mechs):
    matched_games = set()
    for m in ranked:
        for g in m["games"]:
            matched_games.add(g["game"]["bggId"])
    total_plays = sum(g.get("plays") or 0 for g in collection)
    matched_plays = sum(m["total_plays"] for m in ranked)
    coverage = (len([g for g in collection if g["bggId"] in matched_games]) / max(len(collection), 1)) * 100

    ranked_html = "\n".join(render_exhibitor_row(m, i + 1) for i, m in enumerate(ranked))
    discovery_html = "\n".join(render_discovery_row(d, i + 1) for i, d in enumerate(discovery[:40]))

    cats_html = " · ".join(f'<span class="tag">{esc(c)} <span class="tag-w">{w}</span></span>' for c, w in top_cats)
    mechs_html = " · ".join(f'<span class="tag">{esc(m)} <span class="tag-w">{w}</span></span>' for m, w in top_mechs)

    OUTPUT.write_text(TEMPLATE.format(
        ranked_html=ranked_html,
        discovery_html=discovery_html,
        total_games=len(collection),
        total_plays=total_plays,
        matched_exhibitors=len(ranked),
        matched_plays=matched_plays,
        coverage=f"{coverage:.0f}",
        total_exhibitors=len(exhibitors),
        discovery_count=len(discovery),
        top_cats=cats_html,
        top_mechs=mechs_html,
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


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1410">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>UKGE 2026 — Personalised Exhibitor Guide for Kieranties</title>
<style>
  :root {{
    --bg: #1a1410;
    --panel: #2a1f17;
    --panel-2: #3a2c20;
    --ink: #f5e7d0;
    --ink-dim: #b9a486;
    --accent: #e8a73f;
    --accent-2: #d6602f;
    --green: #6fa86c;
    --line: rgba(245, 231, 208, 0.12);
    --shadow: 0 2px 0 rgba(0,0,0,0.4), 0 4px 18px rgba(0,0,0,0.45);
    --radius: 14px;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{
    background:
      radial-gradient(ellipse at top left, #2a1f17 0%, transparent 55%),
      radial-gradient(ellipse at bottom right, #3a2516 0%, transparent 60%),
      var(--bg);
    color: var(--ink);
    font-family: 'Iowan Old Style', 'Cambria', Georgia, serif;
    margin: 0;
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
  }}
  body {{ padding: 0 16px 80px; }}
  header.top {{
    max-width: 1200px;
    margin: 0 auto;
    padding: 28px 0 18px;
    border-bottom: 1px solid var(--line);
  }}
  header.top h1 {{
    margin: 0 0 4px;
    font-size: clamp(24px, 5vw, 38px);
    letter-spacing: 0.5px;
    color: var(--accent);
    font-weight: 600;
    line-height: 1.15;
  }}
  header.top .sub {{ color: var(--ink-dim); font-size: clamp(13px, 2.4vw, 16px); }}
  .meta-strip {{
    max-width: 1200px;
    margin: 18px auto;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }}
  @media (min-width: 600px) {{ .meta-strip {{ grid-template-columns: repeat(3, 1fr); }} }}
  @media (min-width: 900px) {{ .meta-strip {{ grid-template-columns: repeat(5, 1fr); }} }}
  .meta-card {{
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    box-shadow: var(--shadow);
  }}
  .meta-card .v {{ font-size: clamp(22px, 5vw, 28px); color: var(--accent); font-weight: 600; }}
  .meta-card .k {{ color: var(--ink-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }}
  section {{ max-width: 1200px; margin: 28px auto; }}
  section h2 {{
    color: var(--accent);
    font-size: clamp(19px, 3.5vw, 24px);
    margin: 0 0 8px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    line-height: 1.2;
  }}
  section h2 .count {{ color: var(--ink-dim); font-size: 13px; font-weight: 400; }}
  section .lede {{ color: var(--ink-dim); margin: 0 0 16px; max-width: 70ch; font-size: 14px; }}
  /* Global sticky search bar */
  .global-search {{
    position: sticky;
    top: 0;
    z-index: 30;
    background: linear-gradient(180deg, var(--bg) 0%, rgba(26,20,16,0.85) 100%);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 10px 0;
    margin: 0 -16px 0;
    padding-left: 16px;
    padding-right: 16px;
    border-bottom: 1px solid var(--line);
  }}
  .global-search .wrap {{
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  .global-search input {{
    flex: 1;
    min-width: 0;
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 14px;
    font-family: inherit;
    font-size: 16px; /* >=16 to suppress iOS zoom */
  }}
  .global-search button {{
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 14px;
    font-family: inherit;
    font-size: 14px;
    cursor: pointer;
  }}
  .global-search button.active {{ border-color: var(--accent); color: var(--accent); }}
  .global-search .hint {{ color: var(--ink-dim); font-size: 11px; margin-top: 4px; }}
  .controls {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 6px 0 14px;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px 12px;
  }}
  .controls label {{ color: var(--ink-dim); font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }}
  .controls input, .controls select {{
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 14px;
    max-width: 100%;
  }}
  .controls input {{ min-width: 0; flex: 1; min-width: 180px; }}
  .ex-grid, .dx-grid {{ display: grid; grid-template-columns: 1fr; gap: 14px; }}
  @media (min-width: 760px) {{ .ex-grid {{ grid-template-columns: 1fr 1fr; }} }}
  @media (min-width: 1100px) {{ .dx-grid {{ grid-template-columns: 1fr 1fr 1fr; }} }}
  @media (min-width: 760px) and (max-width: 1099px) {{ .dx-grid {{ grid-template-columns: 1fr 1fr; }} }}
  .ex-card, .dx-card {{
    background: linear-gradient(180deg, var(--panel) 0%, #261b13 100%);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px;
    box-shadow: var(--shadow);
    position: relative;
  }}
  .ex-card.visited {{
    border-color: rgba(111, 168, 108, 0.45);
    box-shadow: 0 0 0 1px rgba(111, 168, 108, 0.25), var(--shadow);
  }}
  .ex-card.visited::before {{
    content: "✓ visited";
    position: absolute;
    top: -10px;
    right: 12px;
    background: var(--green);
    color: #0f1a0e;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 10px;
    border-radius: 999px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }}
  .ex-head, .dx-head {{
    display: grid;
    grid-template-columns: 40px 1fr;
    gap: 10px;
    align-items: start;
  }}
  @media (min-width: 480px) {{
    .ex-head, .dx-head {{ grid-template-columns: 44px 1fr auto; }}
  }}
  .ex-stats {{ grid-column: 1 / -1; }}
  @media (min-width: 480px) {{ .ex-stats {{ grid-column: auto; }} }}
  .ex-rank, .dx-rank {{
    background: var(--accent);
    color: #1a1410;
    font-weight: 700;
    border-radius: 50%;
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px;
    box-shadow: inset 0 -3px 0 rgba(0,0,0,0.25);
  }}
  @media (min-width: 480px) {{
    .ex-rank, .dx-rank {{ width: 44px; height: 44px; font-size: 15px; }}
  }}
  .dx-rank {{ background: var(--green); color: #0f1a0e; }}
  .ex-title h3, .dx-title h4 {{ margin: 0; font-size: 17px; color: var(--ink); line-height: 1.25; }}
  @media (min-width: 480px) {{ .ex-title h3 {{ font-size: 19px; }} .dx-title h4 {{ font-size: 18px; }} }}
  .ex-title h3 a, .dx-title h4 a {{ color: inherit; text-decoration: none; }}
  .ex-title h3 a:hover, .dx-title h4 a:hover {{ color: var(--accent); text-decoration: underline; }}
  .ex-loc, .dx-loc {{
    color: var(--ink-dim);
    font-size: 12px;
    margin-top: 4px;
    display: flex; gap: 8px; flex-wrap: wrap;
  }}
  .ex-loc .stand, .dx-loc .stand {{
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 1px 8px;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--ink);
  }}
  .ex-stats {{ display: flex; gap: 8px; margin-top: 10px; }}
  .ex-stats .stat {{ text-align: center; min-width: 44px; flex: 1; background: rgba(58,44,32,0.4); border-radius: 8px; padding: 4px 6px; }}
  @media (min-width: 480px) {{ .ex-stats {{ margin-top: 0; }} .ex-stats .stat {{ flex: none; background: none; padding: 0; }} }}
  .ex-stats strong {{ display: block; color: var(--accent); font-size: 17px; }}
  .ex-stats span {{ font-size: 10px; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.06em; }}
  .ex-cats, .dx-cats {{
    margin: 10px 0 6px;
    color: var(--ink-dim);
    font-size: 12px;
    letter-spacing: 0.04em;
  }}
  .ex-desc, .dx-desc {{
    color: var(--ink);
    font-size: 14px;
    margin: 6px 0 10px;
    opacity: 0.85;
  }}
  details.ex-games {{ margin-top: 4px; border-top: 1px dashed var(--line); padding-top: 8px; }}
  details.ex-games summary {{ cursor: pointer; color: var(--accent-2); font-size: 14px; padding: 4px 0; }}
  ul.game-list {{ list-style: none; padding: 8px 0 0; margin: 0; }}
  ul.game-list li.game-chip {{
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 10px;
    margin-bottom: 6px;
    font-size: 13px;
    line-height: 1.4;
  }}
  ul.game-list li.game-chip > * {{ display: inline; }}
  .g-name {{ color: var(--ink); font-weight: 600; }}
  .g-year {{ color: var(--ink-dim); }}
  .g-plays {{ color: var(--accent); margin-left: 8px; font-size: 12px; }}
  .g-pub {{ color: var(--ink-dim); margin-left: 8px; font-size: 12px; font-style: italic; }}
  .g-meta {{ color: var(--ink-dim); font-size: 12px; margin-left: 8px; }}
  .dx-score {{ background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 4px 10px; font-size: 12px; color: var(--green); align-self: start; }}
  .dx-kw {{ color: var(--ink-dim); font-size: 12px; margin-top: 6px; }}
  .tag-cloud {{ background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; }}
  .tag-cloud .tag {{ display: inline-block; margin: 4px 8px 4px 0; color: var(--ink); font-size: 13px; }}
  .tag-cloud .tag-w {{ color: var(--ink-dim); font-size: 11px; }}
  footer {{
    max-width: 1200px;
    margin: 50px auto 0;
    padding: 20px 0 0;
    border-top: 1px solid var(--line);
    color: var(--ink-dim);
    font-size: 13px;
  }}
  footer a {{ color: var(--accent-2); }}
  .hidden {{ display: none !important; }}
  .off-topic {{
    display: inline-block;
    background: rgba(214, 96, 47, 0.18);
    color: var(--accent-2);
    border: 1px solid rgba(214, 96, 47, 0.4);
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 11px;
    letter-spacing: 0.04em;
    margin-left: 6px;
    vertical-align: middle;
    cursor: help;
  }}
  /* Visited + notes UI */
  .booth-tools {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--line);
    align-items: center;
  }}
  .visit-btn {{
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    min-height: 36px;
    flex: 1 1 auto;
    min-width: 130px;
  }}
  .visit-btn.on {{ background: var(--green); color: #0f1a0e; border-color: transparent; font-weight: 600; }}
  .notes-toggle {{
    background: transparent;
    color: var(--accent-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    min-height: 36px;
    flex: 0 1 auto;
  }}
  .notes-toggle.has-notes {{ color: var(--accent); border-color: rgba(232, 167, 63, 0.4); }}
  .notes-area {{
    flex-basis: 100%;
    margin-top: 8px;
  }}
  .notes-area textarea {{
    width: 100%;
    min-height: 80px;
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 14px;
    resize: vertical;
  }}
  /* Hit highlighting */
  .hit {{ background: rgba(232, 167, 63, 0.25); border-radius: 3px; padding: 0 2px; }}
  .toast {{
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 13px;
    box-shadow: var(--shadow);
    opacity: 0;
    transition: opacity 200ms ease, transform 200ms ease;
    pointer-events: none;
    z-index: 100;
  }}
  .toast.show {{ opacity: 1; transform: translateX(-50%) translateY(0); }}
  @media (max-width: 480px) {{
    body {{ padding: 0 12px 80px; }}
  }}
</style>
</head>
<body>

<header class="top">
  <h1>UK Games Expo 2026 — Your Personalised Exhibitor Guide</h1>
  <div class="sub">29–31 May · NEC Birmingham · Built for <strong>Kieranties</strong> from your BGG collection</div>
</header>

<div class="global-search">
  <div class="wrap">
    <input id="global-q" type="search" placeholder="Search exhibitor, game, publisher, category, hall, stand…" autocomplete="off" inputmode="search">
    <button id="visited-only" type="button" title="Show only stands you've marked as visited">Visited</button>
    <button id="unvisited-only" type="button" title="Hide stands you've already visited">Unvisited</button>
  </div>
</div>

<div class="meta-strip">
  <div class="meta-card"><div class="v">{total_games}</div><div class="k">games in collection</div></div>
  <div class="meta-card"><div class="v">{total_plays}</div><div class="k">total plays logged</div></div>
  <div class="meta-card"><div class="v">{total_exhibitors}</div><div class="k">exhibitors at show</div></div>
  <div class="meta-card"><div class="v">{matched_exhibitors}</div><div class="k">match your collection</div></div>
  <div class="meta-card"><div class="v">{coverage}%</div><div class="k">collection coverage</div></div>
</div>

<section>
  <h2>Top recommendations <span class="count">— exhibitors who publish games you actually play</span></h2>
  <p class="lede">
    Ranked by play-weighted publisher matches in your BGG collection. Each game's contribution is capped at 25 plays so one
    favourite (Carcassonne, we see you) doesn't drown out the rest. Click an exhibitor to open their UKGE page; expand the
    panel for the underlying games and play counts.
  </p>
  <div class="controls">
    <label>Filter <input id="ex-filter" placeholder="exhibitor, hall, category…"></label>
    <label>Hall
      <select id="ex-hall">
        <option value="">all</option>
        <option>Hall One</option>
        <option>Hall Two</option>
        <option>Hall Three</option>
        <option>Hall Four</option>
        <option>Hall Five</option>
        <option>Toy Fair</option>
      </select>
    </label>
    <label>Sort
      <select id="ex-sort">
        <option value="score">recommendation score</option>
        <option value="games">number of games</option>
        <option value="plays">total plays</option>
        <option value="name">name (A–Z)</option>
        <option value="hall">hall + stand</option>
      </select>
    </label>
  </div>
  <div class="ex-grid" id="ex-grid">
    {ranked_html}
  </div>
</section>

<section>
  <h2>Discovery — publishers worth a look <span class="count">— {discovery_count} candidates, top 40 shown</span></h2>
  <p class="lede">
    Publishers at the expo who don't already publish anything you own, but make games that share categories and mechanics
    with your most-played titles. Scored by how many of your top tags appear in their description and categories.
  </p>
  <div class="controls">
    <label>Filter <input id="dx-filter" placeholder="exhibitor, hall…"></label>
    <label>Hall
      <select id="dx-hall">
        <option value="">all</option>
        <option>Hall One</option>
        <option>Hall Two</option>
        <option>Hall Three</option>
        <option>Hall Four</option>
        <option>Hall Five</option>
        <option>Toy Fair</option>
      </select>
    </label>
  </div>
  <div class="dx-grid" id="dx-grid">
    {discovery_html}
  </div>
</section>

<section>
  <h2>Your taste signal <span class="count">— what the discovery engine is matching against</span></h2>
  <p class="lede">Top categories and mechanics across your collection, weighted by plays.</p>
  <div class="tag-cloud">
    <strong style="color:var(--accent)">Categories:</strong> {top_cats}
  </div>
  <div class="tag-cloud" style="margin-top:10px">
    <strong style="color:var(--accent)">Mechanics:</strong> {top_mechs}
  </div>
</section>

<footer>
  Generated locally · Data from BoardGameGeek (collection &amp; publisher info) and ukgamesexpo.co.uk (exhibitor list).
  Names match using normalised token-set Jaccard with parenthetical region suffixes stripped — there are still false negatives
  where a UK distributor exhibits under a different name than the BGG-credited publisher.
</footer>

<div class="toast" id="toast"></div>
<script>
(() => {{
  const STORAGE_KEY = 'ukge-companion-state-v1';
  const state = (() => {{
    try {{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{{}}'); }}
    catch (e) {{ return {{}}; }}
  }})();
  function save() {{
    try {{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }}
    catch (e) {{ showToast('Storage failed — notes may not persist'); }}
  }}
  function entryFor(slug) {{
    if (!state[slug]) state[slug] = {{}};
    return state[slug];
  }}
  function showToast(msg) {{
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove('show'), 1800);
  }}

  // Wire per-card visited + notes
  const allCards = Array.from(document.querySelectorAll('.ex-card, .dx-card'));
  for (const card of allCards) {{
    const slug = card.dataset.slug;
    const entry = entryFor(slug);
    const visitBtn = card.querySelector('[data-action="toggle-visit"]');
    const notesBtn = card.querySelector('[data-action="toggle-notes"]');
    const notesArea = card.querySelector('[data-role="notes"]');
    const notesText = card.querySelector('[data-role="notes-text"]');

    function syncUI() {{
      const visited = !!entry.visited;
      card.classList.toggle('visited', visited);
      if (visitBtn) {{
        visitBtn.textContent = visited ? '✓ Visited' : 'Mark as visited';
        visitBtn.classList.toggle('on', visited);
      }}
      const hasNotes = !!(entry.notes && entry.notes.trim());
      if (notesBtn) notesBtn.classList.toggle('has-notes', hasNotes);
      if (notesText && notesText.value !== (entry.notes || '')) notesText.value = entry.notes || '';
    }}
    syncUI();
    visitBtn?.addEventListener('click', () => {{
      entry.visited = !entry.visited;
      if (entry.visited) entry.visitedAt = new Date().toISOString();
      else delete entry.visitedAt;
      save();
      syncUI();
      applyFilters();
    }});
    notesBtn?.addEventListener('click', () => {{
      notesArea.classList.toggle('hidden');
      if (!notesArea.classList.contains('hidden')) notesText.focus();
    }});
    let notesDebounce;
    notesText?.addEventListener('input', () => {{
      clearTimeout(notesDebounce);
      notesDebounce = setTimeout(() => {{
        entry.notes = notesText.value;
        save();
        syncUI();
      }}, 250);
    }});
  }}

  // Search / filter / sort
  const exGrid = document.getElementById('ex-grid');
  const dxGrid = document.getElementById('dx-grid');
  const globalQ = document.getElementById('global-q');
  const exFilter = document.getElementById('ex-filter');
  const exHall = document.getElementById('ex-hall');
  const exSort = document.getElementById('ex-sort');
  const dxFilter = document.getElementById('dx-filter');
  const dxHall = document.getElementById('dx-hall');
  const visitedOnlyBtn = document.getElementById('visited-only');
  const unvisitedOnlyBtn = document.getElementById('unvisited-only');
  let visitedFilter = ''; // '', 'visited', 'unvisited'

  function applyFilters() {{
    const q = (globalQ?.value || '').toLowerCase().trim();
    const exQ = (exFilter?.value || '').toLowerCase().trim();
    const dxQ = (dxFilter?.value || '').toLowerCase().trim();
    const exH = (exHall?.value || '').toLowerCase().trim();
    const dxH = (dxHall?.value || '').toLowerCase().trim();
    for (const c of allCards) {{
      const isEx = c.classList.contains('ex-card');
      const hay = c.dataset.haystack || '';
      const hall = c.dataset.hall || '';
      const sectionQ = isEx ? exQ : dxQ;
      const sectionH = isEx ? exH : dxH;
      const visited = c.classList.contains('visited');
      const passesGlobal = !q || hay.includes(q);
      const passesSection = !sectionQ || hay.includes(sectionQ);
      const passesHall = !sectionH || hall === sectionH;
      const passesVisit =
        !visitedFilter ||
        (visitedFilter === 'visited' && visited) ||
        (visitedFilter === 'unvisited' && !visited);
      c.classList.toggle('hidden', !(passesGlobal && passesSection && passesHall && passesVisit));
    }}
    // Sort (only ex grid is sortable)
    if (exSort) {{
      const key = exSort.value;
      const exCards = allCards.filter(c => c.classList.contains('ex-card'));
      const sorted = [...exCards].sort((a, b) => {{
        if (key === 'name') return (a.dataset.name || '').localeCompare(b.dataset.name || '');
        if (key === 'hall') {{
          return (a.dataset.hall || '').localeCompare(b.dataset.hall || '') ||
                 (a.dataset.name || '').localeCompare(b.dataset.name || '');
        }}
        const av = parseFloat(a.dataset[key] || '0');
        const bv = parseFloat(b.dataset[key] || '0');
        return bv - av;
      }});
      for (const c of sorted) exGrid.appendChild(c);
    }}
  }}
  [globalQ, exFilter, dxFilter].forEach(el => el?.addEventListener('input', applyFilters));
  [exHall, dxHall, exSort].forEach(el => el?.addEventListener('change', applyFilters));
  visitedOnlyBtn?.addEventListener('click', () => {{
    visitedFilter = visitedFilter === 'visited' ? '' : 'visited';
    visitedOnlyBtn.classList.toggle('active', visitedFilter === 'visited');
    unvisitedOnlyBtn.classList.remove('active');
    applyFilters();
  }});
  unvisitedOnlyBtn?.addEventListener('click', () => {{
    visitedFilter = visitedFilter === 'unvisited' ? '' : 'unvisited';
    unvisitedOnlyBtn.classList.toggle('active', visitedFilter === 'unvisited');
    visitedOnlyBtn.classList.remove('active');
    applyFilters();
  }});

  // Cmd/Ctrl-K focuses the global search
  document.addEventListener('keydown', (e) => {{
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {{
      e.preventDefault();
      globalQ?.focus();
      globalQ?.select();
    }} else if (e.key === 'Escape' && document.activeElement === globalQ) {{
      globalQ.value = '';
      applyFilters();
    }}
  }});

  // Service worker — only attempts when served over http(s).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {{
    window.addEventListener('load', () => {{
      navigator.serviceWorker.register('./sw.js').catch(() => {{}});
    }});
  }}
}})();
</script>

</body>
</html>
"""


if __name__ == "__main__":
    main()
