"""Temporary: explore PChome / momo endpoints from GitHub Actions."""
import json, re, urllib.request, urllib.parse
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
def get(url, data=None, headers=None):
    print("=" * 80, "\n", url)
    h = {"User-Agent": UA, "Accept-Language": "zh-TW"}; h.update(headers or {})
    try:
        req = urllib.request.Request(url, data=data, headers=h)
        with urllib.request.urlopen(req, timeout=25) as r:
            body = r.read().decode("utf-8", "replace")
            print("status", r.status, "len", len(body), r.headers.get("content-type")); return body
    except Exception as e:
        print("ERR", e, getattr(e, "read", lambda: b"")()[:300]); return ""
q = urllib.parse.quote
# PChome: which items are discounted, which fields exist
for sort in ["sale/dc", "new/dc", "prc/ac"]:
    b = get(f"https://ecshweb.pchome.com.tw/search/v4.3/all/results?q={q('耳機')}&page=1&sort={sort}")
    if b:
        d = json.loads(b); P = d.get("Prods") or []
        print("keys:", list(d.keys())); print("prod keys:", list(P[0].keys()) if P else None)
        disc = [p for p in P if p.get("OriginPrice") and p["Price"] < p["OriginPrice"]]
        print(f"{len(disc)}/{len(P)} discounted")
        for p in disc[:6]: print("  ", p["Id"], p["Price"], p["OriginPrice"], p["Name"][:60], p.get("PCateId"))
b = get(f"https://ecshweb.pchome.com.tw/search/v4.3/all/results?q={q('限時搶購 耳機')}&page=1&sort=sale/dc")
if b: print([p["Name"][:50] for p in json.loads(b).get("Prods", [])[:8]])
get("https://ecapi-cdn.pchome.com.tw/cdn/ecshop/prodapi/v2/prod/DHAEJA-A900IU6JY&fields=Name,Price,Discount,Qty,isOnSale&_callback=x")
# momo desktop
b = get("https://www.momoshop.com.tw/main/Main.jsp")
print(sorted(set(re.findall(r'(?:LgrpCategory|DgrpCategory|CategoryMain)[^"\']{0,80}', b)))[:40])
print(sorted(set(re.findall(r'https?://[a-z0-9.]*momoshop\.com\.tw/[a-zA-Z/]+', b)))[:40])
print(b[:1500])
b = get(f"https://www.momoshop.com.tw/search/searchShop.jsp?keyword={q('耳機')}&searchType=1&curPage=1")
print(re.findall(r'goodsCode=\d+', b)[:5], b[:800] if b else "")
payload = {"host": "momoshop", "flag": "searchEngine", "data": {"searchValue": "耳機", "searchType": "1", "cateLevel": "-1", "curPage": "1", "priceS": "0", "priceE": "9999999", "isFuzzy": "0", "showType": "chessboardType", "isBrandCategory": "N", "serviceCode": "MT01"}}
b = get("https://apisearch.momoshop.com.tw/momoSearchCloud/moec/textSearch", json.dumps(payload).encode(), {"Content-Type": "application/json", "Origin": "https://www.momoshop.com.tw", "Referer": "https://www.momoshop.com.tw/"})
print(b[:2500])
