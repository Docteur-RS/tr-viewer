#!/usr/bin/env python3
"""Serveur TR Viewer : fichiers statiques + proxy Yahoo Finance pour les cours en direct."""

import json
import time
import urllib.request
import urllib.parse
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

_TICKER_CACHE = {}


def _yahoo_request(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def resolve_isin(isin):
    if isin in _TICKER_CACHE:
        return _TICKER_CACHE[isin]
    try:
        data = _yahoo_request(
            f"https://query1.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(isin)}&quotesCount=5"
        )
        european_exchanges = (".PA", ".DE", ".MI", ".AS", ".BR", ".LS", ".MC", ".SW")
        for q in data.get("quotes", []):
            sym = q.get("symbol", "")
            if any(sym.endswith(ex) for ex in european_exchanges):
                _TICKER_CACHE[isin] = sym
                return sym
        for q in data.get("quotes", []):
            sym = q.get("symbol", "")
            qtype = q.get("quoteType", "")
            if qtype in ("EQUITY", "ETF") and "." not in sym:
                _TICKER_CACHE[isin] = sym
                return sym
        if data.get("quotes"):
            sym = data["quotes"][0].get("symbol", "")
            _TICKER_CACHE[isin] = sym
            return sym
    except Exception:
        pass
    return None


def fetch_quote(ticker):
    data = _yahoo_request(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}"
        f"?interval=1d&range=5d"
    )
    result = data["chart"]["result"][0]
    meta = result["meta"]
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
    prev_close = meta.get("chartPreviousClose", meta.get("previousClose", 0))
    price = meta.get("regularMarketPrice", 0)
    daily_change = ((price - prev_close) / prev_close * 100) if prev_close else 0
    return {
        "price": price,
        "currency": meta.get("currency", "USD"),
        "ticker": ticker,
        "dailyChange": round(daily_change, 2),
        "previousClose": prev_close,
    }


def fetch_fx(base="USD", quote="EUR"):
    ticker = f"{base}{quote}=X"
    try:
        data = _yahoo_request(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d"
        )
        result = data["chart"]["result"][0]
        return result["meta"].get("regularMarketPrice", 1.0)
    except Exception:
        return 1.0


def fetch_history(ticker, start_ts, end_ts):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}"
        f"?interval=1d&period1={int(start_ts)}&period2={int(end_ts)}"
    )
    data = _yahoo_request(url)
    result = data["chart"]["result"][0]
    timestamps = result.get("timestamp", [])
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
    currency = result["meta"].get("currency", "USD")
    history = []
    for ts, c in zip(timestamps, closes):
        if c is not None:
            history.append({"date": time.strftime("%Y-%m-%d", time.gmtime(ts)), "close": c})
    return {"currency": currency, "history": history}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/quotes"):
            self._handle_quotes()
        elif self.path.startswith("/api/fx"):
            self._handle_fx()
        elif self.path.startswith("/api/history"):
            self._handle_history()
        else:
            super().do_GET()

    def _handle_quotes(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        isins = params.get("isin", [])
        results = {}
        for isin in isins:
            ticker = resolve_isin(isin)
            if ticker:
                try:
                    results[isin] = fetch_quote(ticker)
                except Exception as e:
                    results[isin] = {"error": str(e)}
            else:
                results[isin] = {"error": "ISIN not found on Yahoo Finance"}
        self._json(results)

    def _handle_fx(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        base = params.get("base", ["USD"])[0]
        quote = params.get("quote", ["EUR"])[0]
        rate = fetch_fx(base, quote)
        self._json({"rate": rate, "pair": f"{base}{quote}"})

    def _handle_history(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        isin = params.get("isin", [""])[0]
        start = params.get("start", [""])[0]
        end = params.get("end", [""])[0]
        if not isin or not start or not end:
            self._json({"error": "Missing isin, start or end parameter"})
            return
        ticker = resolve_isin(isin)
        if not ticker:
            self._json({"error": "ISIN not found on Yahoo Finance"})
            return
        try:
            start_ts = time.mktime(time.strptime(start, "%Y-%m-%d"))
            end_ts = time.mktime(time.strptime(end, "%Y-%m-%d")) + 86400
            result = fetch_history(ticker, start_ts, end_ts)
            self._json(result)
        except Exception as e:
            self._json({"error": str(e)})

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = 8080
    server = HTTPServer(("localhost", port), Handler)
    print(f"TR Viewer -> http://localhost:{port}")
    server.serve_forever()
