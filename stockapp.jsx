import React, { useState, useEffect, useCallback } from 'react';

const DRIVER_STYLES = {
  VOLUME_SURGE: {
    border: 'border-amber-500 bg-amber-950/20',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    accent: 'text-amber-400',
  },
  OVERBOUGHT: {
    border: 'border-rose-500 bg-rose-950/20',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    accent: 'text-rose-400',
  },
  OVERSOLD: {
    border: 'border-emerald-500 bg-emerald-950/20',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    accent: 'text-emerald-400',
  },
  NEWS_CATALYST: {
    border: 'border-sky-500 bg-sky-950/20',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    accent: 'text-sky-400',
  },
  BALANCED: {
    border: 'border-slate-700 bg-slate-900/60',
    badge: 'bg-slate-800 text-slate-300 border-slate-700',
    accent: 'text-slate-300',
  },
};

export default function App() {
  const [stocks, setStocks] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [tickerInput, setTickerInput] = useState('');
  const [customTickers, setCustomTickers] = useState(() => {
    try {
      const saved = localStorage.getItem('custom_scanner_tickers');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [cacheInfo, setCacheInfo] = useState({ cached: false, age: 0 });

  // Persist custom tickers to localStorage
  useEffect(() => {
    localStorage.setItem('custom_scanner_tickers', JSON.stringify(customTickers));
  }, [customTickers]);

  const fetchMarketData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (customTickers.length > 0) {
          params.set('custom', customTickers.join(','));
        }
        if (forceRefresh) {
          params.set('force_refresh', 'true');
        }

        const res = await fetch(
          `http://localhost:8000/api/interesting-stocks?${params.toString()}`
        );
        const data = await res.json();
        setStocks(data.stocks || []);
        setCacheInfo({
          cached: Boolean(data.cached),
          age: data.cache_age_sec || 0,
        });
      } catch (err) {
        console.error('Failed to fetch scanner data:', err);
      } finally {
        setLoading(false);
      }
    },
    [customTickers]
  );

  useEffect(() => {
    fetchMarketData(false);
  }, [fetchMarketData]);

  const handleAddTicker = (e) => {
    e.preventDefault();
    const cleaned = tickerInput.toUpperCase().replace(/[^A-Z]/g, '');
    if (cleaned && cleaned.length <= 5 && !customTickers.includes(cleaned)) {
      setCustomTickers((prev) => [...prev, cleaned]);
    }
    setTickerInput('');
  };

  const handleRemoveTicker = (symbolToRemove) => {
    setCustomTickers((prev) => prev.filter((sym) => sym !== symbolToRemove));
  };

  const filteredStocks =
    filter === 'ALL'
      ? stocks
      : filter === 'PINNED'
      ? stocks.filter((s) => s.is_custom)
      : stocks.filter((s) => s.driver_type === filter);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <div className="max-w-6xl mx-auto">
        {/* Top Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-6 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                Market Anomaly & Sentiment Radar
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400">
                {cacheInfo.cached ? `Cached (${cacheInfo.age}s ago)` : 'Live Scan'}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Auto-discovering active movers + custom watchlist ranked by RVOL, RSI-14, and News Polarity
            </p>
          </div>

          {/* Custom Ticker Injection Form */}
          <form onSubmit={handleAddTicker} className="flex items-center gap-2">
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Inject ticker (e.g. PLTR)"
              maxLength={5}
              className="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 uppercase font-mono w-48"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition"
            >
              + Track
            </button>
            <button
              type="button"
              onClick={() => fetchMarketData(true)}
              title="Bypass 60s cache and fetch fresh prices"
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              ↻ Force Live
            </button>
          </form>
        </header>

        {/* Active Custom Ticker Pills */}
        {customTickers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-5 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-400 font-medium mr-1">Pinned Tickers:</span>
            {customTickers.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-500/40"
              >
                {sym}
                <button
                  onClick={() => handleRemoveTicker(sym)}
                  className="text-indigo-400 hover:text-white leading-none"
                  aria-label={`Remove ${sym}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Catalyst Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {['ALL', 'PINNED', 'VOLUME_SURGE', 'OVERSOLD', 'OVERBOUGHT', 'NEWS_CATALYST'].map(
            (type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  filter === type
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {type.replace('_', ' ')}
              </button>
            )
          )}
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="text-center py-20 text-slate-400 animate-pulse">
            Scanning live market movers and calculating technical anomalies...
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="text-center py-16 text-slate-500 border border-dashed border-slate-800 rounded-xl">
            No stocks currently match the "{filter.replace('_', ' ')}" filter.
          </div>
        ) : (
          /* Dynamic Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredStocks.map((stock) => {
              const style = DRIVER_STYLES[stock.driver_type] || DRIVER_STYLES.BALANCED;
              const isPositive = stock.pct_change >= 0;

              return (
                <div
                  key={stock.symbol}
                  className={`rounded-xl border p-5 transition-all shadow-lg ${style.border}`}
                >
                  {/* Top Row: Ticker & Score */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold">{stock.symbol}</span>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            isPositive
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-rose-500/20 text-rose-400'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          {stock.pct_change}%
                        </span>
                        {stock.is_custom && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                            PINNED
                          </span>
                        )}
                      </div>
                      <div className="text-lg font-mono text-slate-200 mt-0.5">
                        ${stock.price.toFixed(2)}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                        Anomaly Score
                      </span>
                      <span className={`text-xl font-black ${style.accent}`}>
                        {stock.interesting_score}
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Catalyst Badge */}
                  <div
                    className={`inline-block text-xs px-2.5 py-1 rounded-md border mb-4 ${style.badge}`}
                  >
                    {stock.driver_label}
                  </div>

                  {/* Conditional Display 1: Volume Surge Bar */}
                  {stock.driver_type === 'VOLUME_SURGE' && (
                    <div className="mb-4 bg-slate-900/80 p-3 rounded-lg border border-amber-500/20">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-amber-300">Relative Volume Surge</span>
                        <span className="font-mono font-bold">{stock.rvol}x avg</span>
                      </div>
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-400 h-full"
                          style={{ width: `${Math.min(100, (stock.rvol / 3) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Conditional Display 2: RSI Meter */}
                  {(stock.driver_type === 'OVERSOLD' || stock.driver_type === 'OVERBOUGHT') && (
                    <div className="mb-4 bg-slate-900/80 p-3 rounded-lg border border-slate-700">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">14-Day RSI Extreme</span>
                        <span className="font-mono font-bold">{stock.rsi} / 100</span>
                      </div>
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            stock.rsi >= 70 ? 'bg-rose-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${stock.rsi}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Conditional Display 3: Highlighted News Box */}
                  {stock.top_headline && (
                    <div
                      className={`p-3 rounded-lg text-xs leading-relaxed ${
                        stock.driver_type === 'NEWS_CATALYST'
                          ? 'bg-sky-950/60 border border-sky-500/30 text-sky-100'
                          : 'bg-slate-900/50 text-slate-400'
                      }`}
                    >
                      <span className="font-semibold uppercase text-[10px] tracking-wider block mb-1 opacity-75">
                        Latest Catalyst (
                        {stock.sentiment > 0
                          ? 'Bullish'
                          : stock.sentiment < 0
                          ? 'Bearish'
                          : 'Neutral'}
                        )
                      </span>
                      "{stock.top_headline}"
                    </div>
                  )}

                  {/* Footer Metrics */}
                  <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center text-xs">
                    <div>
                      <span className="text-slate-500 block">RVOL</span>
                      <span className="font-mono">{stock.rvol}x</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">RSI-14</span>
                      <span className="font-mono">{stock.rsi}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Sentiment</span>
                      <span className="font-mono">{stock.sentiment}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
