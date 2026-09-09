/**
 * fourLaneEngine.js — TradersZone.ai Core Signal Engine
 *
 * Synthesizes Yashwanth's Pine Script Horizon S/R Blocks into:
 *   • Clear BUY, SELL, or WAIT signals
 *   • Precise 1–2 sentence AI explanations referencing exact S/R block boundaries
 *   • Historical BUY / SELL trigger points for chart markers
 */

import { SMCEngine } from './smcEngine.js';

export class FourLaneEngine {
  constructor(options = {}) {
    this.smc = new SMCEngine(options);
  }

  async analyze({ candles, symbol, timeframe, htfTrend = 'NEUTRAL' }) {
    if (!candles || candles.length < 25) {
      return this._emptyVerdict(symbol, timeframe);
    }

    const currentPrice = candles[candles.length - 1].close;
    const smc = this.smc.analyze(candles, htfTrend);

    const { horizonZones, activeSupport, activeResistance, bullScore, bearScore, historicalSignals, atr } = smc;

    const isJPY = symbol.includes('JPY');
    const decimals = isJPY ? 3 : (symbol.includes('USD') && !symbol.includes('USDT') && !symbol.includes('XAU') ? 5 : 2);

    // ─── BUY SIGNAL GENERATION ────────────────────────────────────
    if (bullScore >= 3 || (activeSupport && candles[candles.length - 1].low <= activeSupport.top && currentPrice >= activeSupport.bottom && currentPrice > candles[candles.length - 1].open)) {
      const stop = activeSupport ? activeSupport.bottom : (currentPrice - atr * 1.5);
      const target = activeResistance ? activeResistance.bottom : (currentPrice + atr * 2.5);
      const risk = currentPrice - stop;
      const reward = target - currentPrice;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const supDesc = activeSupport ? `Support Floor [${activeSupport.bottom.toFixed(decimals)} - ${activeSupport.top.toFixed(decimals)}]` : 'key support';

      return {
        verdict: 'BUY',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: Math.min(95, Math.round(70 + bullScore * 5)),
        aiReason: `Buy: Price formed a strong bullish bounce off ${supDesc} anchored to candle bodies with high volume absorption.`,
        levels: {
          entry: +currentPrice.toFixed(decimals),
          target: +target.toFixed(decimals),
          stop: +stop.toFixed(decimals),
          targetPct: +(((target - currentPrice) / currentPrice) * 100).toFixed(2),
          stopPct: -+(((currentPrice - stop) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        horizonZones,
        historicalSignals,
      };
    }

    // ─── SELL SIGNAL GENERATION ───────────────────────────────────
    if (bearScore >= 3 || (activeResistance && candles[candles.length - 1].high >= activeResistance.bottom && currentPrice <= activeResistance.top && currentPrice < candles[candles.length - 1].open)) {
      const stop = activeResistance ? activeResistance.top : (currentPrice + atr * 1.5);
      const target = activeSupport ? activeSupport.top : (currentPrice - atr * 2.5);
      const risk = stop - currentPrice;
      const reward = currentPrice - target;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const resDesc = activeResistance ? `Resistance Ceiling [${activeResistance.bottom.toFixed(decimals)} - ${activeResistance.top.toFixed(decimals)}]` : 'key resistance';

      return {
        verdict: 'SELL',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: Math.min(95, Math.round(70 + bearScore * 5)),
        aiReason: `Sell: Price rejected ${resDesc} anchored to candle bodies, confirming a downward reversal with distribution pressure.`,
        levels: {
          entry: +currentPrice.toFixed(decimals),
          target: +target.toFixed(decimals),
          stop: +stop.toFixed(decimals),
          targetPct: -+(((currentPrice - target) / currentPrice) * 100).toFixed(2),
          stopPct: -+(((stop - currentPrice) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        horizonZones,
        historicalSignals,
      };
    }

    // ─── WAIT VERDICT (WITH EXACT S/R SPREAD EXPLANATION) ──────────
    const supLabel = activeSupport ? activeSupport.bottom.toFixed(decimals) : '—';
    const resLabel = activeResistance ? activeResistance.top.toFixed(decimals) : '—';

    return {
      verdict: 'WAIT',
      symbol,
      timeframe,
      currentPrice: +currentPrice.toFixed(decimals),
      confidence: 50,
      aiReason: `Wait: Price is ranging in equilibrium between Support [${supLabel}] and Resistance [${resLabel}]. Stand aside until candle bodies test corridor boundaries.`,
      levels: {
        entry: +currentPrice.toFixed(decimals),
        target: null,
        stop: null,
        targetPct: null,
        stopPct: null,
        riskReward: null,
      },
      horizonZones,
      historicalSignals,
    };
  }

  _emptyVerdict(symbol, timeframe) {
    return {
      verdict: 'WAIT',
      symbol,
      timeframe,
      currentPrice: 0,
      confidence: 0,
      aiReason: 'Wait: Streaming historical candle data to construct Support and Resistance Horizon blocks…',
      levels: { entry: 0, target: null, stop: null, targetPct: null, stopPct: null, riskReward: null },
      horizonZones: [],
      historicalSignals: [],
    };
  }
}
