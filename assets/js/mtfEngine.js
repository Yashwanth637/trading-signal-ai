/**
 * mtfEngine.js — TradersZone.ai Multi-Timeframe Alignment Matrix
 *
 * Approximates trend bias for 6 timeframes from the loaded candle set by
 * sampling windows of proportional length, computing RSI(14) and EMA slopes.
 *
 * Bias Rules:
 *   BULLISH → RSI > 55 AND EMA20 > EMA50
 *   BEARISH → RSI < 45 AND EMA20 < EMA50
 *   NEUTRAL → otherwise
 *
 * Signal gating:
 *   BUY  requires ≥ 2 of [15M, 1H, 4H] to be BULLISH
 *   SELL requires ≥ 2 of [15M, 1H, 4H] to be BEARISH
 */

const TF_LABELS = ['1M', '5M', '15M', '1H', '4H', '1D'];

// How many candles of the active TF each "simulated" TF represents
// e.g. if active is 1H, a "1D" look is 24 candles back
const TF_MULTIPLIERS = {
  '1':   { '1M': 1,   '5M': 5,   '15M': 15,  '1H': 60,  '4H': 240, '1D': 1440 },
  '5':   { '1M': 1,   '5M': 1,   '15M': 3,   '1H': 12,  '4H': 48,  '1D': 288  },
  '15':  { '1M': 1,   '5M': 1,   '15M': 1,   '1H': 4,   '4H': 16,  '1D': 96   },
  '60':  { '1M': 1,   '5M': 1,   '15M': 1,   '1H': 1,   '4H': 4,   '1D': 24   },
  '240': { '1M': 1,   '5M': 1,   '15M': 1,   '1H': 1,   '4H': 1,   '1D': 6    },
  '1D':  { '1M': 1,   '5M': 1,   '15M': 1,   '1H': 1,   '4H': 1,   '1D': 1    },
};

export class MTFEngine {
  constructor() {
    this._matrix = {
      '1M':  'NEUTRAL',
      '5M':  'NEUTRAL',
      '15M': 'NEUTRAL',
      '1H':  'NEUTRAL',
      '4H':  'NEUTRAL',
      '1D':  'NEUTRAL',
    };
    this._activeTF = '60';
  }

  /**
   * Update the MTF matrix from the current candle set
   * @param {Array}  candles   - Full OHLCV array from active TF
   * @param {string} activeTF  - Active timeframe string ('1','5','15','60','240','1D')
   * @returns {Object} Updated matrix
   */
  update(candles, activeTF) {
    if (!candles || candles.length < 60) return this._matrix;
    this._activeTF = activeTF;

    const multipliers = TF_MULTIPLIERS[activeTF] || TF_MULTIPLIERS['60'];

    for (const tf of TF_LABELS) {
      const mult = multipliers[tf] || 1;
      const needed = Math.max(60, mult * 50); // at least 50 "virtual" candles
      const slice = candles.slice(-Math.min(needed, candles.length));
      this._matrix[tf] = this._computeBias(slice, mult);
    }

    return { ...this._matrix };
  }

  /**
   * Get current matrix state
   * @returns {Object} { '1M': 'BULLISH', '5M': 'NEUTRAL', ... }
   */
  getMTFMatrix() {
    return { ...this._matrix };
  }

  /**
   * Determine if current conditions allow a BUY/SELL signal
   * @param {string} direction 'BUY' | 'SELL'
   * @returns {boolean}
   */
  isAligned(direction) {
    const keyTFs = ['15M', '1H', '4H'];
    const target = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const aligned = keyTFs.filter(tf => this._matrix[tf] === target).length;
    return aligned >= 2; // At least 2 of 3 key TFs must agree
  }

  /**
   * Get the dominant overall HTF trend bias (1H + 4H + 1D weighted)
   * @returns {'BULLISH'|'BEARISH'|'NEUTRAL'}
   */
  getHTFBias() {
    const htfTFs = ['1H', '4H', '1D'];
    let bull = 0, bear = 0;
    for (const tf of htfTFs) {
      if (this._matrix[tf] === 'BULLISH') bull++;
      if (this._matrix[tf] === 'BEARISH') bear++;
    }
    if (bull >= 2) return 'BULLISH';
    if (bear >= 2) return 'BEARISH';
    return 'NEUTRAL';
  }

  // ── Internal: compute bias for a given candle slice ───────────
  _computeBias(candles, mult) {
    // Sample every `mult` candles to simulate a higher TF
    const sampled = [];
    for (let i = mult - 1; i < candles.length; i += mult) {
      const window = candles.slice(Math.max(0, i - mult + 1), i + 1);
      sampled.push({
        open:  window[0].open,
        high:  Math.max(...window.map(c => c.high)),
        low:   Math.min(...window.map(c => c.low)),
        close: window[window.length - 1].close,
        volume: window.reduce((s, c) => s + (c.volume || 0), 0),
      });
    }

    if (sampled.length < 55) {
      // Not enough data — fall back to simple close slope
      const closes = sampled.map(c => c.close);
      if (closes.length < 5) return 'NEUTRAL';
      const slope = closes[closes.length - 1] - closes[0];
      return slope > 0 ? 'BULLISH' : slope < 0 ? 'BEARISH' : 'NEUTRAL';
    }

    const closes = sampled.map(c => c.close);
    const rsi = this._rsi(closes, 14);
    const ema20 = this._ema(closes, 20);
    const ema50 = this._ema(closes, 50);

    const lastEMA20 = ema20[ema20.length - 1];
    const lastEMA50 = ema50[ema50.length - 1];

    if (rsi > 55 && lastEMA20 > lastEMA50) return 'BULLISH';
    if (rsi < 45 && lastEMA20 < lastEMA50) return 'BEARISH';
    return 'NEUTRAL';
  }

  _rsi(closes, period) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains  += diff;
      else           losses -= diff;
    }
    const avgGain = gains  / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  _ema(values, period) {
    if (values.length < period) return values;
    const k = 2 / (period + 1);
    const result = [];
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(prev);
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      result.push(prev);
    }
    return result;
  }
}
