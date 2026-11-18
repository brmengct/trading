import React, { useState, useEffect, useCallback } from 'react';

const DRIVER_STYLES = {
  VOLUME_SURGE: 'amber',
  OVERBOUGHT: 'rose',
  OVERSOLD: 'green',
  RELATIVE_OVERSOLD: 'violet',
  SECTOR_WEAKNESS: 'blue',
  NEWS_CATALYST: 'cyan',
  BALANCED: 'slate',
};

const FILTERS = [
  ['ALL', 'All signals'],
  ['PINNED', 'Watchlist'],
  ['VOLUME_SURGE', 'Volume'],
  ['OVERSOLD', 'Oversold'],
  ['OVERBOUGHT', 'Overbought'],
  ['NEWS_CATALYST', 'News'],
];

const formatNumber = (value, digits = 1) =>
  value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';

const formatPercent = (value) =>
  value == null ? '—' : `${Number(value) > 0 ? '+' : ''}${formatNumber(value, 2)}%`;

function App() {
  const [stocks, setStocks] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [tickerInput, setTickerInput] = useState('');
  const [error, setError] = useState('');
  const [customTickers, setCustomTickers] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('custom_scanner_tickers') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [cacheInfo, setCacheInfo] = useState({ cached: false, age: 0 });

  useEffect(() => {
    localStorage.setItem('custom_scanner_tickers', JSON.stringify(customTickers));
  }, [customTickers]);

  const requestMarketData = useCallback(
    async (forceRefresh = false) => {
      const params = new URLSearchParams();
      if (customTickers.length) params.set('custom', customTickers.join(','));
      if (forceRefresh) params.set('force_refresh', 'true');

      const response = await fetch(
        `http://localhost:8000/api/interesting-stocks?${params.toString()}`
      );
      if (!response.ok) throw new Error(`Market data request failed (${response.status})`);
      return response.json();
    },
    [customTickers]
  );

  const applyMarketData = useCallback((data) => {
    setStocks(data.stocks || []);
    setError('');
    setCacheInfo({
      cached: Boolean(data.cached),
      age: data.cache_age_sec || 0,
    });
  }, []);

  const fetchMarketData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        applyMarketData(await requestMarketData(forceRefresh));
      } catch (requestError) {
        console.error('Failed to fetch scanner data:', requestError);
        setError('Market data is unavailable. Check that the scanner API is running, then try again.');
      } finally {
        setLoading(false);
      }
    },
    [applyMarketData, requestMarketData]
  );

  useEffect(() => {
    let active = true;
    requestMarketData()
      .then((data) => {
        if (active) applyMarketData(data);
      })
      .catch((requestError) => {
        if (!active) return;
        console.error('Failed to fetch scanner data:', requestError);
        setError('Market data is unavailable. Check that the scanner API is running, then try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyMarketData, requestMarketData]);

  const handleAddTicker = (event) => {
    event.preventDefault();
    const symbol = tickerInput.toUpperCase().replace(/[^A-Z]/g, '');
    if (symbol && symbol.length <= 5 && !customTickers.includes(symbol)) {
      setLoading(true);
      setCustomTickers((current) => [...current, symbol]);
    }
    setTickerInput('');
  };

  const filteredStocks = stocks.filter((stock) => {
    if (filter === 'ALL') return true;
    if (filter === 'PINNED') return stock.is_custom;
    if (filter === 'OVERSOLD') {
      return ['OVERSOLD', 'RELATIVE_OVERSOLD', 'SECTOR_WEAKNESS'].includes(stock.driver_type);
    }
    return stock.driver_type === filter;
  });

  const comparableStocks = stocks.filter((stock) => stock.excess_return_20d != null);
  const outperformers = comparableStocks.filter((stock) => stock.excess_return_20d > 0).length;
  const averageExcessReturn = comparableStocks.length
    ? comparableStocks.reduce((total, stock) => total + stock.excess_return_20d, 0) /
      comparableStocks.length
    : null;

  return (
    <main className="app-shell">
      <div className="dashboard">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Market pulse home">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>MARKET<span className="brand-light">PULSE</span></span>
          </a>
          <div className="market-status">
            <span className={`status-dot ${loading ? 'is-loading' : ''}`} />
            <span>{loading ? 'Updating market' : cacheInfo.cached ? `Updated ${cacheInfo.age}s ago` : 'Market scan live'}</span>
          </div>
        </header>

        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow">MARKET OVERVIEW <span>·</span> DAILY SIGNALS</p>
            <h1>Find the move<br /><span>behind the market.</span></h1>
            <p className="intro-description">
              Momentum, relative strength and market catalysts in one focused view.
            </p>
          </div>
          <form className="controls" onSubmit={handleAddTicker}>
            <label className="ticker-entry">
              <span className="sr-only">Add a ticker to your watchlist</span>
              <span className="search-icon" aria-hidden="true">⌕</span>
              <input
                type="text"
                value={tickerInput}
                onChange={(event) => setTickerInput(event.target.value)}
                placeholder="Add ticker"
                maxLength={5}
                aria-label="Add ticker"
              />
              <button type="submit" className="add-button" disabled={!tickerInput.trim()}>
                Add
              </button>
            </label>
            <button
              type="button"
              className="refresh-button"
              onClick={() => fetchMarketData(true)}
              disabled={loading}
              title="Bypass the cache and fetch fresh market data"
            >
              <span aria-hidden="true">↻</span> Refresh
            </button>
          </form>
        </section>

        {customTickers.length > 0 && (
          <div className="watchlist-strip">
            <span className="watchlist-label">YOUR WATCHLIST</span>
            {customTickers.map((symbol) => (
              <span className="watchlist-chip" key={symbol}>
                {symbol}
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setCustomTickers((current) => current.filter((item) => item !== symbol));
                  }}
                  aria-label={`Remove ${symbol} from watchlist`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <section className="overview-grid" aria-label="Market overview">
          <article className="overview-card">
            <span className="overview-label">SCANNED</span>
            <div className="overview-value">{stocks.length || '—'}<span> symbols</span></div>
            <span className="overview-note">Active movers & watchlist</span>
          </article>
          <article className="overview-card overview-highlight">
            <span className="overview-label">BEATING BENCHMARK</span>
            <div className="overview-value">
              {comparableStocks.length ? `${outperformers}/${comparableStocks.length}` : '—'}
              <span> stocks</span>
            </div>
            <span className="overview-note">Positive 20-day excess return</span>
          </article>
          <article className="overview-card">
            <span className="overview-label">AVG. EXCESS RETURN</span>
            <div className={`overview-value ${averageExcessReturn > 0 ? 'positive' : averageExcessReturn < 0 ? 'negative' : ''}`}>
              {formatPercent(averageExcessReturn)}
            </div>
            <span className="overview-note">Versus each stock's benchmark · 20D</span>
          </article>
        </section>

        <section className="signals-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LIVE SCANNER</p>
              <h2>Market signals <span className="result-count">{filteredStocks.length}</span></h2>
            </div>
            <div className="filter-list" role="group" aria-label="Filter market signals">
              {FILTERS.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`filter-button ${filter === value ? 'active' : ''}`}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="empty-state error-state">
              <span className="empty-icon" aria-hidden="true">!</span>
              <h3>Couldn’t load the market scan</h3>
              <p>{error}</p>
              <button className="retry-button" type="button" onClick={() => fetchMarketData(true)}>Try again</button>
            </div>
          ) : loading && stocks.length === 0 ? (
            <div className="loading-grid" aria-label="Loading market scan">
              {Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index} />)}
            </div>
          ) : filteredStocks.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">⌁</span>
              <h3>{stocks.length ? 'No matching signals' : 'No market data yet'}</h3>
              <p>{stocks.length ? 'Try another filter to see more of the scan.' : 'The scanner will show its latest signals here.'}</p>
            </div>
          ) : (
            <div className="stock-grid">
              {filteredStocks.map((stock) => {
                const tone = DRIVER_STYLES[stock.driver_type] || 'slate';
                const relativeRsi = stock.relative_rsi;
                const relativeRsiPosition = relativeRsi == null ? 0 : Math.min(100, Math.max(0, relativeRsi));
                const isPositive = stock.pct_change >= 0;

                return (
                  <article className={`stock-card tone-${tone}`} key={stock.symbol}>
                    <div className="card-topline">
                      <span className="signal-tag">{stock.driver_label}</span>
                      <span className="score">SIGNAL <b>{formatNumber(stock.interesting_score, 0)}</b></span>
                    </div>
                    <div className="stock-heading">
                      <div>
                        <div className="symbol-line">
                          <h3>{stock.symbol}</h3>
                          {stock.is_custom && <span className="pinned-tag">PINNED</span>}
                        </div>
                        <p className="stock-price">${formatNumber(stock.price, 2)}</p>
                      </div>
                      <span className={`daily-change ${isPositive ? 'positive' : 'negative'}`}>
                        {formatPercent(stock.pct_change)}
                        <small>1D</small>
                      </span>
                    </div>

                    <div className="relative-panel">
                      <div className="relative-heading">
                        <div>
                          <span className="metric-label">RELATIVE RSI <span className="benchmark-name">vs {stock.benchmark || 'SPY'}</span></span>
                          <strong>{formatNumber(relativeRsi)}<span className="out-of"> / 100</span></strong>
                        </div>
                        <span className={`relative-state ${relativeRsi == null ? '' : relativeRsi >= 60 ? 'positive' : relativeRsi <= 40 ? 'negative' : ''}`}>
                          {relativeRsi == null ? 'N/A' : relativeRsi >= 60 ? 'Strong' : relativeRsi <= 40 ? 'Weak' : 'Neutral'}
                        </span>
                      </div>
                      <div className="rsi-track" role="img" aria-label={`Relative RSI ${formatNumber(relativeRsi)} out of 100`}>
                        <span className="rsi-zone weak-zone" />
                        <span className="rsi-zone strong-zone" />
                        {relativeRsi != null && <span className="rsi-marker" style={{ left: `${relativeRsiPosition}%` }} />}
                      </div>
                      <div className="scale-labels"><span>WEAK</span><span>NEUTRAL</span><span>STRONG</span></div>
                    </div>

                    <div className="benchmark-grid">
                      <div>
                        <span className="metric-label">BENCHMARK</span>
                        <strong>{stock.benchmark || 'SPY'}</strong>
                      </div>
                      <div>
                        <span className="metric-label">BENCHMARK 20D</span>
                        <strong>{formatPercent(stock.benchmark_return_20d)}</strong>
                      </div>
                      <div>
                        <span className="metric-label">EXCESS 20D</span>
                        <strong className={stock.excess_return_20d > 0 ? 'positive' : stock.excess_return_20d < 0 ? 'negative' : ''}>
                          {formatPercent(stock.excess_return_20d)}
                        </strong>
                      </div>
                    </div>

                    {stock.top_headline && (
                      <div className="headline">
                        <span className="headline-label">LATEST CATALYST</span>
                        <p>{stock.top_headline}</p>
                      </div>
                    )}

                    <div className="card-footer">
                      <span>RSI-14 <b>{formatNumber(stock.rsi)}</b></span>
                      <span>RVOL <b>{formatNumber(stock.rvol, 2)}x</b></span>
                      <span>SENTIMENT <b>{formatNumber(stock.sentiment, 2)}</b></span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <footer className="page-footer">
          <span>Market data for informational purposes only.</span>
          <span>{loading && stocks.length > 0 ? 'Updating scan…' : `${stocks.length} symbols in current scan`}</span>
        </footer>
      </div>
    </main>
  );
}

export default App;
