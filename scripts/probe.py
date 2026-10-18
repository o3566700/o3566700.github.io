"""Temporary: explore PChome / momo endpoints from GitHub Actions."""
import re, sys, urllib.request, urllib.parse
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
def get(url, n=1500, grep=None):
    print("=" * 80, "\n", url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-TW"})
        with urllib.request.urlopen(req, timeout=25) as r:
            body = r.read().decode("utf-8", "replace")
            print("status", r.status, "len", len(body), r.headers.get("content-type"))
    except Exception as e:
        print("ERR", e); return ""
    if grep:
        for m in sorted(set(re.findall(grep, body)))[:120]: print("  ", m)
    else:
        print(body[:n])
    return body
q = urllib.parse.quote
get("https://24h.pchome.com.tw/", grep=r'href="([^"]*(?:region|store)/[A-Z0-9]+[^"]*)"[^>]*>([^<]{0,20})')
get("https://24h.pchome.com.tw/", n=0, grep=r'(?:region|store)/([A-Z]{4}[A-Z0-9]*)')
get(f"https://ecshweb.pchome.com.tw/search/v4.3/all/results?q={q('筆電')}&page=1&sort=sale/dc", 2500)
get(f"https://ecshweb.pchome.com.tw/search/v3.3/all/results?q={q('筆電')}&page=1&sort=sale/dc", 1500)
get("https://24h.pchome.com.tw/region/DHAA", 0, grep=r'(?:store|region|prod)/([A-Z0-9-]{4,})')
get("https://www.momoshop.com.tw/main/Main.jsp", 800, grep=r'(?:l_code|d_code|cn)=([0-9A-Za-z]+)[^"]*"[^>]*>([^<]{0,15})')
get("https://m.momoshop.com.tw/main.momo", 800, grep=r'(?:cn|l_code)=([0-9A-Za-z]+)[^"]*"[^>]*>([^<]{0,15})')
get(f"https://m.momoshop.com.tw/search.momo?searchKeyword={q('筆電')}", 2000)
