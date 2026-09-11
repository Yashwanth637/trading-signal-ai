/**
 * smcEngine.js — Smart Money Concepts & Yashwanth's Horizon Zone Engine
 *
 * Implements Yashwanth's exact Pine Script v6 algorithm:
 *   - Pivot High & Low strictly on candle BODIES: Math.max(open, close) & Math.min(open, close)
 *   - Base Zone Thickness: ATR(14) * 0.4
 *   - Anti-Stacking Range: ATR(14) * 1.2 (merges nested/adjacent blocks into unified corridors)
 *   - Resistance Ceiling: Cyan (#00bcd4) from p_high down by block_height
 *   - Support Floor: Yellow/Gold (#ffeb3b) from p_low up by block_height
 *   - Real-time breach detection: Freezes right edge when closed beyond, extends unbreached zones ahead!
 */

export class SMCEngine {
  constructor(options = {}) {
    this.pivotLen = options.pivotLen || 5;
    this.blockAtrMult = options.blockAtrMult || 0.4;
    this.overlapTolerance = options.overlapTolerance || 1.2;
    this.barsAhead = options.barsAhead || 10;
    this.historyBuffer = options.historyBuffer || 500;
  }

  /**
   * Main analysis entry point
   * @param {Array} candles
   * @param {string} [htfTrend='NEUTRAL']
   */
  analyze(candles, htfTrend = 'NEUTRAL') {
    if (!candles || candles.length < this.pivotLen * 2 + 5) {
      return this._emptyResult();
    }

    const atr = this.calculateATR(candles, 14);
    const horizonZones = this.computeYashwanthHorizonZones(candles, atr);

    // Evaluate current price relation to the horizon zones
    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2] || current;

    let bullScore = 0;
    let bearScore = 0;
    let activeSupport = null;
    let activeResistance = null;

    // Find nearest unbreached support and resistance blocks
    const unbreachedSup = horizonZones.filter(z => !z.isResistance && !z.isBreached);
    const unbreachedRes = horizonZones.filter(z => z.isResistance && !z.isBreached);

    if (unbreachedSup.length > 0) {
      unbreachedSup.sort((a, b) => b.top - a.top);
      activeSupport = unbreachedSup.find(s => current.close >= s.bottom) || unbreachedSup[0];
    }
    if (unbreachedRes.length > 0) {
      unbreachedRes.sort((a, b) => a.bottom - b.bottom);
      activeResistance = unbreachedRes.find(r => current.close <= r.top) || unbreachedRes[0];
    }

    // Check interaction with Support block (BUY trigger)
    if (activeSupport) {
      const insideOrBounced = current.low <= activeSupport.top && current.close >= activeSupport.bottom;
      if (insideOrBounced && current.close > current.open) {
        bullScore += 4; // Strong body bounce from Support Floor
      } else if (current.close > activeSupport.top && prev.close <= activeSupport.top) {
        bullScore += 3; // Breakout retest holding above support
      }
    }

    // Check interaction with Resistance block (SELL trigger)
    if (activeResistance) {
      const insideOrRejected = current.high >= activeResistance.bottom && current.close <= activeResistance.top;
      if (insideOrRejected && current.close < current.open) {
        bearScore += 4; // Rejection from Resistance Ceiling
      } else if (current.close < activeResistance.bottom && prev.close >= activeResistance.bottom) {
        bearScore += 3; // Breakdown confirmed below resistance
      }
    }

    // HTF Alignment bonus
    if (htfTrend === 'BULLISH') bullScore += 1;
    if (htfTrend === 'BEARISH') bearScore += 1;

    // Scan historical signal events along the candles
    const historicalSignals = this._extractHistoricalSignals(candles, horizonZones);

    return {
      bullScore,
      bearScore,
      horizonZones,
      activeSupport,
      activeResistance,
      historicalSignals,
      atr,
    };
  }

  /**
   * 1:1 Implementation of Yashwanth's Pine Script v6 Horizon Zone Engine
   */
  computeYashwanthHorizonZones(candles, atr) {
    const pivotLen = this.pivotLen;
    const baseBlockHeight = atr * this.blockAtrMult;
    const strictClearance = atr * this.overlapTolerance;
    const len = candles.length;
    const stepSeconds = candles.length >= 2 ? (candles[1].time - candles[0].time) : 3600;

    // Body Highs and Body Lows strictly to candle bodies
    const bodyHighs = candles.map(c => Math.max(c.open, c.close));
    const bodyLows  = candles.map(c => Math.min(c.open, c.close));

    // Zone Registry
    const zoneRegistry = [];

    // Helper: process horizon discovery with anti-stacking collapse
    const processStructuralHorizon = (baseLvl, isRes, originIdx) => {
      const tVal = isRes ? baseLvl : baseLvl + baseBlockHeight;
      const bVal = isRes ? baseLvl - baseBlockHeight : baseLvl;
      let coreConflict = false;

      // ANTI-STACKING RULE
      for (let i = zoneRegistry.length - 1; i >= 0; i--) {
        const z = zoneRegistry[i];
        if (z.isResistance === isRes && !z.isBreached) {
          const currentMid = (z.top + z.bottom) / 2.0;
          const newMid     = (tVal + bVal) / 2.0;

          if (Math.abs(currentMid - newMid) <= strictClearance) {
            // Forcibly collapse them together by averaging positions, keeping height locked
            const balancedMid = (currentMid + newMid) / 2.0;
            z.top    = balancedMid + (baseBlockHeight / 2.0);
            z.bottom = z.top - baseBlockHeight;
            coreConflict = true;
            break;
          }
        }
      }

      if (!coreConflict) {
        zoneRegistry.push({
          top: tVal,
          bottom: bVal,
          isResistance: isRes,
          originIdx,
          originTime: candles[originIdx].time,
          breachIdx: null,
          breachTime: null,
          isBreached: false,
        });
      }
    };

    // Detect Pivot Highs & Pivot Lows
    for (let i = pivotLen; i < len - pivotLen; i++) {
      // Pivot High: bodyHighs[i] strictly highest in [i-pivotLen, i+pivotLen]
      let isPHigh = true;
      for (let j = i - pivotLen; j <= i + pivotLen; j++) {
        if (j !== i && bodyHighs[j] >= bodyHighs[i]) {
          isPHigh = false;
          break;
        }
      }
      if (isPHigh) {
        processStructuralHorizon(bodyHighs[i], true, i);
      }

      // Pivot Low: bodyLows[i] strictly lowest in [i-pivotLen, i+pivotLen]
      let isPLow = true;
      for (let j = i - pivotLen; j <= i + pivotLen; j++) {
        if (j !== i && bodyLows[j] <= bodyLows[i]) {
          isPLow = false;
          break;
        }
      }
      if (isPLow) {
        processStructuralHorizon(bodyLows[i], false, i);
      }
    }

    // REAL-TIME RETRACTION & RUNWAY ENGINE (Breach Check)
    const latestTime = candles[len - 1].time;
    const futureTime = latestTime + this.barsAhead * stepSeconds;

    for (const z of zoneRegistry) {
      for (let i = z.originIdx + 1; i < len; i++) {
        const c = candles[i];
        const breakRes = z.isResistance && c.close > z.top;
        const breakSup = !z.isResistance && c.close < z.bottom;

        if (breakRes || breakSup) {
          z.isBreached = true;
          z.breachIdx = i;
          z.breachTime = c.time;
          break;
        }
      }
      z.endTime = z.isBreached ? z.breachTime : futureTime;
    }

    return zoneRegistry;
  }

  /**
   * Scan candle history to detect confirmed BUY and SELL touch/bounce events
   */
  _extractHistoricalSignals(candles, horizonZones) {
    const signals = [];
    const minSpacing = 8;
    let lastSignalIdx = -minSpacing;

    for (let i = 20; i < candles.length; i++) {
      if (i - lastSignalIdx < minSpacing) continue;

      const c = candles[i];
      const range = c.high - c.low;
      if (range <= 0) continue;

      const body = Math.abs(c.close - c.open);
      const bodyRatio = body / range;

      // Check Support floor bounce (BUY)
      // Must have bullish body with lower rejection wick
      const isBullRejection = c.close > c.open && bodyRatio >= 0.30 && ((c.open - c.low) >= (c.high - c.close) * 0.7);
      const sup = horizonZones.find(z =>
        !z.isResistance &&
        z.originIdx < i &&
        (!z.isBreached || z.breachIdx >= i) &&
        c.low <= (z.top + range * 0.1) && c.close >= z.bottom
      );

      if (sup && isBullRejection) {
        signals.push({
          time: c.time,
          type: 'BUY',
          price: c.close,
          stop: sup.bottom,
          target: c.close + (c.close - sup.bottom) * 2.2,
          text: 'BUY',
        });
        lastSignalIdx = i;
        continue;
      }

      // Check Resistance ceiling rejection (SELL)
      // Must have bearish body with upper rejection wick
      const isBearRejection = c.close < c.open && bodyRatio >= 0.30 && ((c.high - c.open) >= (c.close - c.low) * 0.7);
      const res = horizonZones.find(z =>
        z.isResistance &&
        z.originIdx < i &&
        (!z.isBreached || z.breachIdx >= i) &&
        c.high >= (z.bottom - range * 0.1) && c.close <= z.top
      );

      if (res && isBearRejection) {
        signals.push({
          time: c.time,
          type: 'SELL',
          price: c.close,
          stop: res.top,
          target: c.close - (res.top - c.close) * 2.2,
          text: 'SELL',
        });
        lastSignalIdx = i;
      }
    }

    return signals;
  }

  calculateATR(candles, period = 14) {
    if (!candles || candles.length < 2) return 1.0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length || 1.0;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr || 1.0;
  }

  _emptyResult() {
    return {
      bullScore: 0,
      bearScore: 0,
      horizonZones: [],
      activeSupport: null,
      activeResistance: null,
      historicalSignals: [],
      atr: 1.0,
    };
  }
}
