#!/usr/bin/env python3
"""Collect discounted 3C items from PChome 24h and momo; write deals/shop.json.

For each keyword we take PChome's best sellers (search API, then the product
API for market vs selling price) and momo's search results (product list
embedded in the server-rendered page). Items are kept when they are at least
MIN_OFF cheaper than their list price and are not same-day flash sales.
Standard library only.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "deals" / "shop.json"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
DELAY = 0.6
MIN_OFF = 0.10
MIN_PRICE = 200
PER_CAT = 80
BUDGET = 8 * 60  # seconds; stop early rather than hold up the workflow

CATEGORIES = {
    "筆電": ["筆電", "電競筆電", "MacBook"],
    "3C": ["螢幕", "SSD", "記憶卡", "隨身碟", "桌上型電腦"],
    "周邊": ["滑鼠", "鍵盤", "耳機", "喇叭", "行動電源", "充電器", "路由器"],
    "通訊": ["手機", "iPhone", "三星 手機", "智慧手錶"],
    "數位": ["平板", "iPad", "相機", "Switch", "電子書閱讀器"],
}
# Same-day flash sales the user does not want.
FLASH = re.compile(r"限時|今日|今天|當日|搶購|倒數|閃購|快閃|整點|秒殺|限量搶")
# Keyword search drags in non-3C things ("平板" → 平板夾 hair straightener) and cases/films.
NOISE = re.compile(r"離子夾|平板夾|直髮|捲髮|吹風機|驗鈔|保護貼|保護膜|玻璃貼|鋼化膜|手機殼|保護殼|保護套|皮套|包膜")
REFURB = re.compile(r"福利品|福利機|整新|二手|展示機|拆封|九成新|近全新")
MAX_OFF = 0.85  # beyond this the "original price" is almost always made up


def fetch(url, data=None, headers=None):
    h = {"User-Agent": UA, "Accept-Language": "zh-TW"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if attempt == 1:
                raise
            print(f"retry {url[:80]}: {e}", flush=True)
            time.sleep(3)


def num(s):
    m = re.search(r"\d[\d,]*", str(s or ""))
    return int(m.group(0).replace(",", "")) if m else 0


def pchome(keyword, cat):
    ids, names = [], {}
    for page in (1, 2):
        url = ("https://ecshweb.pchome.com.tw/search/v4.3/all/results?q="
               f"{urllib.parse.quote(keyword)}&page={page}&sort=sale/dc")
        for p in json.loads(fetch(url)).get("Prods") or []:
            pid = p["Id"] + "-000"
            if pid not in names:
                ids.append(pid)
                names[pid] = p
        time.sleep(DELAY)
    items = []
    for i in range(0, len(ids), 20):
        batch = ids[i:i + 20]
        url = ("https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/" + ",".join(batch)
               + "&fields=Id,Name,Price,isOnSale,Slogan&_callback=x")
        raw = fetch(url)
        info = json.loads(raw[raw.index("x(") + 2: raw.rindex(");}catch")])
        for pid, d in info.items():
            pr = d.get("Price") or {}
            price, ori = num(pr.get("P")), num(pr.get("M"))
            low = num(pr.get("Low"))
            s = names.get(pid, {})
            items.append({
                "site": "PChome", "cat": cat, "id": pid,
                "name": d.get("Name") or s.get("Name", ""),
                "sub": " ".join(filter(None, [pr.get("DiscountText"), d.get("Slogan") if isinstance(d.get("Slogan"), str) else ""])),
                "price": price, "ori": ori, "low": low if 0 < low < price else 0,
                "url": "https://24h.pchome.com.tw/prod/" + pid.rsplit("-", 1)[0],
                "img": ("https://img.pchome.com.tw/cs" + s["PicS"]) if s.get("PicS") else "",
            })
        time.sleep(DELAY)
    return items


def momo_goods(html):
    """Decode the Next.js flight payload and pull out goodsInfoList."""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
    text = "".join(json.loads(c) for c in chunks)
    out = []
    dec = json.JSONDecoder()
    for m in re.finditer(r'"goodsInfoList":\[', text):
        try:
            arr, _ = dec.raw_decode(text, m.end() - 1)
            out.extend(g for g in arr if isinstance(g, dict))
        except ValueError:
            continue
    return out


def momo(keyword, cat):
    url = ("https://www.momoshop.com.tw/search/searchShop.jsp?keyword="
           f"{urllib.parse.quote(keyword)}&searchType=1&curPage=1")
    items = []
    for g in momo_goods(fetch(url)):
        code = g.get("goodsCode")
        if not code:
            continue
        items.append({
            "site": "momo", "cat": cat, "id": code,
            "name": g.get("goodsName", ""), "sub": g.get("goodsSubName", ""),
            "price": num(g.get("goodsPrice")), "ori": num(g.get("goodsPriceOri")), "low": 0,
            "url": f"https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code={code}",
            "img": g.get("imgUrl", ""),
        })
    time.sleep(DELAY)
    return items


def main():
    found, errors = {}, []
    start = time.time()
    for cat, keywords in CATEGORIES.items():
        for kw in keywords:
            for site, fn in (("PChome", pchome), ("momo", momo)):
                if time.time() - start > BUDGET:
                    errors.append(f"time budget reached before {site} {kw}")
                    continue
                try:
                    got = fn(kw, cat)
                except Exception as e:  # noqa: BLE001 - keep going with the other site
                    errors.append(f"{site} {kw}: {e}")
                    print(errors[-1], flush=True)
                    continue
                print(f"{site} {kw}: {len(got)} items ({time.time() - start:.0f}s)", flush=True)
                for it in got:
                    if it["price"] < MIN_PRICE or not it["ori"] or it["price"] > it["ori"] * (1 - MIN_OFF):
                        continue
                    text = it["name"] + " " + it["sub"]
                    if FLASH.search(text) or NOISE.search(text):
                        continue
                    it["off"] = round(1 - it["price"] / it["ori"], 3)
                    if it["off"] > MAX_OFF:
                        continue
                    it["refurb"] = bool(REFURB.search(it["name"]))
                    found.setdefault((it["site"], it["id"]), it)
    by_cat = {}
    for it in found.values():
        by_cat.setdefault((it["site"], it["cat"]), []).append(it)
    items = []
    for group in by_cat.values():
        items += sorted(group, key=lambda x: -x["off"])[:PER_CAT]
    items.sort(key=lambda x: -x["off"])
    OUT.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "errors": errors[:20],
        "items": items,
    }, ensure_ascii=False, indent=1) + "\n", "utf-8")
    counts = {}
    for it in items:
        counts[it["site"]] = counts.get(it["site"], 0) + 1
    print(f"{len(items)} items {counts}, {len(errors)} errors -> {OUT}")
    if not items:
        sys.exit(1)


if __name__ == "__main__":
    main()
