from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np
import requests
import time
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional

app = FastAPI(title="Dynamic Market Anomaly & Sentiment Screener")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CORE_WATCHLIST = ["SPY", "QQQ", "NVDA", "GLD"]
BULLISH_WORDS = {"surge", "soar", "beat", "upgrade", "growth", "rally", "breakout", "record", "buy", "bull", "ai", "profit"}
BEARISH_WORDS = {"drop", "plunge", "miss", "downgrade", "cut", "crash", "lawsuit", "slump", "sell", "bear", "loss", "warn"}

# Yahoo Finance sector and industry names mapped to liquid ETF benchmarks.
SECTOR_BENCHMARKS = {
    "Technology": "XLK",
    "Financial Services": "XLF",
    "Energy": "XLE",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Communication Services": "XLC",
    "Utilities": "XLU",
    "Real Estate": "XLRE",
    "Basic Materials": "XLB",
}
INDUSTRY_BENCHMARKS = {"Semiconductors": "SMH"}
DEFAULT_BENCHMARK = "SPY"
BENCHMARK_SYMBOLS = sorted(
    set(SECTOR_BENCHMARKS.values()) | set(INDUSTRY_BENCHMARKS.values()) | {DEFAULT_BENCHMARK}
)

# Simple in-memory TTL cache: {cache_key: (timestamp, payload)}
CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
CACHE_TTL_SECONDS = 60


def get_dynamic_tickers(custom_tickers: List[str], limit: int = 24) -> List[str]:
    discovered = set(CORE_WATCHLIST + [t.upper().strip() for t in custom_tickers if t.strip()])
    headers = {"User-Agent": "Mozilla/5.0"}
    screener_ids = ["most_actives", "day_gainers", "day_losers"]

    for scr_id in screener_ids:
        try:
            url = f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds={scr_id}&count=10"
            resp = requests.get(url, headers=headers, timeout=5)
            if resp.status_code == 200:
                quotes = resp.json()["finance"]["result"][0]["quotes"]
                for q in quotes:
                    symbol = q.get("symbol", "")
                    if symbol.isalpha() and len(symbol) <= 5:
                        discovered.add(symbol)
        except Exception as e:
            print(f"Screener fetch warning ({scr_id}): {e}")

    # Ensure custom tickers are never sliced off by the limit
    priority = list(dict.fromkeys([t.upper().strip() for t in custom_tickers if t.strip()] + CORE_WATCHLIST))
    others = [t for t in discovered if t not in priority]
    return (priority + others)[:limit]


def calculate_rsi(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1]) if not np.isnan(rsi.iloc[-1]) else 50.0


def calculate_relative_rsi(
    stock_history: pd.DataFrame,
    benchmark_history: pd.DataFrame,
    period: int = 14,
) -> Optional[float]:
    """Calculate RSI on the stock's price relative to its benchmark."""
    common = stock_history.index.intersection(benchmark_history.index)
    if len(common) < period + 1:
        return None

    stock_close = stock_history.loc[common, "Close"]
    benchmark_close = benchmark_history.loc[common, "Close"]
    relative_price = (stock_close / benchmark_close).replace([np.inf, -np.inf], np.nan).dropna()
    if len(relative_price) < period + 1:
        return None
    return calculate_rsi(relative_price, period)


def get_benchmark_symbol(ticker: yf.Ticker) -> str:
    """Use a known industry ETF, otherwise a sector ETF, then SPY."""
    try:
        info = ticker.info or {}
        industry = str(info.get("industry", ""))
        sector = str(info.get("sector", ""))
        for industry_name, benchmark in INDUSTRY_BENCHMARKS.items():
            if industry_name.lower() in industry.lower():
                return benchmark
        return SECTOR_BENCHMARKS.get(sector, DEFAULT_BENCHMARK)
    except Exception:
        return DEFAULT_BENCHMARK


def fetch_benchmark_history(symbol: str) -> tuple[str, pd.DataFrame]:
    try:
        return symbol, yf.Ticker(symbol).history(period="3mo")
    except Exception as e:
        print(f"Benchmark fetch warning ({symbol}): {e}")
        return symbol, pd.DataFrame()


def score_news_sentiment(news_items: List[Dict[str, Any]]) -> tuple[float, str]:
    if not news_items:
        return 0.0, "No recent headlines"

    score = 0
    top_headline = ""
    for idx, item in enumerate(news_items[:5]):
        title = item.get("title") or item.get("content", {}).get("title", "")
        if idx == 0:
            top_headline = title
        words = set(title.lower().replace(":", "").replace(",", "").split())
        score += len(words.intersection(BULLISH_WORDS))
        score -= len(words.intersection(BEARISH_WORDS))

    # Clamped to [-1.0, +1.0]: -1.0 is strongly bearish, 0 is neutral, and +1.0 is strongly bullish.
    normalized = max(-1.0, min(1.0, score / 4.0))
    return round(normalized, 2), top_headline


def analyze_ticker(
    symbol: str,
    is_custom: bool = False,
    benchmark_histories: Optional[Dict[str, pd.DataFrame]] = None,
) -> Dict[str, Any] | None:
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="3mo")
        if len(hist) < 15:
            return None

        current_price = float(hist["Close"].iloc[-1])
        prev_close = float(hist["Close"].iloc[-2])
        pct_change = ((current_price - prev_close) / prev_close) * 100

        current_vol = float(hist["Volume"].iloc[-1])
        avg_vol_20d = float(hist["Volume"].iloc[-21:-1].mean())
        rvol = current_vol / avg_vol_20d if avg_vol_20d > 0 else 1.0

        rsi = calculate_rsi(hist["Close"], 14)
        sentiment_score, top_headline = score_news_sentiment(ticker.news)

        benchmark_symbol = get_benchmark_symbol(ticker)
        benchmark_history = (benchmark_histories or {}).get(benchmark_symbol, pd.DataFrame())
        benchmark_return_20d = None
        excess_return_20d = None
        benchmark_rsi = None
        relative_rsi = None

        if not benchmark_history.empty and benchmark_symbol != symbol:
            common = hist.index.intersection(benchmark_history.index)
            if len(common) >= 21:
                stock_close = hist.loc[common, "Close"]
                benchmark_close = benchmark_history.loc[common, "Close"]
                stock_return = stock_close.pct_change(20).iloc[-1]
                sector_return = benchmark_close.pct_change(20).iloc[-1]
                if pd.notna(stock_return) and pd.notna(sector_return):
                    benchmark_return_20d = round(float(sector_return) * 100, 2)
                    excess_return_20d = round(float(stock_return - sector_return) * 100, 2)
                benchmark_rsi = round(calculate_rsi(benchmark_close, 14), 1)
                rel_rsi = calculate_relative_rsi(hist.loc[common], benchmark_history.loc[common], 14)
                if rel_rsi is not None:
                    relative_rsi = round(rel_rsi, 1)

        rvol_points = min(40, max(0, (rvol - 1.0) * 35))
        rsi_points = min(35, abs(rsi - 50) * 1.4)
        sentiment_points = abs(sentiment_score) * 25
        interesting_score = round(rvol_points + rsi_points + sentiment_points, 1)

        if rvol >= 1.5 and rvol_points >= rsi_points:
            driver_type = "VOLUME_SURGE"
            driver_label = f"Volume Breakout ({rvol:.1f}x Avg)"
        elif rsi >= 70:
            driver_type = "OVERBOUGHT"
            driver_label = f"Overbought Extension (RSI {rsi:.0f})"
        elif rsi <= 30 and benchmark_rsi is not None and benchmark_rsi <= 30 and relative_rsi is not None and relative_rsi > 30:
            driver_type = "SECTOR_WEAKNESS"
            driver_label = f"Sector-Wide Weakness (Stock RSI {rsi:.0f}; Benchmark RSI {benchmark_rsi:.0f})"
        elif rsi <= 30 and relative_rsi is not None and relative_rsi <= 30:
            driver_type = "RELATIVE_OVERSOLD"
            driver_label = f"Peer-Relative Oversold (Relative RSI {relative_rsi:.0f})"
        elif rsi <= 30:
            driver_type = "OVERSOLD"
            driver_label = f"Oversold Reversal Watch (RSI {rsi:.0f})"
        elif abs(sentiment_score) >= 0.4:
            driver_type = "NEWS_CATALYST"
            driver_label = "High News Sentiment" if sentiment_score > 0 else "Negative News Shock"
        else:
            driver_type = "BALANCED"
            driver_label = "Steady Trend"

        return {
            "symbol": symbol,
            "is_custom": is_custom,
            "price": round(current_price, 2),
            "pct_change": round(pct_change, 2),
            "rvol": round(rvol, 2),
            "rsi": round(rsi, 1),
            "benchmark": benchmark_symbol,
            "benchmark_return_20d": benchmark_return_20d,
            "excess_return_20d": excess_return_20d,
            "benchmark_rsi": benchmark_rsi,
            "relative_rsi": relative_rsi,
            "sentiment": sentiment_score,
            "top_headline": top_headline,
            "interesting_score": interesting_score,
            "driver_type": driver_type,
            "driver_label": driver_label,
        }
    except Exception:
        return None


@app.get("/api/interesting-stocks")
def get_interesting_stocks(
    custom: Optional[str] = Query(default="", description="Comma-separated custom tickers"),
    force_refresh: bool = Query(default=False)
):
    custom_list = [t.upper().strip() for t in custom.split(",") if t.strip()]
    cache_key = ",".join(sorted(custom_list))
    now = time.time()

    # Serve from cache if valid and not force-refreshed
    if not force_refresh and cache_key in CACHE:
        cached_time, cached_payload = CACHE[cache_key]
        if now - cached_time < CACHE_TTL_SECONDS:
            return {**cached_payload, "cached": True, "cache_age_sec": int(now - cached_time)}

    tickers = get_dynamic_tickers(custom_list, limit=24)
    custom_set = set(custom_list)

    # Fetch benchmark price histories once per request and reuse them for all stocks.
    with ThreadPoolExecutor(max_workers=8) as executor:
        benchmark_futures = [executor.submit(fetch_benchmark_history, sym) for sym in BENCHMARK_SYMBOLS]
        benchmark_histories = {sym: history for sym, history in (future.result() for future in benchmark_futures)}

    results = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(analyze_ticker, sym, sym in custom_set, benchmark_histories) for sym in tickers]
        for f in futures:
            data = f.result()
            if data:
                results.append(data)

    results.sort(key=lambda x: x["interesting_score"], reverse=True)
    payload = {"count": len(results), "stocks": results, "cached": False, "cache_age_sec": 0}
    CACHE[cache_key] = (now, payload)
    return payload
