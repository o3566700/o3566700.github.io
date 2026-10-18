"""Temporary: explore PChome / momo endpoints from GitHub Actions."""
import json, re, time, urllib.request, urllib.parse
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
def get(url):
    print("=" * 80, "\n", url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-TW"})
        with urllib.request.urlopen(req, timeout=25) as r:
            body = r.read().decode("utf-8", "replace"); print("status", r.status, "len", len(body)); return body
    except Exception as e:
        print("ERR", e); return ""
q = urllib.parse.quote
print(get("https://ecapi-cdn.pchome.com.tw/cdn/ecshop/prodapi/v2/prod/DHAEJA-A900IU6JY&fields=Name,Price,Discount,Qty,isOnSale&_callback=x"))
print(get("https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/DMALG2-A900JLAEV-000&fields=Seq,Id,Name,Nick,Price,Discount,isOnSale,Store,Slogan&_callback=x"))
tot = disc = 0
for kw in ["筆電", "耳機", "滑鼠", "手機"]:
    for page in [1, 2]:
        b = get(f"https://ecshweb.pchome.com.tw/search/v4.3/all/results?q={q(kw)}&page={page}&sort=sale/dc")
        P = json.loads(b).get("Prods") or [] if b else []
        d = [p for p in P if p.get("OriginPrice") and p["Price"] < p["OriginPrice"]]
        tot += len(P); disc += len(d)
        for p in d[:3]: print("  ", kw, p["Price"], p["OriginPrice"], p["Name"][:50])
        time.sleep(0.5)
print("pchome discounted", disc, "/", tot)
b = get(f"https://www.momoshop.com.tw/search/searchShop.jsp?keyword={q('耳機')}&searchType=1&curPage=1")
i = b.find("goodsCode=")
for key in ["goodsName", "goodsPrice", "SALE_PRICE", "salePrice", "goodsPriceOri", "price", "discount", "限時", "timeSale", "goodsSubName", "__NEXT_DATA__", "self.__next_f"]:
    print(key, b.count(key))
for m in re.finditer(r'goodsPrice|SALE_PRICE|salePrice', b):
    print("CTX:", b[max(0, m.start()-600): m.start()+600].replace("\n", " ")); break
print("AROUND goodsCode:", b[max(0, i-1500): i+1500].replace("\n", " "))
