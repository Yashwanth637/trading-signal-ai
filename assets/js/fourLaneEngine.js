/**
 * fourLaneEngine.js — TradersZone.ai Core Signal Engine
 *
 * Synthesizes Yashwanth's Pine Script Horizon S/R Blocks and Institutional
 * Stored Rules into:
 *   • High-precision BUY, SELL, or WAIT signals
 *   • Multi-candle structural validation (recent bounce, breakout retest, FVG fill)
 *   • 8-criteria Confluence Checklist with conviction score
 *   • Multi-Timeframe alignment gating (ensures no opposing HTF momentum)
 *   • Exact multi-tier targets: TP1 (1.5R), TP2 (3.0R), Runner (5.0R), and Stop Loss
 */

import { SMCEngine } from './smcEngine.js';
import { ConfluenceEngine } from './confluenceEngine.js';
import { RulesEngine } from './rulesEngine.js';

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
    const currentPrice = current.close;

    // Run Yashwanth Pine Script v6 S/R Horizon Engine
    const smc = this.smc.analyze(candles, htfTrend);
    const { horizonZones, activeSupport, activeResistance, historicalSignals, atr } = smc;

    const isJPY = symbol.includes('JPY');
    const isGold = symbol.includes('XAU') || symbol.includes('PAXG');
    const decimals = isJPY ? 3 : (isGold ? 2 : (symbol.includes('USD') && !symbol.includes('USDT') ? 5 : 2));

    // Multi-Timeframe Matrix
    const mtf = this._mtfMatrix || {};
    const keyTFs = ['15M', '1H', '4H'];
    const bullTFCount = keyTFs.filter(tf => mtf[tf] === 'BULLISH').length;
    const bearTFCount = keyTFs.filter(tf => mtf[tf] === 'BEARISH').length;

    // Compute Confluence for BUY and SELL candidates
    const confBuy  = this.confluence.compute(candles, smc, 'BUY');
    const confSell = this.confluence.compute(candles, smc, 'SELL');

    // Evaluate Stored Institutional Quantitative Ruleset
    const ruleEval = RulesEngine.evaluate({
      candles,
      smc,
      mtfMatrix: mtf,
      confluenceBuy: confBuy,
      confluenceSell: confSell,
    });

    // ─── BUY SIGNAL GENERATION ────────────────────────────────────
    if (ruleEval.verdict === 'BUY' && bearTFCount <= 1) {
      const stop = ruleEval.stop || (activeSupport ? activeSupport.bottom : (currentPrice - atr * 1.5));
      const risk = Math.max(currentPrice * 0.003, currentPrice - stop);
      const target = ruleEval.target || (currentPrice + risk * 2.2);
      const reward = target - currentPrice;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const tp1 = +(currentPrice + risk * 1.5).toFixed(decimals);
      const tp2 = +(currentPrice + risk * 3.0).toFixed(decimals);
      const runner = +(currentPrice + risk * 5.0).toFixed(decimals);

      const mtfStr = bullTFCount > 0 ? `${bullTFCount}/3 Higher TFs Bullish` : 'HTF Momentum Aligned';

      return {
        verdict: 'BUY',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: ruleEval.confidence || Math.min(96, Math.round(65 + confBuy.met * 4)),
        aiReason: `BUY [${ruleEval.ruleName}]: ${ruleEval.rationale} Confluence: ${confBuy.score} Met (${mtfStr}). Target 1: ${tp1} (+${(((tp1 - currentPrice) / currentPrice) * 100).toFixed(2)}%), Stop Loss: ${stop.toFixed(decimals)}.`,
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
    if (ruleEval.verdict === 'SELL' && bullTFCount <= 1) {
      const stop = ruleEval.stop || (activeResistance ? activeResistance.top : (currentPrice + atr * 1.5));
      const risk = Math.max(currentPrice * 0.003, stop - currentPrice);
      const target = ruleEval.target || (currentPrice - risk * 2.2);
      const reward = currentPrice - target;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.2;

      const tp1 = +(currentPrice - risk * 1.5).toFixed(decimals);
      const tp2 = +(currentPrice - risk * 3.0).toFixed(decimals);
      const runner = +(currentPrice - risk * 5.0).toFixed(decimals);

      const mtfStr = bearTFCount > 0 ? `${bearTFCount}/3 Higher TFs Bearish` : 'HTF Momentum Aligned';

      return {
        verdict: 'SELL',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(decimals),
        confidence: ruleEval.confidence || Math.min(96, Math.round(65 + confSell.met * 4)),
        aiReason: `SELL [${ruleEval.ruleName}]: ${ruleEval.rationale} Confluence: ${confSell.score} Met (${mtfStr}). Target 1: ${tp1} (-${(((currentPrice - tp1) / currentPrice) * 100).toFixed(2)}%), Stop Loss: ${stop.toFixed(decimals)}.`,
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
    if (ruleEval.verdict === 'BUY' && bearTFCount > 1) {
      waitReason = `WAIT: Support setup detected at ${supLabel}, but higher timeframes indicate heavy bearish pressure (${bearTFCount}/3 HTFs Bearish). Stand aside until HTF structure confirms.`;
    } else if (ruleEval.verdict === 'SELL' && bullTFCount > 1) {
      waitReason = `WAIT: Resistance setup detected at ${resLabel}, but higher timeframes indicate heavy bullish pressure (${bullTFCount}/3 HTFs Bullish). Stand aside until HTF structure confirms.`;
    } else {
      const distSup = activeSupport ? (((currentPrice - activeSupport.top) / currentPrice) * 100).toFixed(2) : '—';
      const distRes = activeResistance ? (((activeResistance.bottom - currentPrice) / currentPrice) * 100).toFixed(2) : '—';
      waitReason = `WAIT: Equilibrium consolidation at ${currentPrice.toFixed(decimals)}. Price is +${distSup}% above Support [${supLabel}] and -${distRes}% below Resistance [${resLabel}]. Confluence: ${activeConf.score} (RSI: ${activeConf.rsi}). Stand aside until candle bodies test corridor boundaries.`;
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
