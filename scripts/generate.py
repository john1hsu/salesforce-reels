#!/usr/bin/env python3
"""Pick what to work on, and add new reels.

  python3 scripts/generate.py pick [--n 4] [--source DIR]
  python3 scripts/generate.py add --input FILE [--source DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import common as c


def coverage(reels):
    per_article, styles, cast, backdrops, domains = Counter(), Counter(), Counter(), Counter(), Counter()
    for _, r in reels:
        if r.get("status") not in c.IN_FEED:
            continue
        for s in r.get("sources") or []:
            per_article[s["path"]] += 1
        for t in r.get("topics") or []:
            domains[t] += 1
        styles[r.get("style")] += 1
        backdrops[r.get("backdrop")] += 1
        for cid in r.get("cast") or []:
            cast[cid] += 1
    return per_article, styles, cast, backdrops, domains


def edges(meta: dict) -> list[str]:
    out = list(meta.get("broader") or []) + list(meta.get("related") or [])
    out += [r.get("object") for r in meta.get("relations") or [] if isinstance(r, dict)]
    seen, uniq = set(), []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def pick(args) -> int:
    src = Path(args.source)
    index = c.read_json(src / "graph" / "index.json")
    reels = c.load_reels()
    lib = c.load_library()
    per_article, styles, cast, backdrops, domains = coverage(reels)

    stale = [r for _, r in reels if r.get("status") == "stale"]
    if stale:
        batch = []
        for r in stale[: args.n * 5]:
            changed = []
            for s in r.get("sources") or []:
                p = src / s["path"]
                changed.append({"path": s["path"], "state": "missing" if not p.is_file() else
                                ("changed" if c.blob_sha(p) != s.get("blob") else "unchanged")})
            batch.append({"id": r["id"], "title": r["title"], "style": r["style"], "sources": changed,
                          "file": f"reels/{(r.get('topics') or ['misc'])[0]}/{r['id']}.json"})
        print(json.dumps({"mode": "refresh", "stale_total": len(stale), "batch": batch}, indent=1))
        return 0

    by_id = {n["id"]: n for n in index}
    dom = Counter(domains)
    chosen, pool = [], [n for n in index if n.get("file")]
    for _ in range(args.n):
        pool = [n for n in pool if n not in chosen]
        if not pool:
            break
        best = min(pool, key=lambda n: (per_article[n["file"]], dom[n.get("domain")], n["id"]))
        chosen.append(best)
        dom[best.get("domain")] += 1
    if not chosen:
        print(json.dumps({"mode": "none"}))
        return 0

    articles = []
    for n in chosen:
        art = c.read_article(src, n["file"])
        neighbours = []
        for eid in edges(art[0] if art else {}):
            m = by_id.get(eid)
            if m and m.get("file"):
                neighbours.append({"id": eid, "title": m["title"], "path": m["file"], "domain": m.get("domain"),
                                   "reels_so_far": per_article[m["file"]]})
        neighbours.sort(key=lambda x: x["reels_so_far"])
        existing = [{"id": r["id"], "title": r["title"], "style": r["style"],
                     "facts": [f.get("claim") for f in r.get("facts") or []]}
                    for _, r in reels if r.get("status") in c.IN_FEED
                    and n["file"] in [s["path"] for s in r.get("sources") or []]]
        articles.append({"path": n["file"], "id": n["id"], "title": n["title"], "domain": n.get("domain"),
                         "status": n.get("status"), "release": n.get("release"), "reels_so_far": per_article[n["file"]],
                         "existing_reels_for_article": existing, "can_combine_with": neighbours[:8]})
    uncovered = sum(1 for n in index if n.get("file") and not per_article[n["file"]])
    print(json.dumps({
        "mode": "generate", "articles": articles,
        "uncovered_articles": uncovered, "total_articles": len(index),
        "styles_so_far": {s: styles[s] for s in c.STYLES},
        "cast_usage": {x["id"]: cast[x["id"]] for x in lib["cast"]},
        "backdrop_usage": {x["id"]: backdrops[x["id"]] for x in lib["backdrops"]},
        "props": sorted(lib["prop_ids"]),
    }, indent=1))
    return 0


def add_reels(items: list[dict], src: Path, supersedes: str | None = None) -> tuple[list[dict], int]:
    """Validate and write new reels. Returns (written reels, number rejected)."""
    lib = c.load_library()
    reels = c.load_reels()
    others = [r for _, r in reels if r.get("id") != supersedes]
    nid, written, bad = c.next_id(reels), [], 0
    for item in items:
        reel = {k: item.get(k) for k in ("title", "style", "backdrop", "beats", "facts", "sources") if item.get(k) is not None}
        if item.get("myth"):
            reel["myth"] = item["myth"]
        label = reel.get("title") or "(untitled)"
        errs = c.stamp_sources(reel, src)
        if not errs:
            reel["cast"] = c.cast_of(reel)
            errs = c.check_reel(reel, lib, src, others)
        if errs:
            bad += 1
            print(f"REJECTED '{label}':", file=sys.stderr)
            for m in errs:
                print(f"  - {m}", file=sys.stderr)
            continue
        ordered = {"id": f"sr-{nid:06d}", "title": reel["title"], "style": reel["style"], "topics": reel["topics"],
                   "backdrop": reel["backdrop"], "cast": reel["cast"]}
        if reel.get("myth"):
            ordered["myth"] = reel["myth"]
        ordered.update({"beats": reel["beats"], "facts": reel["facts"], "sources": reel["sources"],
                        "source_commit": reel["source_commit"], "verified_release": reel["verified_release"],
                        "created": c.today(), "status": "active"})
        if supersedes:
            ordered["supersedes"] = supersedes
        path = c.REELS / (ordered["topics"][0] if ordered["topics"] else "misc") / f"{ordered['id']}.json"
        c.write_json(path, ordered)
        others.append(ordered)
        written.append(ordered)
        nid += 1
        print(f"added {ordered['id']} ({ordered['style']}, {c.speech_seconds(ordered):.1f}s): {ordered['title']}")
    return written, bad


def add(args) -> int:
    data = c.read_json(Path(args.input))
    items = data.get("reels") if isinstance(data, dict) else data
    if not items:
        c.die("input needs a 'reels' list")
    _, bad = add_reels(items, Path(args.source))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pick")
    p.add_argument("--n", type=int, default=4)
    p.add_argument("--source", default=str(c.DEFAULT_SOURCE))
    a = sub.add_parser("add")
    a.add_argument("--input", required=True)
    a.add_argument("--source", default=str(c.DEFAULT_SOURCE))
    args = ap.parse_args()
    return pick(args) if args.cmd == "pick" else add(args)


if __name__ == "__main__":
    sys.exit(main())
