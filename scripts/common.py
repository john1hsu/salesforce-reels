"""Shared helpers for the Salesforce Reels scripts."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REELS = ROOT / "reels"
LIBRARY = ROOT / "library"
MANIFEST = ROOT / "index" / "manifest.json"
COVERAGE = ROOT / "coverage" / "coverage.json"
ENGINE = ROOT / "app" / "engine.js"
DEFAULT_SOURCE = ROOT / ".source" / "salesforce-knowledge-graph"
SOURCE_REPO = "john1hsu/salesforce-knowledge-graph"

STYLES = ["fact", "story", "humor", "myth"]
IN_FEED = ("active", "stale")            # statuses the app plays
STATUSES = ("active", "stale", "superseded", "retired")

# timing: must match app/engine.js
WPS, MIN_BEAT, GAP = 2.7, 1.2, 0.35
MIN_SECONDS, MAX_SECONDS = 15.0, 20.0

# names that must never appear: exam case companies, and Salesforce's own mascots
# (the cast here is original; never draw or name theirs)
BANNED = ["universal containers", "cloud kicks", "northern trail outfitters", "according to the article",
          "astro", "codey", "appy", "cloudy the goat", "hootie", "blaze the wolf", "earnie", "brandy the fox",
          "genie the rabbit", "ruth the elephant", "koa the dog", "zig the zebra", "saasy"]


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_manifest(path: Path, data: dict) -> None:
    """One reel per line: small to download and easy to diff."""
    lines = [json.dumps(r, separators=(",", ":"), ensure_ascii=False) for r in data["reels"]]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"count":%d,"reels":[\n%s\n]}\n' % (data["count"], ",\n".join(lines)), encoding="utf-8")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def engine_list(name: str) -> list[str]:
    """Read one of the string lists (animations, effects...) straight from the engine, so the
    Python checks can never drift from what the player can draw."""
    m = re.search(r"var %s = \[(.*?)\];" % re.escape(name), ENGINE.read_text(encoding="utf-8"), re.S)
    if not m:
        die(f"{name} not found in app/engine.js")
    return json.loads("[" + m.group(1) + "]")


def load_library() -> dict:
    cast = read_json(LIBRARY / "cast.json")["characters"]
    props = read_json(LIBRARY / "props.json")["props"]
    backdrops = read_json(LIBRARY / "backdrops.json")["backdrops"]
    return {"cast": cast, "props": props, "backdrops": backdrops,
            "cast_ids": {c["id"] for c in cast}, "prop_ids": {p["id"] for p in props},
            "backdrop_ids": {b["id"] for b in backdrops}}


def load_reels() -> list[tuple[Path, dict]]:
    return [(p, read_json(p)) for p in sorted(REELS.glob("*/sr-*.json"))]


def next_id(reels: list[tuple[Path, dict]]) -> int:
    return max([int(r["id"].split("-")[1]) for _, r in reels] or [0]) + 1


def words(text: str) -> list[str]:
    return str(text or "").split()


def beat_seconds(beat: dict) -> float:
    return max(MIN_BEAT, len(words(beat.get("say"))) / WPS)


def speech_seconds(reel: dict) -> float:
    return sum(beat_seconds(b) + GAP for b in reel.get("beats") or [])


def narration(reel: dict) -> str:
    return " ".join(str(b.get("say", "")) for b in reel.get("beats") or [])


def cast_of(reel: dict) -> list[str]:
    seen: list[str] = []
    for b in reel.get("beats") or []:
        for cid in [a.get("id") for a in b.get("actors") or []] + ([b["speaker"]] if b.get("speaker") else []):
            if cid and cid not in seen:
                seen.append(cid)
    return seen


def normalize(text: str) -> str:
    """Lower-case plain text for matching an evidence snippet against an article."""
    text = re.sub(r"\[\^[^\]]+\]", " ", text)                 # footnote markers
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)      # markdown links
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-").replace(" ", " ")
    text = re.sub(r"[*_`>#|]", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


STOP = set("a an the and or but of to in on for with is are was were be been it its this that as at by from "
           "you your i we they he she not no so if then when can will just do does did has have had".split())


def tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in STOP and len(w) > 1}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def source_commit(src: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return ""


def read_article(src: Path, rel: str) -> tuple[dict, str] | None:
    p = src / rel
    if not p.is_file():
        return None
    text = p.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return {}, text
    return (yaml.safe_load(m.group(1)) or {}), m.group(2)


def release_key(rel: str) -> tuple[int, int]:
    m = re.match(r"(Winter|Spring|Summer) '(\d\d)", str(rel or ""))
    return (int(m.group(2)), ["Winter", "Spring", "Summer"].index(m.group(1))) if m else (0, 0)


def stamp_sources(reel: dict, src: Path) -> list[str]:
    """Fill reel['sources'] (path -> id, title, domain, blob, release), topics and verified_release
    from the source clone. Returns errors."""
    errs, out, topics = [], [], []
    for s in reel.get("sources") or []:
        path = s if isinstance(s, str) else s.get("path")
        art = read_article(src, path or "")
        if not art:
            errs.append(f"source article not found: {path}")
            continue
        meta, _ = art
        out.append({"path": path, "id": meta.get("id"), "title": meta.get("title"), "domain": meta.get("domain"),
                    "release": meta.get("release"), "blob": blob_sha(src / path)})
        if meta.get("domain") and meta["domain"] not in topics:
            topics.append(meta["domain"])
    if errs:
        return errs
    reel["sources"] = out
    reel["topics"] = topics
    reel["source_commit"] = source_commit(src)
    reel["verified_release"] = max((s["release"] for s in out if s.get("release")), key=release_key, default=None)
    return []


def check_reel(reel: dict, lib: dict, src: Path | None = None, others: list[dict] | None = None,
               enums: dict | None = None) -> list[str]:
    """Every per-reel rule. `others` are the reels to compare against for duplicates."""
    e: list[str] = []
    enums = enums or {n: engine_list(n) for n in ("ACTOR_ANIMS", "PROP_ANIMS", "FX", "SFX", "EMOTES")}
    title = str(reel.get("title") or "")
    if not 8 <= len(title) <= 70:
        e.append("title must be 8-70 characters")
    if reel.get("style") not in STYLES:
        e.append(f"style must be one of {STYLES}")
    if reel.get("backdrop") not in lib["backdrop_ids"]:
        e.append(f"unknown backdrop: {reel.get('backdrop')}")
    beats = reel.get("beats") or []
    if not 3 <= len(beats) <= 7:
        e.append("a reel has 3-7 beats")
    signs = []
    for i, b in enumerate(beats, 1):
        at = f"beat {i}: "
        say = str(b.get("say") or "")
        n = len(words(say))
        if not 2 <= n <= 26:
            e.append(at + f"say has {n} words (2-26 allowed)")
        if len(say) > 170:
            e.append(at + "say is longer than 170 characters")
        if re.search(r"https?://|www\.", say):
            e.append(at + "no URLs in narration")
        if b.get("speaker") and b["speaker"] not in lib["cast_ids"]:
            e.append(at + f"unknown speaker {b['speaker']}")
        actors, props = b.get("actors") or [], b.get("props") or []
        if not actors and not props:
            e.append(at + "empty scene: add at least one actor or prop")
        if len(actors) > 3:
            e.append(at + "at most 3 actors on screen")
        if len(props) > 4:
            e.append(at + "at most 4 props on screen")
        if b.get("speaker") and b["speaker"] not in [a.get("id") for a in actors]:
            e.append(at + f"speaker {b['speaker']} is not on screen")
        for a in actors:
            if a.get("id") not in lib["cast_ids"]:
                e.append(at + f"unknown cast member {a.get('id')}")
            if a.get("anim", "idle") not in enums["ACTOR_ANIMS"]:
                e.append(at + f"unknown actor anim {a.get('anim')}")
            if a.get("emote") and a["emote"] not in enums["EMOTES"]:
                e.append(at + f"unknown emote {a.get('emote')}")
            if not 0 <= a.get("x", 50) <= 100:
                e.append(at + "actor x is a percentage 0-100")
        for p in props:
            if p.get("id") not in lib["prop_ids"]:
                e.append(at + f"unknown prop {p.get('id')}")
            if p.get("anim", "none") not in enums["PROP_ANIMS"]:
                e.append(at + f"unknown prop anim {p.get('anim')}")
            if not 0 <= p.get("x", 50) <= 100 or not 0 <= p.get("y", 50) <= 100:
                e.append(at + "prop x and y are percentages 0-100")
            if not 1 <= p.get("scale", 3) <= 8:
                e.append(at + "prop scale is 1-8")
        if b.get("fx", "none") not in enums["FX"]:
            e.append(at + f"unknown fx {b.get('fx')}")
        if b.get("sfx", "none") not in enums["SFX"]:
            e.append(at + f"unknown sfx {b.get('sfx')}")
        if b.get("sign") is not None:
            if not 1 <= len(str(b["sign"])) <= 18:
                e.append(at + "sign is 1-18 characters")
            signs.append((i, str(b["sign"]).upper()))
        unknown = set(b) - {"say", "speaker", "actors", "props", "sign", "fx", "sfx"}
        if unknown:
            e.append(at + f"unknown fields {sorted(unknown)}")
    secs = speech_seconds(reel)
    if beats and not MIN_SECONDS <= secs <= MAX_SECONDS:
        e.append(f"narration runs {secs:.1f}s ({len(words(narration(reel)))} words); it must be "
                 f"{MIN_SECONDS:.0f}-{MAX_SECONDS:.0f}s (about 38-50 words over 4-6 beats)")
    low = normalize(narration(reel) + " " + title + " " + " ".join(s for _, s in signs))
    for bad in BANNED:
        if re.search(r"\b%s\b" % re.escape(bad), low):
            e.append(f"banned name or phrase: '{bad}'")
    if reel.get("style") == "myth":
        if not 10 <= len(str(reel.get("myth") or "")) <= 160:
            e.append("a myth reel needs a 'myth' field: the false belief, 10-160 characters")
        myth_at = [i for i, s in signs if s.startswith("MYTH")]
        fact_at = [i for i, s in signs if "FACT" in s or "BUSTED" in s]
        if not myth_at or not fact_at or min(myth_at) >= max(fact_at):
            e.append("a myth reel shows a sign starting 'MYTH' on the beat that states the myth and a later "
                     "sign containing 'FACT' or 'BUSTED', so the false claim is never left standing")
    # sources and facts
    sources = reel.get("sources") or []
    paths = [s if isinstance(s, str) else s.get("path") for s in sources]
    if not 1 <= len(paths) <= 3 or len(set(paths)) != len(paths):
        e.append("1-3 distinct source articles")
    facts = reel.get("facts") or []
    if not 1 <= len(facts) <= 4:
        e.append("1-4 facts, one per claim the reel makes")
    bodies: dict[str, str] = {}
    if src is not None:
        for p in paths:
            art = read_article(src, p or "")
            if not art:
                e.append(f"source article not found: {p}")
            else:
                bodies[p] = normalize(str(art[0].get("summary") or "") + " " + art[1])
    for i, f in enumerate(facts, 1):
        at = f"fact {i}: "
        if not 10 <= len(str(f.get("claim") or "")) <= 220:
            e.append(at + "claim must be 10-220 characters")
        if f.get("source") not in paths:
            e.append(at + "source must be one of the reel's source paths")
        ev = normalize(str(f.get("evidence") or ""))
        if not 4 <= len(ev.split()) <= 15:
            e.append(at + "evidence is a 4-15 word phrase copied from the article")
        elif f.get("source") in bodies and ev not in bodies[f["source"]]:
            e.append(at + f"evidence not found word for word in {f['source']}: \"{f.get('evidence')}\"")
    # duplicates
    mine, my_ev = tokens(narration(reel)), {normalize(str(f.get("evidence") or "")) for f in facts}
    for o in others or []:
        if o.get("id") == reel.get("id") or o.get("status") not in IN_FEED:
            continue
        if str(o.get("title", "")).strip().lower() == title.strip().lower():
            e.append(f"same title as {o['id']}")
        sim = jaccard(mine, tokens(narration(o)))
        if sim >= 0.6:
            e.append(f"narration is {sim:.2f} similar to {o['id']} ('{o.get('title')}'): write a different reel")
        shared = my_ev & {normalize(str(f.get('evidence') or '')) for f in o.get("facts") or []}
        if shared and o.get("style") == reel.get("style"):
            e.append(f"same fact and style as {o['id']} ('{o.get('title')}'): use a different fact or style")
    return e
