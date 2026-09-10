/**
 * fourLaneEngine.js — TradersZone.ai Core Signal Engine
 *
 * Synthesizes Yashwanth's Pine Script Horizon S/R Blocks into:
 *   • Predictive institutional BUY, SELL, or WAIT signals
 *   • Multi-candle structural validation (recent bounce, breakout retest, FVG fill)
 *   • 8-criteria Confluence Checklist with conviction score
 *   • Multi-Timeframe alignment gating (ensures no opposing HTF momentum)
 *   • Exact multi-tier targets: TP1 (1.5R), TP2 (3.0R), Runner (5.0R), and Stop Loss
 */

import { SMCEngine } from './smcEngine.js';
import { ConfluenceEngine } from './confluenceEngine.js';

export class FourLaneEngine {
  constructor(options = {}) {
    this.smc         = new SMCEngine(options);
    this.confluence  = new ConfluenceEngine();
    this._mtfMatrix  = null;
  }

  setMTFMatrix(matrix) {
    this._mtfMatrix = matrix;
  }

  async analyze({ candles, symbol, timeframe, htfTrend = 'NEUTRAL' }) {
    if (!candles || candles.length < 25) {
      return this._emptyVerdict(symbol, timeframe);
    }

    const len = candles.length;
    const current = candles[len - 1];
    const prev = candles[len - 2] || current;
    const currentPrice = current.close;

    // Run Yashwanth Pine Script v6 S/R Horizon Engine
    const smc = this.smc.analyze(candles, htfTrend);
    const { horizonZones, activeSupport, activeResistance, bullScore, bearScore, historicalSignals, atr } = smc;

    const isJPY = symbol.includes('JPY');
    const isGold = symbol.includes('XAU') || symbol.includes('PAXG');
    const decimals = isJPY ? 3 : (isGold ? 2 : (symbol.includes('USD') && !symbol.includes('USDT') ? 5 : 2));

    // ── Multi-Timeframe Bias Check ─────────────────────────────────
    const mtf = this._mtfMatrix || {};
    const keyTFs = ['15M', '1H', '4H'];
    const bullTFCount = keyTFs.filter(tf => mtf[tf] === 'BULLISH').length;
    const bearTFCount = keyTFs.filter(tf => mtf[tf] === 'BEARISH').length;

    // Strict safety: do not trade against a clear opposing HTF trend
    const noBearOppose = bearTFCount <= 1;
    const noBullOppose = bullTFCount <= 1;

    // ── Multi-Candle Structural Price Action Scan ──────────────────
    // Inspect last 3 candles for recent bounce or rejection
    const recentCandles = candles.slice(-4);
    let recentSupportBounce = false;
    let recentResistanceReject = false;
    let breakoutRetestHold = false;
    let breakdownRetestFail = false;

    if (activeSupport) {
      for (const c of recentCandles) {
        if (c.low <= activeSupport.top && c.close >= activeSupport.bottom && c.close > c.open) {
          recentSupportBounce = true;
          break;
        }
      }
      if (current.close > activeSupport.top && prev.close <= activeSupport.top) {
        breakoutRetestHold = true;
      }
    }

    if (activeResistance) {
      for (const c of recentCandles) {
        if (c.high >= activeResistance.bottom && c.close <= activeResistance.top && c.close < c.open) {
          recentResistanceReject = true;
          break;
        }
      }
      if (current.close < activeResistance.bottom && prev.close >= activeResistance.bottom) {
        breakdownRetestFail = true;
      }
    }

    // Compute Confluence for BUY and SELL candidates
    const confBuy  = this.confluence.compute(candles, smc, 'BUY');
    const confSell = this.confluence.compute(candles, smc, 'SELL');

    // High probability trigger criteria
    const buyTriggered = (
      (recentSupportBounce || breakoutRetestHold || bullScore >= 3) && confBuy.met >= 3
    ) || (confBuy.met >= 5 && current.close > current.open);

    const sellTriggered = (
      (recentResistanceReject || breakdownRetestFail || bearScore >= 3) && confSell.met >= 3
    ) || (confSell.met >= 5 && current.close < current.open);

    // ─── BUY SIGNAL GENERATION ────────────────────────────────────
    if (buyTriggered && noBearOppose && !sellTriggered) {
      const stop = activeSupport ? activeSupport.bottom : (currentPrice - atr * 1.5);
      const risk = Math.max(currentPrice * 0.004, currentPrice - stop);
      const target = activeResistance ? Math.max(currentPrice + risk * 1.5, activeResistance.bottom) : (currentPrice + risk * 2.5);
      const reward = target - currentPrice;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const tp1 = +(currentPrice + risk * 1.5).toFixed(decimals);
      const tp2 = +(currentPrice + risk * 3.0).toFixed(decimals);
      const runner = +(currentPrice + risk * 5.0).toFixed(decimals);

      const supDesc = activeSupport
        ? `Support Floor [${activeSupport.bottom.toFixed(decimals)} – ${activeSupport.top.toFixed(decimals)}]`
        : `Key Dynamic Support (${stop.toFixed(decimals)})`;

      const mtfStr = bullTFCount > 0 ? `${bullTFCount}/3 Higher TFs Bullish` : 'HTF Momentum Aligned';

      return {
        verdict: 'BUY',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: Math.min(96, Math.round(62 + confBuy.met * 4.2)),
        aiReason: `BUY: Bullish structural confirmation off ${supDesc}. High Conviction (${confBuy.score} Confluence Met): ${confBuy.checklist.find(c => c.status === 'met')?.name || 'Volume Delta'} expansion and ${mtfStr}. Target 1: ${tp1} (+${(((tp1 - currentPrice) / currentPrice) * 100).toFixed(2)}%), Stop Loss: ${stop.toFixed(decimals)}.`,
        confluence: confBuy,
        levels: {
          entry:     +currentPrice.toFixed(decimals),
          target:    +tp1,
          stop:      +stop.toFixed(decimals),
          tp2:       +tp2,
          runner:    +runner,
          targetPct: +(((tp1 - currentPrice) / currentPrice) * 100).toFixed(2),
          stopPct:   -+(((currentPrice - stop) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        mtfMatrix: { ...mtf },
        horizonZones,
        historicalSignals,
      };
    }

    // ─── SELL SIGNAL GENERATION ───────────────────────────────────
    if (sellTriggered && noBullOppose && !buyTriggered) {
      const stop = activeResistance ? activeResistance.top : (currentPrice + atr * 1.5);
      const risk = Math.max(currentPrice * 0.004, stop - currentPrice);
      const target = activeSupport ? Math.min(currentPrice - risk * 1.5, activeSupport.top) : (currentPrice - risk * 2.5);
      const reward = currentPrice - target;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const tp1 = +(currentPrice - risk * 1.5).toFixed(decimals);
      const tp2 = +(currentPrice - risk * 3.0).toFixed(decimals);
      const runner = +(currentPrice - risk * 5.0).toFixed(decimals);

      const resDesc = activeResistance
        ? `Resistance Ceiling [${activeResistance.bottom.toFixed(decimals)} – ${activeResistance.top.toFixed(decimals)}]`
        : `Key Dynamic Resistance (${stop.toFixed(decimals)})`;

      const mtfStr = bearTFCount > 0 ? `${bearTFCount}/3 Higher TFs Bearish` : 'HTF Momentum Aligned';

      return {
        verdict: 'SELL',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: Math.min(96, Math.round(62 + confSell.met * 4.2)),
        aiReason: `SELL: Bearish distribution rejection off ${resDesc}. High Conviction (${confSell.score} Confluence Met): ${confSell.checklist.find(c => c.status === 'met')?.name || 'Volume Delta'} pressure and ${mtfStr}. Target 1: ${tp1} (-${(((currentPrice - tp1) / currentPrice) * 100).toFixed(2)}%), Stop Loss: ${stop.toFixed(decimals)}.`,
        confluence: confSell,
        levels: {
          entry:     +currentPrice.toFixed(decimals),
          target:    +tp1,
          stop:      +stop.toFixed(decimals),
          tp2:       +tp2,
          runner:    +runner,
          targetPct: -+(((currentPrice - tp1) / currentPrice) * 100).toFixed(2),
          stopPct:   -+(((stop - currentPrice) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        mtfMatrix: { ...mtf },
        horizonZones,
        historicalSignals,
      };
    }

    // ─── WAIT VERDICT (QUANTITATIVE PRECISION) ─────────────────────
    const activeConf = confBuy.met >= confSell.met ? confBuy : confSell;
    const supLabel = activeSupport ? activeSupport.bottom.toFixed(decimals) : '—';
    const resLabel = activeResistance ? activeResistance.top.toFixed(decimals) : '—';

    let waitReason;
    if (buyTriggered && !noBearOppose) {
      waitReason = `WAIT: Support bounce detected at ${supLabel}, but higher timeframes indicate bearish pressure (${bearTFCount}/3 HTFs Bearish). Stand aside until higher timeframe alignment confirms.`;
    } else if (sellTriggered && !noBullOppose) {
      waitReason = `WAIT: Resistance test detected at ${resLabel}, but higher timeframes indicate bullish pressure (${bullTFCount}/3 HTFs Bullish). Stand aside until higher timeframe alignment confirms.`;
    } else {
      const distSup = activeSupport ? (((currentPrice - activeSupport.top) / currentPrice) * 100).toFixed(2) : '—';
      const distRes = activeResistance ? (((activeResistance.bottom - currentPrice) / currentPrice) * 100).toFixed(2) : '—';
      waitReason = `WAIT: Equilibrium consolidation at ${currentPrice.toFixed(decimals)}. Located +${distSup}% above Support [${supLabel}] and -${distRes}% below Resistance [${resLabel}]. Confluence: ${activeConf.score} (RSI: ${activeConf.rsi}). Awaiting corridor boundary test or confirmed Break of Structure.`;
    }

    return {
      verdict: 'WAIT',
      symbol,
      timeframe,
      currentPrice: +currentPrice.toFixed(decimals),
      confidence: 50,
      aiReason: waitReason,
      confluence: activeConf,
      levels: {
        entry: +currentPrice.toFixed(decimals),
        target: null,
        stop: null,
        tp2: null,
        runner: null,
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
      aiReason: 'WAIT: Initializing real-time market stream and calculating Yashwanth S/R Horizon blocks…',
      confluence: null,
      levels: { entry: 0, target: null, stop: null, tp2: null, runner: null, targetPct: null, stopPct: null, riskReward: null },
      mtfMatrix: {},
      horizonZones: [],
      historicalSignals: [],
    };
  }
}
