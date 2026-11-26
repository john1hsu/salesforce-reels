#!/usr/bin/env python3
"""Keep reels in step with their source articles.

  python3 scripts/refresh.py mark-stale [--source DIR]      # source article changed or vanished -> stale
  python3 scripts/refresh.py verify <id> [--source DIR]     # still right: re-stamp it as active
  python3 scripts/refresh.py supersede <id> --input FILE    # facts changed: replace with one new reel
  python3 scripts/refresh.py retire <id> --reason "..."     # nothing left to say
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import common as c
from generate import add_reels


def find(rid: str):
    for path, r in c.load_reels():
        if r["id"] == rid:
            return path, r
    c.die(f"no reel {rid}")


def mark_stale(args) -> int:
    src, n = Path(args.source), 0
    for path, r in c.load_reels():
        if r.get("status") != "active":
            continue
        why = []
        for s in r.get("sources") or []:
            p = src / s["path"]
            if not p.is_file():
                why.append(f"{s['path']} is gone")
            elif c.blob_sha(p) != s.get("blob"):
                why.append(f"{s['path']} changed")
        if why:
            r["status"] = "stale"
            c.write_json(path, r)
            n += 1
            print(f"stale {r['id']}: {'; '.join(why)}")
    print(f"{n} reel(s) marked stale")
    return 0


def verify(args) -> int:
    path, r = find(args.id)
    src = Path(args.source)
    errs = c.stamp_sources(r, src)
    if not errs:
        others = [o for _, o in c.load_reels() if o["id"] != r["id"]]
        errs = c.check_reel(r, c.load_library(), src, others)
    if errs:
        print(f"cannot verify {r['id']} (supersede or retire it instead):", file=sys.stderr)
        for m in errs:
            print(f"  - {m}", file=sys.stderr)
        return 1
    r["status"], r["verified"] = "active", c.today()
    c.write_json(path, r)
    print(f"verified {r['id']}")
    return 0


def supersede(args) -> int:
    path, r = find(args.id)
    data = c.read_json(Path(args.input))
    items = data.get("reels") if isinstance(data, dict) else data
    if not items or len(items) != 1:
        c.die("supersede takes exactly one replacement reel")
    written, bad = add_reels(items, Path(args.source), supersedes=r["id"])
    if bad or not written:
        return 1
    r["status"], r["superseded_by"] = "superseded", written[0]["id"]
    c.write_json(path, r)
    print(f"{r['id']} superseded by {written[0]['id']}")
    return 0


def retire(args) -> int:
    path, r = find(args.id)
    r["status"], r["retired_reason"] = "retired", args.reason
    c.write_json(path, r)
    print(f"retired {r['id']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("mark-stale", "verify", "supersede", "retire"):
        p = sub.add_parser(name)
        if name != "mark-stale":
            p.add_argument("id")
        if name == "supersede":
            p.add_argument("--input", required=True)
        if name == "retire":
            p.add_argument("--reason", required=True)
        else:
            p.add_argument("--source", default=str(c.DEFAULT_SOURCE))
    args = ap.parse_args()
    return {"mark-stale": mark_stale, "verify": verify, "supersede": supersede, "retire": retire}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
