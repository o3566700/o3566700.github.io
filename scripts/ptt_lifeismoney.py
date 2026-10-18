#!/usr/bin/env python3
"""Scrape PTT Lifeismoney (省錢板) and write deals/data.json.

Only uses the standard library so the GitHub Action needs no installs.
Article bodies are cached in the previous data.json, so each run only
downloads posts it has not seen before; push counts are refreshed from
the board index every run.
"""
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BOARD = "Lifeismoney"
BASE = "https://www.ptt.cc"
OUT = Path(__file__).resolve().parent.parent / "deals" / "data.json"
KEEP_DAYS = 30
MAX_PAGES = 60
DELAY = 0.4
# Categories that are rarely a deal; still listed but bodies are not fetched.
SKIP_BODY = {"問題", "公告", "閒聊", "討論"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (personal deals digest; github.com/o3566700)",
    "Cookie": "over18=1",
}


def fetch(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - retry on anything network-ish
            if attempt == 3:
                raise
            print(f"retry {path}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s))


def parse_push(s):
    s = s.strip()
    if s == "爆":
        return 100
    if s.startswith("XX"):
        return -100
    if s.startswith("X") and s[1:].isdigit():
        return -10 * int(s[1:])
    return int(s) if s.isdigit() else 0


def parse_index(page):
    # Pinned posts on the newest page sit below r-list-sep; drop them.
    page = page.split('<div class="r-list-sep"></div>')[0]
    posts = []
    for block in re.findall(r'<div class="r-ent">(.*?)<div class="mark">', page, re.S):
        link = re.search(r'<a href="(/bbs/[^"]+/(M\.(\d+)\.A\.[0-9A-F]+)\.html)">(.*?)</a>', block, re.S)
        if not link:
            continue  # deleted post
        path, pid, ts, raw_title = link.groups()
        title = strip_tags(raw_title).strip()
        nrec = re.search(r'<div class="nrec">(.*?)</div>', block, re.S)
        author = re.search(r'<div class="author">(.*?)</div>', block, re.S)
        cat = re.match(r"^(?:Re:\s*|Fw:\s*)?\[([^\]]+)\]", title)
        posts.append({
            "id": pid,
            "title": title,
            "category": cat.group(1).strip() if cat else "",
            "reply": title.startswith(("Re:", "Fw:")),
            "push": parse_push(strip_tags(nrec.group(1)) if nrec else ""),
            "author": strip_tags(author.group(1)).strip() if author else "",
            "url": BASE + path,
            "ts": int(ts),
        })
    prev = re.search(r'<a class="btn wide" href="(/bbs/[^"]+/index\d+\.html)">[^<]*上頁', page)
    return posts, prev.group(1) if prev else None


IMG_RE = re.compile(r"\.(jpe?g|png|gif|webp)(\?|$)", re.I)
PERIOD_RE = re.compile(r"(活動(?:期間|時間|日期)|期限|截止|優惠(?:期間|時間)|即日起)[^\n]{0,60}")


def parse_article(page):
    m = re.search(r'<div id="main-content"[^>]*>(.*)', page, re.S)
    if not m:
        return "", "", []
    body = m.group(1)
    body = re.sub(r'<div class="article-metaline(?:-right)?">.*?</div>', "", body, flags=re.S)
    body = body.split('<span class="f2">※ 發信站')[0]
    links = re.findall(r'<a href="(https?://[^"]+)"', body)
    text = strip_tags(body)
    text = text.split("\n--\n")[0]
    lines = [ln.strip() for ln in text.splitlines()]
    text = "\n".join(ln for ln in lines if ln)
    period = PERIOD_RE.search(text)
    snippet = re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", text)).strip()[:220]
    seen, uniq = set(), []
    for u in links:
        if u not in seen and "ptt.cc" not in u and "imgur" not in u and not IMG_RE.search(u):
            seen.add(u)
            uniq.append(u)
    return snippet, period.group(0).strip() if period else "", uniq[:3]


def main():
    old = {}
    if OUT.exists():
        try:
            old = {p["id"]: p for p in json.loads(OUT.read_text("utf-8")).get("posts", [])}
        except (ValueError, KeyError):
            old = {}

    cutoff = time.time() - KEEP_DAYS * 86400
    path = f"/bbs/{BOARD}/index.html"
    found = {}
    for _ in range(MAX_PAGES):
        posts, prev = parse_index(fetch(path))
        for p in posts:
            if p["ts"] >= cutoff:
                found[p["id"]] = p
        if not prev or (posts and max(p["ts"] for p in posts) < cutoff):
            break
        path = prev
        time.sleep(DELAY)

    fetched = 0
    for p in found.values():
        cached = old.get(p["id"])
        if cached and "snippet" in cached:
            for k in ("snippet", "period", "links"):
                p[k] = cached.get(k, "" if k != "links" else [])
            continue
        if p["category"] in SKIP_BODY or p["reply"]:
            p.update(snippet="", period="", links=[])
            continue
        try:
            p["snippet"], p["period"], p["links"] = parse_article(fetch(p["url"][len(BASE):]))
            fetched += 1
        except Exception as e:  # noqa: BLE001 - one bad article shouldn't kill the run
            print(f"skip body {p['id']}: {e}", file=sys.stderr)
        time.sleep(DELAY)

    posts = sorted(found.values(), key=lambda p: p["ts"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "board": BOARD,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "posts": posts,
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{len(posts)} posts, {fetched} new bodies -> {OUT}")


if __name__ == "__main__":
    main()
