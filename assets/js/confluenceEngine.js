/**
 * confluenceEngine.js — TradersZone.ai Quantitative Confluence Checklist
 *
 * Computes 8 institutional-grade confluence criteria and returns a structured
 * checklist with a conviction score (e.g. "6/8 Met — High Conviction BUY").
 *
 * Criteria:
 *  1. BOS (Break of Structure) — directional
 *  2. CHoCH (Change of Character) — trend flip
 *  3. FVG Mitigation — unmitigated Fair Value Gap nearby
 *  4. Liquidity Sweep — equal highs/lows stop-hunt detected
 *  5. Volume Delta — bullish or bearish pressure on last 3 candles
 *  6. RSI(14) Alignment — above 50 for BUY, below 50 for SELL
 *  7. MACD Signal Cross — line crossed signal in direction
 *  8. S/R Zone Touch — price inside a Yashwanth Horizon Box
 */

export class ConfluenceEngine {
  /**
   * Compute confluence for a given directional signal
   * @param {Array}  candles     - Full OHLCV candle array
   * @param {Object} smcResult   - Output from SMCEngine.analyze()
   * @param {string} direction   - 'BUY' | 'SELL'
   * @returns {Object} confluenceResult
   */
  compute(candles, smcResult, direction) {
    if (!candles || candles.length < 30) {
      return this._emptyResult(direction);
    }

    const isBuy = direction === 'BUY';
    const checklist = [];
    let met = 0;

    // ── 1. Break of Structure ─────────────────────────────────────
    const bosResult = this._detectBOS(candles);
    const bosMatch = isBuy
      ? bosResult.status === 'BOS_BULLISH'
      : bosResult.status === 'BOS_BEARISH';
    checklist.push({
      id:     'bos',
      name:   'Break of Structure (BOS)',
      status: bosMatch ? 'met' : (bosResult.status === 'NONE' ? 'neutral' : 'missed'),
      detail: bosMatch
        ? `${isBuy ? 'Bullish' : 'Bearish'} BOS at ${bosResult.level.toFixed(2)}`
        : `No ${isBuy ? 'bullish' : 'bearish'} BOS detected`,
    });
    if (bosMatch) met++;

    // ── 2. Change of Character (CHoCH) ────────────────────────────
    const chochResult = this._detectCHoCH(candles);
    const chochMatch = isBuy
      ? chochResult.status === 'CHOCH_BULLISH'
      : chochResult.status === 'CHOCH_BEARISH';
    const bosOrChoch = bosMatch || chochMatch;
    checklist.push({
      id:     'choch',
      name:   'CHoCH / Trend Flip',
      status: chochMatch ? 'met' : 'missed',
      detail: chochMatch
        ? `${isBuy ? 'Bullish' : 'Bearish'} CHoCH — trend reversal confirmed`
        : `No ${isBuy ? 'bullish' : 'bearish'} CHoCH`,
    });
    if (chochMatch) met++;

    // ── 3. FVG Mitigation ─────────────────────────────────────────
    const fvgResult = this._detectFVG(candles, isBuy);
    checklist.push({
      id:     'fvg',
      name:   'Fair Value Gap (FVG)',
      status: fvgResult.hasFVG ? 'met' : 'missed',
      detail: fvgResult.hasFVG
        ? `Unmitigated ${isBuy ? 'bullish' : 'bearish'} FVG [${fvgResult.bottom.toFixed(2)} – ${fvgResult.top.toFixed(2)}]`
        : `No open ${isBuy ? 'bullish' : 'bearish'} FVG nearby`,
    });
    if (fvgResult.hasFVG) met++;

    // ── 4. Liquidity Sweep ────────────────────────────────────────
    const sweepResult = this._detectLiquiditySweep(candles, isBuy);
    checklist.push({
      id:     'sweep',
      name:   'Liquidity Sweep',
      status: sweepResult.hasSweep ? 'met' : 'missed',
      detail: sweepResult.hasSweep
        ? `${isBuy ? 'SSL' : 'BSL'} swept at ${sweepResult.level.toFixed(2)} — ${isBuy ? 'bullish' : 'bearish'} reversal expected`
        : `No ${isBuy ? 'SSL' : 'BSL'} sweep in recent structure`,
    });
    if (sweepResult.hasSweep) met++;

    // ── 5. Volume Delta Confirmation ──────────────────────────────
    const volDelta = this._computeVolumeDelta(candles);
    const volMatch = isBuy ? volDelta.bias === 'BULLISH' : volDelta.bias === 'BEARISH';
    checklist.push({
      id:     'volume',
      name:   'Volume Delta Confirmation',
      status: volMatch ? 'met' : (volDelta.bias === 'NEUTRAL' ? 'neutral' : 'missed'),
      detail: `${volDelta.bias} volume pressure (${volDelta.pct}% of 3-candle average)`,
    });
    if (volMatch) met++;

    // ── 6. RSI(14) Alignment ──────────────────────────────────────
    const rsi = this._computeRSI(candles, 14);
    const rsiMatch = isBuy ? rsi > 50 : rsi < 50;
    const rsiOverbought = rsi > 70;
    const rsiOversold = rsi < 30;
    checklist.push({
      id:     'rsi',
      name:   'RSI(14) Alignment',
      status: rsiMatch ? 'met' : 'missed',
      detail: `RSI = ${rsi.toFixed(1)} — ${rsiOverbought ? 'Overbought zone' : rsiOversold ? 'Oversold zone' : rsiMatch ? `Above 50 (${isBuy ? 'bullish' : 'bearish'} bias)` : 'No alignment'}`,
    });
    if (rsiMatch) met++;

    // ── 7. MACD Signal Cross ──────────────────────────────────────
    const macd = this._computeMACD(candles, 12, 26, 9);
    const macdMatch = isBuy
      ? (macd.histogram > 0 && macd.previousHistogram <= 0) || (macd.histogram > 0 && macd.macdLine > 0)
      : (macd.histogram < 0 && macd.previousHistogram >= 0) || (macd.histogram < 0 && macd.macdLine < 0);
    checklist.push({
      id:     'macd',
      name:   'MACD Signal Cross',
      status: macdMatch ? 'met' : 'missed',
      detail: `MACD = ${macd.macdLine.toFixed(3)}, Signal = ${macd.signalLine.toFixed(3)}, Hist = ${macd.histogram.toFixed(3)}`,
    });
    if (macdMatch) met++;

    // ── 8. Horizon Zone Touch ─────────────────────────────────────
    const current = candles[candles.length - 1];
    const zoneTouched = isBuy
      ? (smcResult.activeSupport && current.low <= smcResult.activeSupport.top && current.close >= smcResult.activeSupport.bottom)
      : (smcResult.activeResistance && current.high >= smcResult.activeResistance.bottom && current.close <= smcResult.activeResistance.top);
    const zoneDesc = isBuy
      ? smcResult.activeSupport
        ? `Support [${smcResult.activeSupport.bottom.toFixed(2)}–${smcResult.activeSupport.top.toFixed(2)}]`
        : 'No active support zone'
      : smcResult.activeResistance
        ? `Resistance [${smcResult.activeResistance.bottom.toFixed(2)}–${smcResult.activeResistance.top.toFixed(2)}]`
        : 'No active resistance zone';
    checklist.push({
      id:     'zone',
      name:   'Horizon Zone Interaction',
      status: zoneTouched ? 'met' : 'missed',
      detail: zoneTouched
        ? `Price touching ${zoneDesc}`
        : `Not interacting with ${zoneDesc}`,
    });
    if (zoneTouched) met++;

    // ── Score & Conviction ────────────────────────────────────────
    const total = checklist.length;
    const score = `${met}/${total}`;
    const pct = met / total;
    const conviction = pct >= 0.875 ? 'Extreme' : pct >= 0.75 ? 'High' : pct >= 0.5 ? 'Moderate' : 'Low';

    return {
      direction,
      met,
      total,
      score,
      conviction,
      label: `Confluence: ${score} Met — ${conviction} Conviction ${direction}`,
      checklist,
      rsi: +rsi.toFixed(1),
      macd,
    };
  }

  // ── BOS Detection ─────────────────────────────────────────────
  _detectBOS(candles) {
    const lookback = Math.min(50, candles.length - 1);
    const slice = candles.slice(-lookback);
    const highs = slice.map(c => Math.max(c.open, c.close));
    const lows  = slice.map(c => Math.min(c.open, c.close));

    const swingHighs = [];
    const swingLows  = [];
    const p = 3;

    for (let i = p; i < slice.length - p; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - p; j <= i + p; j++) {
        if (j !== i) {
          if (highs[j] >= highs[i]) isHigh = false;
          if (lows[j] <= lows[i])   isLow  = false;
        }
      }
      if (isHigh) swingHighs.push({ idx: i, price: highs[i] });
      if (isLow)  swingLows.push({ idx: i, price: lows[i] });
    }

    const latest = slice[slice.length - 1];
    const latestHigh = highs[highs.length - 1];
    const latestLow  = lows[lows.length - 1];

    // Bullish BOS: current price breaks above last swing high
    if (swingHighs.length >= 1) {
      const lastSH = swingHighs[swingHighs.length - 1];
      if (latestHigh > lastSH.price && lows[lows.length - 1] > lows[lastSH.idx]) {
        return { status: 'BOS_BULLISH', level: lastSH.price };
      }
    }
    // Bearish BOS: current price breaks below last swing low
    if (swingLows.length >= 1) {
      const lastSL = swingLows[swingLows.length - 1];
      if (latestLow < lastSL.price && highs[highs.length - 1] < highs[lastSL.idx]) {
        return { status: 'BOS_BEARISH', level: lastSL.price };
      }
    }

    return { status: 'NONE', level: 0 };
  }

  // ── CHoCH Detection ───────────────────────────────────────────
  _detectCHoCH(candles) {
    const slice = candles.slice(-40);
    const closes = slice.map(c => c.close);
    const n = closes.length;
    if (n < 10) return { status: 'NONE' };

    // Simple higher-low / lower-high flip detection
    const mid = Math.floor(n / 2);
    const firstHalf  = closes.slice(0, mid);
    const secondHalf = closes.slice(mid);

    const firstTrend  = closes[mid - 1] > closes[0] ? 'UP' : 'DOWN';
    const secondTrend = closes[n - 1] > closes[mid] ? 'UP' : 'DOWN';

    if (firstTrend === 'DOWN' && secondTrend === 'UP') {
      return { status: 'CHOCH_BULLISH' };
    }
    if (firstTrend === 'UP' && secondTrend === 'DOWN') {
      return { status: 'CHOCH_BEARISH' };
    }
    return { status: 'NONE' };
  }

  // ── FVG Detection ─────────────────────────────────────────────
  _detectFVG(candles, isBuy) {
    const slice = candles.slice(-30);
    for (let i = 2; i < slice.length; i++) {
      const prev2 = slice[i - 2];
      const mid   = slice[i - 1];
      const curr  = slice[i];

      if (isBuy) {
        // Bullish FVG: gap between prev2.high and curr.low with midCandle momentum
        if (curr.low > prev2.high && mid.close > mid.open) {
          // Unmitigated if current price is below the FVG
          const latestClose = candles[candles.length - 1].close;
          if (latestClose <= curr.low + (curr.low - prev2.high) * 2) {
            return { hasFVG: true, bottom: prev2.high, top: curr.low };
          }
        }
      } else {
        // Bearish FVG: gap between curr.high and prev2.low
        if (curr.high < prev2.low && mid.close < mid.open) {
          const latestClose = candles[candles.length - 1].close;
          if (latestClose >= curr.high - (prev2.low - curr.high) * 2) {
            return { hasFVG: true, bottom: curr.high, top: prev2.low };
          }
        }
      }
    }
    return { hasFVG: false, bottom: 0, top: 0 };
  }

  // ── Liquidity Sweep Detection ─────────────────────────────────
  _detectLiquiditySweep(candles, isBuy) {
    const lookback = Math.min(30, candles.length - 1);
    const slice = candles.slice(-(lookback + 1));
    const n = slice.length;

    if (isBuy) {
      // SSL Sweep: wick below recent equal lows then close above
      const lows = slice.slice(0, n - 1).map(c => c.low);
      const minLow = Math.min(...lows);
      const current = slice[n - 1];
      const prev    = slice[n - 2];
      if (current.low < minLow * 1.001 && current.close > minLow && current.close > current.open) {
        return { hasSweep: true, level: minLow };
      }
      // Equal lows within tolerance
      const eqTolerance = (lows[lows.length - 1] - Math.min(...lows)) / lows[lows.length - 1];
      if (eqTolerance < 0.002 && current.close > Math.min(...lows.slice(-3))) {
        return { hasSweep: true, level: Math.min(...lows.slice(-3)) };
      }
    } else {
      // BSL Sweep: wick above recent equal highs then close below
      const highs = slice.slice(0, n - 1).map(c => c.high);
      const maxHigh = Math.max(...highs);
      const current = slice[n - 1];
      if (current.high > maxHigh * 0.999 && current.close < maxHigh && current.close < current.open) {
        return { hasSweep: true, level: maxHigh };
      }
      const eqTolerance = (Math.max(...highs) - highs[highs.length - 1]) / highs[highs.length - 1];
      if (eqTolerance < 0.002 && current.close < Math.max(...highs.slice(-3))) {
        return { hasSweep: true, level: Math.max(...highs.slice(-3)) };
      }
    }
    return { hasSweep: false, level: 0 };
  }

  // ── Volume Delta ──────────────────────────────────────────────
  _computeVolumeDelta(candles) {
    const slice = candles.slice(-3);
    if (!slice[0].volume) return { bias: 'NEUTRAL', pct: 100 };

    let bullVol = 0, bearVol = 0, total = 0;
    for (const c of slice) {
      const v = c.volume || 0;
      if (c.close >= c.open) bullVol += v;
      else                    bearVol += v;
      total += v;
    }

    const avgVol = candles.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20;
    const pct = avgVol > 0 ? Math.round((total / 3 / avgVol) * 100) : 100;

    if (bullVol > bearVol * 1.3) return { bias: 'BULLISH', pct };
    if (bearVol > bullVol * 1.3) return { bias: 'BEARISH', pct };
    return { bias: 'NEUTRAL', pct };
  }

  // ── RSI(14) ───────────────────────────────────────────────────
  _computeRSI(candles, period = 14) {
    if (candles.length < period + 1) return 50;
    const closes = candles.map(c => c.close);
    let gains = 0, losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains  += diff;
      else           losses -= diff;
    }

    const avgGain = gains  / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // ── MACD (12/26/9) ────────────────────────────────────────────
  _computeMACD(candles, fast = 12, slow = 26, signal = 9) {
    const closes = candles.map(c => c.close);
    if (closes.length < slow + signal) {
      return { macdLine: 0, signalLine: 0, histogram: 0, previousHistogram: 0 };
    }

    const emaFast   = this._ema(closes, fast);
    const emaSlow   = this._ema(closes, slow);
    const macdSeries = emaFast.map((v, i) => v - emaSlow[i]).slice(slow - fast);
    const signalLine = this._ema(macdSeries, signal);

    const lastIdx    = signalLine.length - 1;
    const macdLine   = macdSeries[macdSeries.length - 1];
    const sigLine    = signalLine[lastIdx];
    const histogram  = macdLine - sigLine;
    const prevHist   = lastIdx > 0
      ? macdSeries[macdSeries.length - 2] - signalLine[lastIdx - 1]
      : 0;

    return {
      macdLine:          +macdLine.toFixed(4),
      signalLine:        +sigLine.toFixed(4),
      histogram:         +histogram.toFixed(4),
      previousHistogram: +prevHist.toFixed(4),
    };
  }

  _ema(values, period) {
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

  _emptyResult(direction) {
    return {
      direction,
      met: 0,
      total: 8,
      score: '0/8',
      conviction: 'Low',
      label: `Confluence: 0/8 Met — Insufficient Data`,
      checklist: [],
      rsi: 50,
      macd: { macdLine: 0, signalLine: 0, histogram: 0, previousHistogram: 0 },
    };
  }
}
