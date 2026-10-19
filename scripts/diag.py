"""Temporary: find a PChome product API form that accepts many ids."""
import json, sys, time, urllib.parse
sys.path.insert(0, "scripts")
from shop_deals import fetch
b = fetch(f"https://ecshweb.pchome.com.tw/search/v4.3/all/results?q={urllib.parse.quote('耳機')}&page=1&sort=sale/dc")
ids = [p["Id"] for p in json.loads(b)["Prods"]][:20]
base = "https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod"
variants = {
    "prod&id=,-000": f"{base}&id={','.join(i + '-000' for i in ids)}&fields=Id,Price&_callback=x",
    "prod&id=,": f"{base}&id={','.join(ids)}&fields=Id,Price&_callback=x",
    "button&id=,-000": f"{base}/button&id={','.join(i + '-000' for i in ids)}&fields=Id,Price&_callback=x",
    "button&id=,": f"{base}/button&id={','.join(ids)}&fields=Id,Price&_callback=x",
    "path ,-000": f"{base}/{','.join(i + '-000' for i in ids)}&fields=Id,Price&_callback=x",
    "path , (no suffix)": f"{base}/{','.join(ids)}&fields=Id,Price&_callback=x",
    "ecapi prod&id": f"https://ecapi.pchome.com.tw/ecshop/prodapi/v2/prod&id={','.join(i + '-000' for i in ids)}&fields=Id,Price&_callback=x",
}
for name, url in variants.items():
    try:
        raw = fetch(url)
        body = raw[raw.index("x(") + 2: raw.rindex(");}catch")]
        d = json.loads(body)
        n = len(d) if isinstance(d, (dict, list)) else 0
        print(f"{name}: {n} of {len(ids)}", str(d)[:200])
    except Exception as e:
        print(f"{name}: ERR {e}")
    time.sleep(0.5)
