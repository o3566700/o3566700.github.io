"""Temporary: why so few PChome deals?"""
import json, sys, time, urllib.parse
sys.path.insert(0, "scripts")
from shop_deals import fetch, num
for kw in ["耳機", "筆電", "滑鼠", "手機"]:
    for sort in ["sale/dc", "rnk/dc"]:
        ids = []
        for page in (1, 2, 3):
            b = fetch(f"https://ecshweb.pchome.com.tw/search/v4.3/all/results?q={urllib.parse.quote(kw)}&page={page}&sort={sort}")
            ids += [p["Id"] + "-000" for p in json.loads(b).get("Prods") or []]
            time.sleep(0.5)
        got = {}
        for i in range(0, len(ids), 20):
            raw = fetch("https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/" + ",".join(ids[i:i+20]) + "&fields=Id,Price&_callback=x")
            got.update(json.loads(raw[raw.index("x(") + 2: raw.rindex(");}catch")]))
            time.sleep(0.5)
        offs = [1 - num(d["Price"]["P"]) / num(d["Price"]["M"]) for d in got.values() if num(d["Price"].get("M"))]
        print(kw, sort, "ids", len(ids), "prodapi", len(got), "hasM", len(offs),
              "M>P", sum(o > 0 for o in offs), ">=10%", sum(o >= 0.1 for o in offs), ">=5%", sum(o >= 0.05 for o in offs))
        lows = [d for d in got.values() if num(d["Price"].get("Low")) and num(d["Price"]["Low"]) < num(d["Price"]["P"])]
        print("   Low<P:", len(lows), [ (d["Price"]["P"], d["Price"]["Low"], d["Price"].get("DiscountText")) for d in lows[:5]])
