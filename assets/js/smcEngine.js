/**
 * smcEngine.js — Smart Money Concepts Logic Engine
 * Deterministic, rule-based SMC analysis. No external dependencies.
 * Runs entirely in the browser.
 *
 * Exports: SMCEngine class
 */

export class SMCEngine {
  /**
   * @param {Object} options
   * @param {number} options.swingLookback    Bars left/right to confirm swing (default 5)
   * @param {number} options.equalTolerance   % tolerance for equal H/L (default 0.0015)
   * @param {number} options.zoneBuffer       % buffer for S/R zone thickness (default 0.002)
   * @param {number} options.minTouches       Min touches to validate S/R zone (default 2)
   * @param {number} options.fvgMinGap        Min FVG gap as % of price (default 0.0005)
   * @param {number} options.signalThreshold  Min confluence score to fire signal (default 5)
   */
  constructor(options = {}) {
    this.swingLookback    = options.swingLookback    ?? 5;
    this.equalTolerance   = options.equalTolerance   ?? 0.0015;
    this.zoneBuffer       = options.zoneBuffer       ?? 0.002;
    this.minTouches       = options.minTouches       ?? 2;
    this.fvgMinGap        = options.fvgMinGap        ?? 0.0005;
    this.signalThreshold  = options.signalThreshold  ?? 5;
  }

  // ─────────────────────────────────────────────────────────────
  // 1. SWING POINTS
  // ─────────────────────────────────────────────────────────────

  /**
   * Detect swing highs and lows using a left/right lookback window.
   * @param {Candle[]} candles
   * @returns {{ swingHighs: SwingPoint[], swingLows: SwingPoint[] }}
   */
  detectSwingPoints(candles) {
    const lb = this.swingLookback;
    const swingHighs = [];
    const swingLows  = [];

    for (let i = lb; i < candles.length - lb; i++) {
      const c = candles[i];

      // Swing High: highest bar in window
      let isSwingHigh = true;
      let isSwingLow  = true;

      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) isSwingHigh = false;
        if (candles[j].low  <= c.low)  isSwingLow  = false;
      }

      if (isSwingHigh) swingHighs.push({ index: i, price: c.high, time: c.time });
      if (isSwingLow)  swingLows.push({ index: i, price: c.low,  time: c.time });
    }

    return { swingHighs, swingLows };
  }

  // ─────────────────────────────────────────────────────────────
  // 2. MARKET STRUCTURE (BOS / CHoCH)
  // ─────────────────────────────────────────────────────────────

  /**
   * Detect Break of Structure and Change of Character.
   * @param {Candle[]} candles
   * @param {SwingPoint[]} swingHighs
   * @param {SwingPoint[]} swingLows
   * @returns {{ trend: string, signal: string|null, bosIndex: number|null }}
   */
  detectMarketStructure(candles, swingHighs, swingLows) {
    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { trend: 'NEUTRAL', signal: null, bosIndex: null };
    }

    const lastHH  = swingHighs[swingHighs.length - 1];
    const prevHH  = swingHighs[swingHighs.length - 2];
    const lastLL  = swingLows[swingLows.length - 1];
    const prevLL  = swingLows[swingLows.length - 2];

    // Determine HTF trend from swing structure
    let trend = 'NEUTRAL';
    if (lastHH.price > prevHH.price && lastLL.price > prevLL.price) {
      trend = 'BULLISH'; // Higher High + Higher Low
    } else if (lastHH.price < prevHH.price && lastLL.price < prevLL.price) {
      trend = 'BEARISH'; // Lower High + Lower Low
    }

    const currentClose = candles[candles.length - 1].close;
    const currentIndex = candles.length - 1;

    let signal   = null;
    let bosIndex = null;

    if (trend === 'BULLISH') {
      if (currentClose > lastHH.price) {
        signal   = 'BOS_BULL';
        bosIndex = currentIndex;
      } else if (currentClose < lastLL.price) {
        signal   = 'CHOCH_BEAR'; // trend reversal
        bosIndex = currentIndex;
      }
    } else if (trend === 'BEARISH') {
      if (currentClose < lastLL.price) {
        signal   = 'BOS_BEAR';
        bosIndex = currentIndex;
      } else if (currentClose > lastHH.price) {
        signal   = 'CHOCH_BULL'; // trend reversal
        bosIndex = currentIndex;
      }
    }

    return { trend, signal, bosIndex, lastHH, lastLL };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. LIQUIDITY SWEEPS
  // ─────────────────────────────────────────────────────────────

  /**
   * Detect equal highs/lows (liquidity pools) and identify sweeps.
   * @param {Candle[]} candles
   * @param {SwingPoint[]} swingHighs
   * @param {SwingPoint[]} swingLows
   * @returns {{ equalHighs: LiqZone[], equalLows: LiqZone[], sweeps: Sweep[] }}
   */
  detectLiquiditySweeps(candles, swingHighs, swingLows) {
    const tol = this.equalTolerance;
    const equalHighs = [];
    const equalLows  = [];
    const sweeps     = [];

    // Find equal highs
    for (let i = 0; i < swingHighs.length - 1; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        const diff = Math.abs(swingHighs[i].price - swingHighs[j].price) / swingHighs[i].price;
        if (diff < tol) {
          const zone = {
            price: (swingHighs[i].price + swingHighs[j].price) / 2,
            type: 'EQUAL_HIGH',
            time1: swingHighs[i].time,
            time2: swingHighs[j].time,
          };
          // Avoid duplicates
          if (!equalHighs.some(z => Math.abs(z.price - zone.price) / zone.price < tol)) {
            equalHighs.push(zone);
          }
        }
      }
    }

    // Find equal lows
    for (let i = 0; i < swingLows.length - 1; i++) {
      for (let j = i + 1; j < swingLows.length; j++) {
        const diff = Math.abs(swingLows[i].price - swingLows[j].price) / swingLows[i].price;
        if (diff < tol) {
          const zone = {
            price: (swingLows[i].price + swingLows[j].price) / 2,
            type: 'EQUAL_LOW',
            time1: swingLows[i].time,
            time2: swingLows[j].time,
          };
          if (!equalLows.some(z => Math.abs(z.price - zone.price) / zone.price < tol)) {
            equalLows.push(zone);
          }
        }
      }
    }

    const current = candles[candles.length - 1];

    // Detect buy-side liquidity sweep (wick above EQH, close below)
    for (const zone of equalHighs) {
      if (current.high > zone.price && current.close < zone.price) {
        sweeps.push({
          type: 'BSL_SWEEP',      // Buy-side liquidity swept
          direction: 'BEARISH',   // Expect bearish move after
          price: zone.price,
          time: current.time,
        });
      }
    }

    // Detect sell-side liquidity sweep (wick below EQL, close above)
    for (const zone of equalLows) {
      if (current.low < zone.price && current.close > zone.price) {
        sweeps.push({
          type: 'SSL_SWEEP',     // Sell-side liquidity swept
          direction: 'BULLISH',  // Expect bullish move after
          price: zone.price,
          time: current.time,
        });
      }
    }

    return { equalHighs, equalLows, sweeps };
  }

  // ─────────────────────────────────────────────────────────────
  // 4. SUPPORT & RESISTANCE ZONES
  // ─────────────────────────────────────────────────────────────

  /**
   * Build S/R zones by clustering swing points within zoneBuffer tolerance.
   * @param {SwingPoint[]} swingHighs
   * @param {SwingPoint[]} swingLows
   * @param {number} currentPrice
   * @returns {SRZone[]}
   */
  buildSRZones(swingHighs, swingLows, currentPrice) {
    const buf = this.zoneBuffer;
    const minT = this.minTouches;

    // Pool all swing levels with type tag
    const allLevels = [
      ...swingHighs.map(s => ({ ...s, swingType: 'HIGH' })),
      ...swingLows.map(s  => ({ ...s, swingType: 'LOW'  })),
    ].sort((a, b) => a.price - b.price);

    const zones = [];
    const used  = new Array(allLevels.length).fill(false);

    for (let i = 0; i < allLevels.length; i++) {
      if (used[i]) continue;
      const seed    = allLevels[i];
      const cluster = [seed];
      used[i] = true;

      for (let j = i + 1; j < allLevels.length; j++) {
        if (used[j]) continue;
        const diff = Math.abs(allLevels[j].price - seed.price) / seed.price;
        if (diff < buf) {
          cluster.push(allLevels[j]);
          used[j] = true;
        }
      }

      if (cluster.length >= minT) {
        const prices   = cluster.map(c => c.price);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const zoneTop  = Math.max(...prices) * (1 + buf / 2);
        const zoneBtm  = Math.min(...prices) * (1 - buf / 2);

        const isResistance = currentPrice < avgPrice;
        zones.push({
          top:      zoneTop,
          bottom:   zoneBtm,
          mid:      avgPrice,
          strength: cluster.length,
          type:     isResistance ? 'RESISTANCE' : 'SUPPORT',
          times:    cluster.map(c => c.time),
        });
      }
    }

    return zones.sort((a, b) => b.strength - a.strength);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. ORDER BLOCKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Detect order blocks — the last opposing candle before a BOS impulse.
   * @param {Candle[]} candles
   * @param {Array<{ signal: string, bosIndex: number }>} bosSignals
   * @returns {OrderBlock[]}
   */
  detectOrderBlocks(candles, bosSignals) {
    const orderBlocks = [];
    const currentPrice = candles[candles.length - 1].close;

    for (const bos of bosSignals) {
      if (bos.bosIndex === null) continue;
      const { signal, bosIndex } = bos;

      if (signal === 'BOS_BULL' || signal === 'CHOCH_BULL') {
        // Bullish OB = last bearish (red) candle before the bullish impulse
        for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 20); i--) {
          const c = candles[i];
          if (c.close < c.open) { // bearish candle
            orderBlocks.push({
              type:    'BULLISH_OB',
              top:     c.high,
              bottom:  c.low,
              open:    c.open,
              close:   c.close,
              time:    c.time,
              valid:   currentPrice > c.low, // invalidated if price closes below
            });
            break;
          }
        }
      }

      if (signal === 'BOS_BEAR' || signal === 'CHOCH_BEAR') {
        // Bearish OB = last bullish (green) candle before the bearish impulse
        for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 20); i--) {
          const c = candles[i];
          if (c.close > c.open) { // bullish candle
            orderBlocks.push({
              type:    'BEARISH_OB',
              top:     c.high,
              bottom:  c.low,
              open:    c.open,
              close:   c.close,
              time:    c.time,
              valid:   currentPrice < c.high, // invalidated if price closes above
            });
            break;
          }
        }
      }
    }

    // Remove duplicates within 0.1% of each other
    const unique = [];
    for (const ob of orderBlocks) {
      const dup = unique.some(u =>
        u.type === ob.type &&
        Math.abs(u.bottom - ob.bottom) / ob.bottom < 0.001
      );
      if (!dup) unique.push(ob);
    }

    return unique.filter(ob => ob.valid);
  }

  // ─────────────────────────────────────────────────────────────
  // 6. FAIR VALUE GAPS (FVG / IMBALANCE)
  // ─────────────────────────────────────────────────────────────

  /**
   * Detect Fair Value Gaps (three-candle imbalance pattern).
   * @param {Candle[]} candles
   * @returns {FVG[]}
   */
  detectFVG(candles) {
    const fvgs = [];
    const minGap = this.fvgMinGap;
    const currentPrice = candles[candles.length - 1].close;

    for (let i = 1; i < candles.length - 1; i++) {
      const c1 = candles[i - 1];
      const c3 = candles[i + 1];

      // Bullish FVG: c3.low > c1.high → upward gap
      if (c3.low > c1.high) {
        const gapSize = (c3.low - c1.high) / c1.high;
        if (gapSize >= minGap) {
          fvgs.push({
            type:   'BULLISH_FVG',
            top:    c3.low,
            bottom: c1.high,
            mid:    (c3.low + c1.high) / 2,
            time:   candles[i].time,
            filled: currentPrice <= c1.high, // filled when price returns to gap
          });
        }
      }

      // Bearish FVG: c3.high < c1.low → downward gap
      if (c3.high < c1.low) {
        const gapSize = (c1.low - c3.high) / c1.low;
        if (gapSize >= minGap) {
          fvgs.push({
            type:   'BEARISH_FVG',
            top:    c1.low,
            bottom: c3.high,
            mid:    (c1.low + c3.high) / 2,
            time:   candles[i].time,
            filled: currentPrice >= c1.low, // filled when price returns to gap
          });
        }
      }
    }

    // Keep only unfilled FVGs from last 100 candles
    return fvgs.filter(f => !f.filled).slice(-30);
  }

  // ─────────────────────────────────────────────────────────────
  // 7. ATR (Average True Range)
  // ─────────────────────────────────────────────────────────────

  /**
   * Calculate ATR(period) for SL/TP placement.
   * @param {Candle[]} candles
   * @param {number} period
   * @returns {number}
   */
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
      const c  = candles[i];
      const cp = candles[i - 1].close;
      const tr = Math.max(c.high - c.low, Math.abs(c.high - cp), Math.abs(c.low - cp));
      trValues.push(tr);
    }
    const recent = trValues.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  // ─────────────────────────────────────────────────────────────
  // 8. FULL ANALYSIS — Master entry point
  // ─────────────────────────────────────────────────────────────

  /**
   * Run full SMC analysis on a candle array.
   * Returns all detected structures + a signal recommendation.
   *
   * @param {Candle[]} candles  Array of { time, open, high, low, close, volume }
   * @param {string}   htfTrend 'BULLISH' | 'BEARISH' | 'NEUTRAL' (from higher timeframe)
   * @returns {SMCResult}
   */
  analyze(candles, htfTrend = 'NEUTRAL') {
    if (!candles || candles.length < this.swingLookback * 2 + 5) {
      return this._emptyResult();
    }

    const { swingHighs, swingLows } = this.detectSwingPoints(candles);
    const ms = this.detectMarketStructure(candles, swingHighs, swingLows);
    const liq = this.detectLiquiditySweeps(candles, swingHighs, swingLows);

    // Build OB list from current BOS signal
    const bosSignals = ms.signal ? [{ signal: ms.signal, bosIndex: ms.bosIndex }] : [];
    const orderBlocks = this.detectOrderBlocks(candles, bosSignals);

    const currentPrice = candles[candles.length - 1].close;
    const srZones = this.buildSRZones(swingHighs, swingLows, currentPrice);
    const fvgs    = this.detectFVG(candles);
    const atr     = this.calculateATR(candles);

    // ── Confluence Scoring ──────────────────────────────────────
    let bullScore = 0;
    let bearScore = 0;
    const reasons = [];

    // Condition A: HTF + LTF trend alignment (weight: 1)
    if (htfTrend === 'BULLISH' && ms.trend === 'BULLISH') {
      bullScore += 1;
      reasons.push('HTF + LTF Bullish alignment');
    }
    if (htfTrend === 'BEARISH' && ms.trend === 'BEARISH') {
      bearScore += 1;
      reasons.push('HTF + LTF Bearish alignment');
    }

    // Condition B: BOS / CHoCH (weight: 2-3)
    if (ms.signal === 'BOS_BULL')   { bullScore += 2; reasons.push('Bullish BOS confirmed'); }
    if (ms.signal === 'BOS_BEAR')   { bearScore += 2; reasons.push('Bearish BOS confirmed'); }
    if (ms.signal === 'CHOCH_BULL') { bullScore += 3; reasons.push('Bullish CHoCH — trend flip'); }
    if (ms.signal === 'CHOCH_BEAR') { bearScore += 3; reasons.push('Bearish CHoCH — trend flip'); }

    // Condition C: Liquidity Sweep (weight: 2)
    for (const sweep of liq.sweeps) {
      if (sweep.direction === 'BULLISH') {
        bullScore += 2;
        reasons.push(`SSL sweep at ${sweep.price.toFixed(5)} — bullish reversal expected`);
      }
      if (sweep.direction === 'BEARISH') {
        bearScore += 2;
        reasons.push(`BSL sweep at ${sweep.price.toFixed(5)} — bearish reversal expected`);
      }
    }

    // Condition D: Price at Order Block (weight: 2)
    for (const ob of orderBlocks) {
      if (ob.type === 'BULLISH_OB' && currentPrice >= ob.bottom && currentPrice <= ob.top) {
        bullScore += 2;
        reasons.push(`Price inside Bullish OB [${ob.bottom.toFixed(5)} – ${ob.top.toFixed(5)}]`);
      }
      if (ob.type === 'BEARISH_OB' && currentPrice >= ob.bottom && currentPrice <= ob.top) {
        bearScore += 2;
        reasons.push(`Price inside Bearish OB [${ob.bottom.toFixed(5)} – ${ob.top.toFixed(5)}]`);
      }
    }

    // Condition E: Price inside FVG (weight: 1)
    for (const fvg of fvgs) {
      if (fvg.type === 'BULLISH_FVG' && currentPrice >= fvg.bottom && currentPrice <= fvg.top) {
        bullScore += 1;
        reasons.push(`Price inside Bullish FVG [${fvg.bottom.toFixed(5)} – ${fvg.top.toFixed(5)}]`);
      }
      if (fvg.type === 'BEARISH_FVG' && currentPrice >= fvg.bottom && currentPrice <= fvg.top) {
        bearScore += 1;
        reasons.push(`Price inside Bearish FVG [${fvg.bottom.toFixed(5)} – ${fvg.top.toFixed(5)}]`);
      }
    }

    // Condition F: At S/R zone (weight: 1)
    for (const zone of srZones.slice(0, 5)) {
      if (zone.type === 'SUPPORT'    && currentPrice >= zone.bottom && currentPrice <= zone.top) {
        bullScore += 1;
        reasons.push(`Price at Support zone [${zone.bottom.toFixed(5)} – ${zone.top.toFixed(5)}]`);
      }
      if (zone.type === 'RESISTANCE' && currentPrice >= zone.bottom && currentPrice <= zone.top) {
        bearScore += 1;
        reasons.push(`Price at Resistance zone [${zone.bottom.toFixed(5)} – ${zone.top.toFixed(5)}]`);
      }
    }

    // ── Signal Decision ─────────────────────────────────────────
    const threshold = this.signalThreshold;
    let signal      = 'NEUTRAL';
    let confidence  = 0;
    let stopLoss    = null;
    let takeProfit  = null;
    let riskReward  = null;

    const nearestBullOB = orderBlocks.find(ob => ob.type === 'BULLISH_OB');
    const nearestBearOB = orderBlocks.find(ob => ob.type === 'BEARISH_OB');

    if (bullScore >= threshold && bullScore > bearScore) {
      signal     = 'BUY';
      confidence = Math.min(100, Math.round((bullScore / 10) * 100));
      stopLoss   = nearestBullOB
        ? nearestBullOB.bottom - atr * 0.5
        : (ms.lastLL ? ms.lastLL.price - atr * 0.5 : currentPrice - atr * 2);
      takeProfit = ms.lastHH ? ms.lastHH.price : currentPrice + atr * 3;
      const risk = currentPrice - stopLoss;
      const rwrd = takeProfit - currentPrice;
      riskReward = risk > 0 ? parseFloat((rwrd / risk).toFixed(2)) : 0;
    } else if (bearScore >= threshold && bearScore > bullScore) {
      signal     = 'SELL';
      confidence = Math.min(100, Math.round((bearScore / 10) * 100));
      stopLoss   = nearestBearOB
        ? nearestBearOB.top + atr * 0.5
        : (ms.lastHH ? ms.lastHH.price + atr * 0.5 : currentPrice + atr * 2);
      takeProfit = ms.lastLL ? ms.lastLL.price : currentPrice - atr * 3;
      const risk = stopLoss - currentPrice;
      const rwrd = currentPrice - takeProfit;
      riskReward = risk > 0 ? parseFloat((rwrd / risk).toFixed(2)) : 0;
    }

    return {
      signal,
      confidence,
      stopLoss,
      takeProfit,
      riskReward,
      entryPrice:  currentPrice,
      trend:       ms.trend,
      htfTrend,
      bosSignal:   ms.signal,
      swingHighs,
      swingLows,
      orderBlocks,
      fvgs,
      srZones,
      equalHighs:  liq.equalHighs,
      equalLows:   liq.equalLows,
      sweeps:      liq.sweeps,
      atr,
      bullScore,
      bearScore,
      reasons,
      timestamp:   Date.now(),
    };
  }

  _emptyResult() {
    return {
      signal: 'NEUTRAL', confidence: 0, stopLoss: null, takeProfit: null,
      riskReward: null, entryPrice: null, trend: 'NEUTRAL', htfTrend: 'NEUTRAL',
      bosSignal: null, swingHighs: [], swingLows: [], orderBlocks: [], fvgs: [],
      srZones: [], equalHighs: [], equalLows: [], sweeps: [], atr: 0,
      bullScore: 0, bearScore: 0, reasons: [], timestamp: Date.now(),
    };
  }
}

/**
 * @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number }} Candle
 * @typedef {{ index: number, price: number, time: number }} SwingPoint
 * @typedef {{ price: number, type: string, time1: number, time2: number }} LiqZone
 * @typedef {{ type: string, direction: string, price: number, time: number }} Sweep
 * @typedef {{ top: number, bottom: number, mid: number, strength: number, type: string }} SRZone
 * @typedef {{ type: string, top: number, bottom: number, time: number, valid: boolean }} OrderBlock
 * @typedef {{ type: string, top: number, bottom: number, mid: number, time: number, filled: boolean }} FVG
 */
