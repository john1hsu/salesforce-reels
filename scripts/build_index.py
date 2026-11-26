#!/usr/bin/env python3
"""Rebuild index/manifest.json (what the app loads) and coverage/coverage.json.

  python3 scripts/build_index.py           # write both
  python3 scripts/build_index.py --check   # fail if either is out of date
"""
from __future__ import annotations

import json
import sys
from collections import Counter

import common as c


def build():
    reels = c.load_reels()
    feed = [(p, r) for p, r in reels if r.get("status") in c.IN_FEED]
    manifest = {"count": len(feed), "reels": [
        {"id": r["id"], "file": f"{p.parent.name}/{p.name}", "style": r["style"], "topics": r.get("topics") or [],
         "cast": r.get("cast") or []} for p, r in feed]}
    per_article, styles, cast, backdrops, domains, status = Counter(), Counter(), Counter(), Counter(), Counter(), Counter()
    for _, r in reels:
        status[r.get("status")] += 1
    for _, r in feed:
        for s in r.get("sources") or []:
            per_article[s["path"]] += 1
        for t in r.get("topics") or []:
            domains[t] += 1
        styles[r["style"]] += 1
        backdrops[r["backdrop"]] += 1
        for cid in r.get("cast") or []:
            cast[cid] += 1
    cov = {"reels_in_feed": len(feed), "by_status": dict(sorted(status.items())),
           "articles_covered": len(per_article), "by_style": dict(sorted(styles.items())),
           "by_topic": dict(sorted(domains.items())), "by_cast": dict(sorted(cast.items())),
           "by_backdrop": dict(sorted(backdrops.items())), "by_article": dict(sorted(per_article.items()))}
    return manifest, cov


def main() -> int:
    manifest, cov = build()
    if "--check" in sys.argv:
        ok = True
        for path, data in ((c.MANIFEST, manifest), (c.COVERAGE, cov)):
            if not path.is_file() or json.loads(path.read_text(encoding="utf-8")) != data:
                print(f"out of date: {path.relative_to(c.ROOT)} (run scripts/build_index.py)", file=sys.stderr)
                ok = False
        print("index OK" if ok else "index out of date")
        return 0 if ok else 1
    c.write_manifest(c.MANIFEST, manifest)
    c.write_json(c.COVERAGE, cov)
    print(f"index built: {manifest['count']} reels in the feed, {cov['articles_covered']} articles covered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
