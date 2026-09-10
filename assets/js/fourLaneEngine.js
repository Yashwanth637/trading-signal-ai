/**
 * fourLaneEngine.js — TradersZone.ai Core Signal Engine
 *
 * Synthesizes Yashwanth's Pine Script Horizon S/R Blocks into:
 *   • Clear BUY, SELL, or WAIT signals
 *   • 8-criteria Confluence Checklist with conviction score
 *   • MTF alignment gating (requires ≥2/3 of 15M, 1H, 4H aligned)
 *   • Historical BUY / SELL trigger points for chart markers
 */

import { SMCEngine } from './smcEngine.js';
import { ConfluenceEngine } from './confluenceEngine.js';

export class FourLaneEngine {
  constructor(options = {}) {
    this.smc         = new SMCEngine(options);
    this.confluence  = new ConfluenceEngine();
    this._mtfMatrix  = null; // Set externally by app.js / signalEngine.js
  }

  /** Allow the MTF engine matrix to be injected */
  setMTFMatrix(matrix) {
    this._mtfMatrix = matrix;
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

    // ── MTF Alignment Check ────────────────────────────────────────
    const mtf        = this._mtfMatrix || {};
    const keyTFs     = ['15M', '1H', '4H'];
    const bullTFCount = keyTFs.filter(tf => mtf[tf] === 'BULLISH').length;
    const bearTFCount = keyTFs.filter(tf => mtf[tf] === 'BEARISH').length;
    const mtfAllowBuy  = bullTFCount >= 2;
    const mtfAllowSell = bearTFCount >= 2;

    // ─── BUY SIGNAL GENERATION ────────────────────────────────────
    const buyTriggered = bullScore >= 3 || (
      activeSupport &&
      candles[candles.length - 1].low <= activeSupport.top &&
      currentPrice >= activeSupport.bottom &&
      currentPrice > candles[candles.length - 1].open
    );

    if (buyTriggered && mtfAllowBuy) {
      const stop   = activeSupport ? activeSupport.bottom : (currentPrice - atr * 1.5);
      const target = activeResistance ? activeResistance.bottom : (currentPrice + atr * 2.5);
      const risk   = currentPrice - stop;
      const reward = target - currentPrice;
      const rr     = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const supDesc = activeSupport
        ? `Support Floor [${activeSupport.bottom.toFixed(decimals)} – ${activeSupport.top.toFixed(decimals)}]`
        : 'key support';

      const conf = this.confluence.compute(candles, smc, 'BUY');

      const tp2 = +(currentPrice + risk * 3.0).toFixed(decimals);
      const runner = +(currentPrice + risk * 5.0).toFixed(decimals);

      return {
        verdict: 'BUY',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: Math.min(95, Math.round(60 + conf.met * 4.5)),
        aiReason: `Buy: Price formed a strong bullish bounce off ${supDesc} with body confirmation. ${conf.conviction} conviction — ${conf.score} criteria met.`,
        confluence: conf,
        levels: {
          entry:     +currentPrice.toFixed(decimals),
          target:    +target.toFixed(decimals),
          stop:      +stop.toFixed(decimals),
          tp2:       +tp2,
          runner:    +runner,
          targetPct: +(((target - currentPrice) / currentPrice) * 100).toFixed(2),
          stopPct:   -+(((currentPrice - stop) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        mtfMatrix: { ...mtf },
        horizonZones,
        historicalSignals,
      };
    }

    // ─── SELL SIGNAL GENERATION ───────────────────────────────────
    const sellTriggered = bearScore >= 3 || (
      activeResistance &&
      candles[candles.length - 1].high >= activeResistance.bottom &&
      currentPrice <= activeResistance.top &&
      currentPrice < candles[candles.length - 1].open
    );

    if (sellTriggered && mtfAllowSell) {
      const stop   = activeResistance ? activeResistance.top : (currentPrice + atr * 1.5);
      const target = activeSupport ? activeSupport.top : (currentPrice - atr * 2.5);
      const risk   = stop - currentPrice;
      const reward = currentPrice - target;
      const rr     = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;
      const tp2    = +(currentPrice - risk * 3.0).toFixed(decimals);
      const runner = +(currentPrice - risk * 5.0).toFixed(decimals);

      const resDesc = activeResistance
        ? `Resistance Ceiling [${activeResistance.bottom.toFixed(decimals)} – ${activeResistance.top.toFixed(decimals)}]`
        : 'key resistance';

      const conf = this.confluence.compute(candles, smc, 'SELL');

      return {
        verdict: 'SELL',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: Math.min(95, Math.round(60 + conf.met * 4.5)),
        aiReason: `Sell: Price rejected ${resDesc} with distribution candle body confirmation. ${conf.conviction} conviction — ${conf.score} criteria met.`,
        confluence: conf,
        levels: {
          entry:     +currentPrice.toFixed(decimals),
          target:    +target.toFixed(decimals),
          stop:      +stop.toFixed(decimals),
          tp2:       +tp2,
          runner:    +runner,
          targetPct: -+(((currentPrice - target) / currentPrice) * 100).toFixed(2),
          stopPct:   -+(((stop - currentPrice) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        mtfMatrix: { ...mtf },
        horizonZones,
        historicalSignals,
      };
    }

    // ─── WAIT VERDICT ──────────────────────────────────────────────
    const supLabel = activeSupport ? activeSupport.bottom.toFixed(decimals) : '—';
    const resLabel = activeResistance ? activeResistance.top.toFixed(decimals) : '—';

    // Explain WHY we're waiting (MTF conflict vs equilibrium)
    let waitReason;
    if (buyTriggered && !mtfAllowBuy) {
      waitReason = `Wait: A support bounce signal fired on ${timeframe}, but only ${bullTFCount}/3 higher timeframes confirm bullish bias. Waiting for MTF alignment (need 15M, 1H, or 4H to align bullish).`;
    } else if (sellTriggered && !mtfAllowSell) {
      waitReason = `Wait: A resistance rejection signal fired on ${timeframe}, but only ${bearTFCount}/3 higher timeframes confirm bearish bias. Waiting for MTF confirmation before entry.`;
    } else {
      waitReason = `Wait: Price is ranging in equilibrium between Support [${supLabel}] and Resistance [${resLabel}]. Stand aside until candle bodies test corridor boundaries.`;
    }

    // Compute confluence for the most likely direction (for UI display)
    const pendingDir = buyTriggered ? 'BUY' : sellTriggered ? 'SELL' : 'BUY';
    const conf = this.confluence.compute(candles, smc, pendingDir);

    return {
      verdict: 'WAIT',
      symbol,
      timeframe,
      currentPrice: +currentPrice.toFixed(decimals),
      confidence: 50,
      aiReason: waitReason,
      confluence: conf,
      levels: {
        entry: +currentPrice.toFixed(decimals),
        target: null,
        stop: null,
        targetPct: null,
        stopPct: null,
        riskReward: null,
      },
      mtfMatrix: { ...mtf },
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
      aiReason: 'Wait: Streaming historical candle data to construct S/R Horizon blocks…',
      confluence: null,
      levels: { entry: 0, target: null, stop: null, targetPct: null, stopPct: null, riskReward: null },
      mtfMatrix: {},
      horizonZones: [],
      historicalSignals: [],
    };
  }
}
