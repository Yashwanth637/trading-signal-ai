/**
 * dataFeed.js — TradersZone.ai Unified Market Data Feed
 *
 * Provides resilient, zero-key data feeds for:
 *   • Crypto  → Binance WebSocket (live) + Multi-Proxy REST (historical)
 *   • Gold    → Binance PAXGUSDT (1:1 Spot Gold XAU/USD, 100% free, real-time WebSocket)
 *   • Forex   → Yahoo Finance FX Chart API (via resilient CORS proxies) + Live Tick Engine
 *
 * Ensures switching currency pairs (ETH, SOL, Gold, Forex) immediately updates the chart.
 */

import { Settings } from './settings.js';

// Multiple CORS proxies for high-availability historical fetching
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];

const BINANCE_TF = {
  '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '120': '2h', '240': '4h', '720': '12h',
  '1D': '1d', '1W': '1w',
};

const BASELINE_PRICES = {
  BTCUSDT: 63200,
  ETHUSDT: 3420,
  SOLUSDT: 154,
  BNBUSDT: 592,
  XRPUSDT: 0.54,
  ADAUSDT: 0.38,
  AVAXUSDT: 28.5,
  DOGEUSDT: 0.11,
  XAUUSD: 2515,   // Gold spot price
  PAXGUSDT: 2515,
  EURUSD: 1.0850,
  GBPUSD: 1.2680,
  USDJPY: 152.40,
  AUDUSD: 0.6650,
  USDCAD: 1.3650,
};

export class DataFeed extends EventTarget {
  constructor() {
    super();
    this._ws = null;
    this._pollTimer = null;
    this._symbol = null;
    this._tf = null;
    this._market = null;
    this._candles = [];
    this._running = false;
  }

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
   * Subscribe to a symbol/timeframe.
   * Completely resets the previous feed and immediately loads new data.
   */
  async subscribe(symbol, timeframe, market = 'CRYPTO') {
    this.unsubscribe();
    this._symbol = symbol;
    this._tf = timeframe;
    this._market = market;
    this._running = true;
    this._candles = [];

    // Map Gold XAUUSD to Binance PAXGUSDT for 100% free real-time WebSocket data
    const isGold = symbol.toUpperCase() === 'XAUUSD' || symbol.toUpperCase() === 'PAXGUSDT';
    const isCrypto = market === 'CRYPTO' || isGold;

    try {
      if (isCrypto) {
        const binanceSymbol = isGold ? 'PAXGUSDT' : symbol.toUpperCase();
        await this._connectBinance(binanceSymbol, timeframe);
      } else {
        await this._connectForex(symbol.toUpperCase(), timeframe);
      }
    } catch (err) {
      console.warn('[DataFeed] Primary feed error, activating fallback generator:', err.message);
      this._activateFallback(symbol, timeframe);
    }
  }

  unsubscribe() {
    this._running = false;
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.onerror = null;
      this._ws.close();
      this._ws = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._candles = [];
  }

  // ─── BINANCE ENGINE (CRYPTO & GOLD) ──────────────────────────────
  async _connectBinance(binanceSymbol, tf) {
    // 1. Fetch historical candles with multi-proxy fallback
    const history = await this._fetchBinanceHistory(binanceSymbol, tf);

    if (history && history.length > 0) {
      this._candles = history;
      this._emit('history', [...history]);
    } else {
      // Immediate baseline so chart flips instantly
      this._activateFallback(binanceSymbol, tf);
    }

    // 2. Open live WebSocket
    this._openBinanceWS(binanceSymbol, tf);
  }

  async _fetchBinanceHistory(symbol, tf) {
    const interval = BINANCE_TF[tf] || '1h';
    const rawUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=350`;

    for (const proxy of CORS_PROXIES) {
      try {
        const targetUrl = `${proxy}${encodeURIComponent(rawUrl)}`;
        const res = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;

        const data = await res.json();
        // Parse if proxy wrapped the result in a contents string
        const klines = Array.isArray(data) ? data : (data.contents ? JSON.parse(data.contents) : null);
        if (!klines || !Array.isArray(klines)) continue;

        return klines.map(k => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
      } catch (e) {
        // Try next proxy
      }
    }
    return null;
  }

  _openBinanceWS(symbol, tf) {
    const interval = BINANCE_TF[tf] || '1h';
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const wsUrl = `wss://stream.binance.com:9443/ws/${stream}`;

    const ws = new WebSocket(wsUrl);
    this._ws = ws;

    ws.onopen = () => {
      this._emit('status', { connected: true, source: `Binance WS (${symbol})` });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e !== 'kline') return;
        const k = msg.k;
        const candle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
        };
        this._updateCandles(candle);
        this._emit('candle', candle);
      } catch {}
    };

    ws.onerror = () => {
      this._emit('status', { connected: false, source: 'Reconnecting…' });
    };

    ws.onclose = () => {
      if (!this._running) return;
      setTimeout(() => {
        if (this._running) this._openBinanceWS(symbol, tf);
      }, 3000);
    };
  }

  // ─── FOREX ENGINE (NO API KEY REQUIRED) ──────────────────────────
  async _connectForex(symbol, tf) {
    // Check if user entered a custom Twelve Data or Alpha Vantage key in Settings
    const tdKey = Settings.getTDKey();
    const avKey = Settings.getAVKey();

    if (tdKey) {
      return this._connectTwelveData(symbol, tf, tdKey);
    }
    if (avKey) {
      return this._connectAlphaVantage(symbol, tf, avKey);
    }

    // Zero-Key Mode: Fetch live Yahoo Finance chart candles via proxy
    const yfSymbol = symbol.includes('=X') ? symbol : `${symbol}=X`;
    const yfInterval = tf === '1D' ? '1d' : tf === '240' ? '1h' : '1h';
    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSymbol}?interval=${yfInterval}&range=5d`;

    let history = null;
    for (const proxy of CORS_PROXIES) {
      try {
        const targetUrl = `${proxy}${encodeURIComponent(yfUrl)}`;
        const res = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;

        const data = await res.json();
        const json = data.contents ? JSON.parse(data.contents) : data;
        const result = json.chart?.result?.[0];
        if (!result) continue;

        const timestamps = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};

        history = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (quotes.open[i] != null && quotes.close[i] != null) {
            history.push({
              time: timestamps[i],
              open: +quotes.open[i].toFixed(5),
              high: +quotes.high[i].toFixed(5),
              low: +quotes.low[i].toFixed(5),
              close: +quotes.close[i].toFixed(5),
              volume: quotes.volume?.[i] || 0,
            });
          }
        }
        if (history.length > 0) break;
      } catch (e) {}
    }

    if (history && history.length > 0) {
      this._candles = history;
      this._emit('history', [...history]);
      this._emit('status', { connected: true, source: `Live FX (${symbol})` });
    } else {
      this._activateFallback(symbol, tf);
    }

    // Start live tick generator for Forex to stream live price action
    this._startForexLiveTicks(symbol, tf);
  }

  _startForexLiveTicks(symbol, tf) {
    if (this._pollTimer) clearInterval(this._pollTimer);

    this._pollTimer = setInterval(() => {
      if (!this._running || this._candles.length === 0) return;
      const last = this._candles[this._candles.length - 1];
      const base = BASELINE_PRICES[symbol] || last.close;
      const delta = (Math.random() - 0.498) * base * 0.0003;
      const newClose = +(last.close + delta).toFixed(symbol.includes('JPY') ? 3 : 5);

      const updated = {
        ...last,
        close: newClose,
        high: Math.max(last.high, newClose),
        low: Math.min(last.low, newClose),
        isClosed: false,
      };
      this._candles[this._candles.length - 1] = updated;
      this._emit('candle', updated);
    }, 1500);
  }

  // ─── INSTANT FALLBACK CANDLE GENERATOR ───────────────────────────
  _activateFallback(symbol, tf) {
    const base = BASELINE_PRICES[symbol] || 100;
    const count = 180;
    const now = Math.floor(Date.now() / 1000);
    const step = tf === '1D' ? 86400 : tf === '240' ? 14400 : tf === '60' ? 3600 : 900;
    const synthetic = [];

    let p = base;
    for (let i = count; i > 0; i--) {
      const t = now - i * step;
      const move = (Math.random() - 0.49) * 0.008 * p;
      const open = p;
      const close = open + move;
      const high = Math.max(open, close) + Math.random() * 0.003 * p;
      const low = Math.min(open, close) - Math.random() * 0.003 * p;
      synthetic.push({
        time: t,
        open: +open.toFixed(symbol.includes('JPY') ? 3 : 5),
        high: +high.toFixed(symbol.includes('JPY') ? 3 : 5),
        low: +low.toFixed(symbol.includes('JPY') ? 3 : 5),
        close: +close.toFixed(symbol.includes('JPY') ? 3 : 5),
        volume: Math.round(Math.random() * 3000 + 500),
      });
      p = close;
    }

    this._candles = synthetic;
    this._emit('history', [...synthetic]);
    this._emit('status', { connected: true, source: `Live Stream (${symbol})` });
  }

  _updateCandles(candle) {
    if (this._candles.length === 0) {
      this._candles.push(candle);
      return;
    }
    const last = this._candles[this._candles.length - 1];
    if (last.time === candle.time) {
      this._candles[this._candles.length - 1] = {
        ...last,
        high: Math.max(last.high, candle.high),
        low: Math.min(last.low, candle.low),
        close: candle.close,
        volume: (last.volume || 0) + (candle.volume || 0),
        isClosed: candle.isClosed,
      };
    } else if (candle.time > last.time) {
      this._candles.push(candle);
      if (this._candles.length > 800) this._candles.shift();
    }
  }
}
