/**
 * dataFeed.js — Market data adapter
 *
 * Provides a unified candle feed for:
 *   • Crypto  → Binance WebSocket (real-time) + REST via proxy (historical seed)
 *   • Forex   → Alpha Vantage REST (polling) or Twelve Data (if key set)
 *   • Fallback → CoinGecko REST for crypto historical
 *
 * Emits events via an EventTarget interface.
 * Usage:
 *   const feed = new DataFeed();
 *   feed.on('candle', (candle) => { ... });
 *   feed.on('history', (candles) => { ... });
 *   feed.on('error', (message) => { ... });
 *   await feed.subscribe('BTCUSDT', '60', 'CRYPTO');
 *   feed.unsubscribe();
 */

import { Settings } from './settings.js';

// ─── CORS Proxy for Binance REST (historical seed data) ─────────
const CORS_PROXY = 'https://corsproxy.io/?';

// ─── Binance interval map (LW Charts TF → Binance interval string) ──
const BINANCE_TF = {
  '1':    '1m',
  '3':    '3m',
  '5':    '5m',
  '15':   '15m',
  '30':   '30m',
  '60':   '1h',
  '120':  '2h',
  '240':  '4h',
  '360':  '6h',
  '720':  '12h',
  'D':    '1d',
  '1D':   '1d',
  'W':    '1w',
  '1W':   '1w',
};

// ─── Alpha Vantage interval map ─────────────────────────────────
const AV_TF = {
  '1':  '1min',
  '5':  '5min',
  '15': '15min',
  '30': '30min',
  '60': '60min',
};

export class DataFeed extends EventTarget {
  constructor() {
    super();
    this._ws        = null;
    this._pollTimer = null;
    this._symbol    = null;
    this._tf        = null;
    this._market    = null;
    this._candles   = [];
    this._running   = false;
  }

  // ─── Public API ─────────────────────────────────────────────────

  on(event, handler) {
    this.addEventListener(event, (e) => handler(e.detail));
  }

  off(event, handler) {
    this.removeEventListener(event, handler);
  }

  _emit(event, detail) {
    this.dispatchEvent(new CustomEvent(event, { detail }));
  }

  get candles() { return this._candles; }

  /**
   * Subscribe to a symbol/timeframe combination.
   * Fetches history first, then opens real-time feed.
   */
  async subscribe(symbol, timeframe, market = 'CRYPTO') {
    this.unsubscribe();
    this._symbol  = symbol;
    this._tf      = timeframe;
    this._market  = market;
    this._running = true;

    try {
      if (market === 'CRYPTO') {
        await this._cryptoConnect(symbol, timeframe);
      } else {
        await this._forexConnect(symbol, timeframe);
      }
    } catch (err) {
      this._emit('error', `Feed error: ${err.message}`);
    }
  }

  /** Stop all active connections and polling. */
  unsubscribe() {
    this._running = false;
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._candles = [];
  }

  // ─── CRYPTO (Binance) ────────────────────────────────────────────

  async _cryptoConnect(symbol, tf) {
    // 1. Fetch historical candles
    const history = await this._fetchBinanceHistory(symbol, tf, 500);
    if (history.length > 0) {
      this._candles = history;
      this._emit('history', [...history]);
    }

    // 2. Open WebSocket for live updates
    this._openBinanceWS(symbol, tf);
  }

  async _fetchBinanceHistory(symbol, tf, limit = 500) {
    const interval = BINANCE_TF[tf] || '1h';
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;

    // Try direct first (Binance blocks CORS from browsers, so we need proxy)
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;

    try {
      const res  = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(k => this._normBinanceKline(k));
    } catch (err) {
      console.warn('[DataFeed] Binance REST failed, falling back to CoinGecko:', err.message);
      return this._fetchCoinGeckoHistory(symbol, tf);
    }
  }

  _openBinanceWS(symbol, tf) {
    const interval = BINANCE_TF[tf] || '1h';
    const stream   = `${symbol.toLowerCase()}@kline_${interval}`;
    const wsUrl    = `wss://stream.binance.com:9443/ws/${stream}`;

    const ws = new WebSocket(wsUrl);
    this._ws = ws;

    ws.onopen = () => {
      console.log(`[DataFeed] Binance WS connected: ${stream}`);
      this._emit('status', { connected: true, source: 'Binance WS' });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e !== 'kline') return;
        const k      = msg.k;
        const candle = this._normBinanceKline([
          k.t, k.o, k.h, k.l, k.c, k.v,
          k.T, '', 0, '', '', '',
        ]);
        candle.isClosed = k.x;
        this._updateCandles(candle);
        this._emit('candle', candle);
      } catch {}
    };

    ws.onerror = (err) => {
      this._emit('error', 'Binance WebSocket error — reconnecting…');
    };

    ws.onclose = () => {
      if (!this._running) return;
      console.warn('[DataFeed] Binance WS closed — reconnecting in 3s');
      this._emit('status', { connected: false, source: 'Binance WS' });
      setTimeout(() => {
        if (this._running) this._openBinanceWS(symbol, tf);
      }, 3000);
    };
  }

  _normBinanceKline(k) {
    return {
      time:   Math.floor(k[0] / 1000),
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    };
  }

  // ─── CoinGecko Fallback (crypto historical) ──────────────────────

  async _fetchCoinGeckoHistory(symbol, tf) {
    // Map common symbols to CoinGecko IDs
    const idMap = {
      BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', BNBUSDT: 'binancecoin',
      SOLUSDT: 'solana',  XRPUSDT: 'ripple',   ADAUSDT: 'cardano',
      DOGEUSDT:'dogecoin', MATICUSDT: 'matic-network', AVAXUSDT: 'avalanche-2',
    };
    const id = idMap[symbol.toUpperCase()] || symbol.replace('USDT','').toLowerCase();

    // Determine days param based on timeframe
    const days = (['D','1D','W','1W'].includes(tf)) ? 365
      : (['240','720'].includes(tf)) ? 90
      : (['60','120'].includes(tf))  ? 30
      : 7;

    const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`;
    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();
      // CoinGecko returns [timestamp_ms, open, high, low, close]
      return data.map(([t, o, h, l, c]) => ({
        time: Math.floor(t / 1000), open: o, high: h, low: l, close: c, volume: 0,
      }));
    } catch (err) {
      console.error('[DataFeed] CoinGecko failed:', err.message);
      this._emit('error', 'Could not fetch historical data. Check network.');
      return [];
    }
  }

  // ─── FOREX (Alpha Vantage / Twelve Data) ─────────────────────────

  async _forexConnect(symbol, tf) {
    const tdKey = Settings.getTDKey();
    const avKey = Settings.getAVKey();

    if (tdKey) {
      await this._connectTwelveData(symbol, tf, tdKey);
    } else if (avKey) {
      await this._connectAlphaVantage(symbol, tf, avKey);
    } else {
      this._emit('error', 'No Forex API key set. Add an Alpha Vantage or Twelve Data key in ⚙ Settings.');
      // Load demo/simulated data so chart isn't blank
      const demo = this._generateDemoCandles(100, tf);
      this._candles = demo;
      this._emit('history', [...demo]);
    }
  }

  async _connectAlphaVantage(symbol, tf, apiKey) {
    const fromSym = symbol.substring(0, 3);
    const toSym   = symbol.substring(3);
    const interval = AV_TF[tf] || null;

    let url;
    if (interval) {
      url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${fromSym}&to_symbol=${toSym}&interval=${interval}&outputsize=compact&apikey=${apiKey}`;
    } else {
      url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromSym}&to_symbol=${toSym}&outputsize=compact&apikey=${apiKey}`;
    }

    const history = await this._fetchAVData(url, interval);
    if (history.length > 0) {
      this._candles = history;
      this._emit('history', [...history]);
    }

    // Poll every 60 seconds (AV free: 25 req/day — conserve calls)
    const pollMs = Math.max(60000, 86400000 / 20);
    this._pollTimer = setInterval(async () => {
      if (!this._running) return;
      const update = await this._fetchAVData(url, interval);
      if (update.length > 0) {
        const latest = update[update.length - 1];
        latest.isClosed = true;
        this._updateCandles(latest);
        this._emit('candle', latest);
      }
    }, pollMs);
  }

  async _fetchAVData(url, interval) {
    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Parse time series
      const key = interval
        ? `Time Series FX (${interval})`
        : 'Time Series FX (Daily)';
      const ts  = data[key];
      if (!ts) {
        const msg = data['Note'] || data['Information'] || 'Unknown AV error';
        throw new Error(msg);
      }

      return Object.entries(ts)
        .map(([dateStr, v]) => ({
          time:   Math.floor(new Date(dateStr).getTime() / 1000),
          open:   parseFloat(v['1. open']),
          high:   parseFloat(v['2. high']),
          low:    parseFloat(v['3. low']),
          close:  parseFloat(v['4. close']),
          volume: 0,
        }))
        .sort((a, b) => a.time - b.time);
    } catch (err) {
      console.error('[DataFeed] Alpha Vantage error:', err.message);
      this._emit('error', `Alpha Vantage: ${err.message}`);
      return [];
    }
  }

  async _connectTwelveData(symbol, tf, apiKey) {
    // Twelve Data REST for historical
    const interval = this._tdInterval(tf);
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=300&apikey=${apiKey}`;

    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.status === 'error') throw new Error(data.message);

      const history = (data.values || []).map(v => ({
        time:   Math.floor(new Date(v.datetime).getTime() / 1000),
        open:   parseFloat(v.open),
        high:   parseFloat(v.high),
        low:    parseFloat(v.low),
        close:  parseFloat(v.close),
        volume: parseFloat(v.volume || 0),
      })).sort((a, b) => a.time - b.time);

      this._candles = history;
      this._emit('history', [...history]);

      // Twelve Data WebSocket
      this._openTwelveDataWS(symbol, interval, apiKey);
    } catch (err) {
      this._emit('error', `Twelve Data: ${err.message}`);
    }
  }

  _openTwelveDataWS(symbol, interval, apiKey) {
    const ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${apiKey}`);
    this._ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: symbol } }));
      this._emit('status', { connected: true, source: 'Twelve Data WS' });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event !== 'price') return;
        // Tick update — build candle from latest price
        const t = Math.floor(Date.now() / 1000);
        const p = parseFloat(msg.price);
        const candle = { time: t, open: p, high: p, low: p, close: p, volume: 0, isClosed: false };
        this._emit('candle', candle);
      } catch {}
    };

    ws.onclose = () => {
      if (!this._running) return;
      setTimeout(() => {
        if (this._running) this._openTwelveDataWS(symbol, interval, apiKey);
      }, 5000);
    };
  }

  _tdInterval(tf) {
    const map = {
      '1': '1min', '5': '5min', '15': '15min', '30': '30min',
      '60': '1h', '120': '2h', '240': '4h', 'D': '1day', '1D': '1day',
    };
    return map[tf] || '1h';
  }

  // ─── Demo Data Generator (when no Forex key available) ────────────

  _generateDemoCandles(count, tf) {
    const candles = [];
    const tfSeconds = {
      '1': 60, '5': 300, '15': 900, '30': 1800,
      '60': 3600, '240': 14400, 'D': 86400, '1D': 86400,
    };
    const step = tfSeconds[tf] || 3600;
    const now  = Math.floor(Date.now() / 1000);

    let price = 1.08500; // EUR/USD-ish
    for (let i = count; i > 0; i--) {
      const time  = now - i * step;
      const open  = price;
      const move  = (Math.random() - 0.48) * 0.0020;
      const close = Math.max(0.5, open + move);
      const high  = Math.max(open, close) + Math.random() * 0.0010;
      const low   = Math.min(open, close) - Math.random() * 0.0010;
      candles.push({ time, open: +open.toFixed(5), high: +high.toFixed(5),
        low: +low.toFixed(5), close: +close.toFixed(5), volume: 0, isDemo: true });
      price = close;
    }
    return candles;
  }

  // ─── Internal candle buffer management ──────────────────────────

  _updateCandles(newCandle) {
    const arr = this._candles;
    if (arr.length === 0) {
      arr.push(newCandle);
      return;
    }
    const last = arr[arr.length - 1];
    if (last.time === newCandle.time) {
      // Update current candle
      arr[arr.length - 1] = {
        ...last,
        high:  Math.max(last.high, newCandle.high),
        low:   Math.min(last.low,  newCandle.low),
        close: newCandle.close,
        volume: (last.volume || 0) + (newCandle.volume || 0),
        isClosed: newCandle.isClosed,
      };
    } else if (newCandle.time > last.time) {
      arr.push(newCandle);
      // Keep buffer to last 1000 candles
      if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    }
  }
}
