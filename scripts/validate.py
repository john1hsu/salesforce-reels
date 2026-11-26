#!/usr/bin/env python3
"""Run every check on the library and the reels. Prints OK or the problems.

  python3 scripts/validate.py                 # structure, length, duplicates, render test
  python3 scripts/validate.py --source DIR    # also: sources exist and are unchanged, and every
                                              # fact's evidence is found in its article

The four checks every reel passes before it is committed:
  1. fact check   each fact quotes a 4-15 word phrase that appears in its source article
  2. duplicates   no repeated title, near-identical narration, or same fact in the same style
  3. length       narration fits 15-20 seconds
  4. render test  the engine plays every beat of every reel without an error (needs node)
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

import common as c


def check_library(lib: dict) -> list[str]:
    e = []
    for kind, key in (("cast", "cast"), ("prop", "props"), ("backdrop", "backdrops")):
        ids = [x.get("id") for x in lib[key]]
        for i in ids:
            if not re.fullmatch(r"[a-z][a-z0-9-]{1,30}", str(i)):
                e.append(f"{kind} id '{i}' must be lowercase letters, digits and hyphens")
        for d in {i for i in ids if ids.count(i) > 1}:
            e.append(f"duplicate {kind} id '{d}'")
    hair, acc, kinds, ops = (c.engine_list(n) for n in ("HAIR", "ACCESSORIES", "KINDS", "BACKDROP_OPS"))
    names = []
    for ch in lib["cast"]:
        at = f"cast {ch.get('id')}: "
        for f in ("name", "role", "personality"):
            if not ch.get(f):
                e.append(at + f"missing {f}")
        names.append(str(ch.get("name", "")).lower())
        if any(re.search(r"\b%s\b" % re.escape(b), str(ch.get("name", "")).lower()) for b in c.BANNED):
            e.append(at + "name is on the banned list (no Salesforce mascots)")
        if ch.get("kind", "human") not in kinds:
            e.append(at + f"kind must be one of {kinds}")
        if ch.get("kind", "human") == "human" and ch.get("hair", "short") not in hair:
            e.append(at + f"hair must be one of {hair}")
        for a in ch.get("accessories") or []:
            if a not in acc:
                e.append(at + f"unknown accessory {a}")
        for k, v in ch.items():
            if k in ("hairColor", "skin", "shirt", "pants", "shoes", "body", "eye", "trim", "tie", "scarf", "hat", "cape") \
                    and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(v)):
                e.append(at + f"{k} must be a #rrggbb colour")
    for d in {n for n in names if names.count(n) > 1}:
        e.append(f"two cast members are both named '{d}'")
    for p in lib["props"]:
        at = f"prop {p.get('id')}: "
        rows = p.get("rows") or []
        if not 3 <= len(rows) <= 24:
            e.append(at + "3-24 rows")
            continue
        if len({len(r) for r in rows}) != 1 or not 3 <= len(rows[0]) <= 24:
            e.append(at + "rows must all be the same width, 3-24")
        for ch in set("".join(rows)) - {"."}:
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str((p.get("palette") or {}).get(ch, ""))):
                e.append(at + f"palette has no #rrggbb colour for '{ch}'")
        if len(set("".join(rows)) - {"."}) > 12:
            e.append(at + "at most 12 colours")
    for b in lib["backdrops"]:
        at = f"backdrop {b.get('id')}: "
        if not isinstance(b.get("ground"), (int, float)) or not 190 <= b["ground"] <= 250:
            e.append(at + "ground is a y position between 190 and 250")
        for layer in b.get("layers") or []:
            if layer.get("op") not in ops:
                e.append(at + f"unknown op {layer.get('op')}")
            if layer.get("op") == "prop" and layer.get("id") not in lib["prop_ids"]:
                e.append(at + f"unknown prop {layer.get('id')}")
    return e


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", help="path to a clone of the source knowledge graph")
    ap.add_argument("--no-render", action="store_true", help="skip the node render test")
    args = ap.parse_args()
    src = Path(args.source) if args.source else None
    lib = c.load_library()
    errors = check_library(lib)
    reels = c.load_reels()
    everything = [r for _, r in reels]
    enums = {n: c.engine_list(n) for n in ("ACTOR_ANIMS", "PROP_ANIMS", "FX", "SFX", "EMOTES")}
    ids = [r.get("id") for r in everything]
    for d in {i for i in ids if ids.count(i) > 1}:
        errors.append(f"duplicate reel id {d}")
    for path, r in reels:
        at = f"{path.relative_to(c.ROOT)}: "
        if path.stem != r.get("id") or not re.fullmatch(r"sr-\d{6}", str(r.get("id"))):
            errors.append(at + "file name must equal the id (sr-000000)")
        if r.get("status") not in c.STATUSES:
            errors.append(at + f"status must be one of {c.STATUSES}")
            continue
        for f in ("title", "style", "topics", "backdrop", "cast", "beats", "facts", "sources", "created", "verified_release"):
            if r.get(f) in (None, "", []) and not (f == "cast"):
                errors.append(at + f"missing {f}")
        if r.get("topics") and path.parent.name != r["topics"][0]:
            errors.append(at + "folder must be the first topic")
        if r.get("cast") != c.cast_of(r):
            errors.append(at + "cast does not match the actors in the beats")
        if r["status"] == "superseded" and r.get("superseded_by") not in ids:
            errors.append(at + "superseded_by must name an existing reel")
        if r["status"] not in c.IN_FEED:
            continue
        # a stale reel is waiting for a refresh: its source is expected to differ, so only check its shape
        check_src = src if r["status"] == "active" else None
        for m in c.check_reel(r, lib, check_src, everything, enums):
            errors.append(at + m)
        if check_src is not None:
            for s in r.get("sources") or []:
                p = src / s["path"]
                if p.is_file() and c.blob_sha(p) != s.get("blob"):
                    errors.append(at + f"{s['path']} changed since this reel was verified "
                                       "(run scripts/refresh.py mark-stale first)")
    if not args.no_render:
        node = shutil.which("node")
        if not node:
            errors.append("render test needs node on PATH (or pass --no-render)")
        else:
            res = subprocess.run([node, str(c.ROOT / "scripts" / "render_test.js")], capture_output=True, text=True)
            if res.returncode != 0:
                errors += [f"render test: {line}" for line in (res.stdout + res.stderr).strip().splitlines()[-25:]]
    if errors:
        for m in errors:
            print(f"- {m}")
        print(f"FAILED: {len(errors)} problem(s)")
        return 1
    feed = sum(1 for r in everything if r.get("status") in c.IN_FEED)
    print(f"OK: {feed} reels in the feed, {len(lib['cast'])} cast, {len(lib['props'])} props, "
          f"{len(lib['backdrops'])} backdrops" + ("" if src else " (sources not checked)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
