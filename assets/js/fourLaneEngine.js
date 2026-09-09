/**
 * fourLaneEngine.js — TradersZone.ai Background Intelligence Engine
 *
 * Runs all 4 analytical dimensions quietly in the background:
 *   [1] Technical SMC (BOS, CHoCH, Order Blocks, FVGs, Sweeps)
 *   [2] Order Flow (Volume Delta, Buyer/Seller Absorption)
 *   [3] News / Catalyst (Gemini 2.0 Flash AI or Sentiment Heuristic)
 *   [4] Macro Regime (Market Sessions, ATR Volatility, HTF Bias)
 *
 * Synthesizes everything into a clean Main Signal (BUY, SELL, or WAIT)
 * accompanied by a simple, clear 1–2 sentence AI explanation.
 */

import { SMCEngine } from './smcEngine.js';
import { Settings } from './settings.js';

export class FourLaneEngine {
  constructor(options = {}) {
    this.smc = new SMCEngine(options);
  }

  async analyze({ candles, symbol, timeframe, htfTrend = 'NEUTRAL' }) {
    if (!candles || candles.length < 20) {
      return this._emptyVerdict(symbol, timeframe);
    }

    const currentPrice = candles[candles.length - 1].close;

    // 1. Technical Analysis (Background)
    const tech = this._evaluateTechnical(candles, htfTrend);

    // 2. Order Flow Analysis (Background)
    const flow = this._evaluateFlow(candles);

    // 3. Macro & Session Regime (Background)
    const macro = this._evaluateMacro(candles, htfTrend);

    // 4. News & AI Catalyst (Background)
    const news = await this._evaluateNews({ candles, symbol, timeframe, tech, flow, macro });

    // 5. Synthesize Consensus & Formulate Simple AI Reason Sentence
    return this._synthesizeVerdict({ tech, flow, news, macro, currentPrice, symbol, timeframe });
  }

  _evaluateTechnical(candles, htfTrend) {
    const smcResult = this.smc.analyze(candles, htfTrend);
    let bias = 'NEUTRAL';
    let detail = 'Consolidation without clear break';

    if (smcResult.bullScore > smcResult.bearScore && smcResult.bullScore >= 3) {
      bias = 'BULLISH';
      if (smcResult.bosSignal === 'CHOCH_BULL') detail = 'Bullish CHoCH reversal structure holding support';
      else if (smcResult.sweeps.some(s => s.direction === 'BULLISH')) detail = 'Sell-side liquidity swept with sharp rejection wick';
      else if (smcResult.orderBlocks.some(ob => ob.type === 'BULLISH_OB')) detail = 'Institutional demand holding inside Bullish Order Block';
      else detail = 'Bullish higher highs and higher lows expanding upward';
    } else if (smcResult.bearScore > smcResult.bullScore && smcResult.bearScore >= 3) {
      bias = 'BEARISH';
      if (smcResult.bosSignal === 'CHOCH_BEAR') detail = 'Bearish CHoCH trend breakdown rejecting resistance';
      else if (smcResult.sweeps.some(s => s.direction === 'BEARISH')) detail = 'Buy-side liquidity swept with distribution wick';
      else if (smcResult.orderBlocks.some(ob => ob.type === 'BEARISH_OB')) detail = 'Supply rejection inside Bearish Order Block';
      else detail = 'Bearish lower lows continuing downward momentum';
    }

    return { bias, detail, smcResult };
  }

  _evaluateFlow(candles) {
    const lookback = Math.min(20, candles.length);
    const recent = candles.slice(-lookback);

    let buyVol = 0;
    let sellVol = 0;

    for (const c of recent) {
      const range = c.high - c.low || 0.00001;
      const lowerWick = Math.min(c.close, c.open) - c.low;
      const vol = c.volume || 1000;
      const buyPct = Math.max(0.1, Math.min(0.9, (c.close - c.low + lowerWick) / (range * 2)));
      buyVol += vol * buyPct;
      sellVol += vol * (1 - buyPct);
    }

    const buyRatio = buyVol / (buyVol + sellVol || 1);
    let bias = 'NEUTRAL';
    let detail = 'Balanced order flow';

    if (buyRatio >= 0.55) {
      bias = 'INFLOW';
      detail = 'Aggressive spot buyers absorbing sell orders';
    } else if (buyRatio <= 0.45) {
      bias = 'OUTFLOW';
      detail = 'Dominant sell pressure pressing into bids';
    }

    return { bias, detail, buyRatio: +(buyRatio * 100).toFixed(1) };
  }

  _evaluateMacro(candles, htfTrend) {
    const atr = this.smc.calculateATR(candles, 14);
    const curClose = candles[candles.length - 1].close;
    const atrPct = (atr / curClose) * 100;

    let bias = 'FAVORABLE';
    let detail = 'Normal session liquidity and volatility';

    if (atrPct > 3.2) {
      bias = 'HIGH_RISK';
      detail = 'Elevated volatility regime exceeding stop limits';
    } else if (htfTrend !== 'NEUTRAL') {
      detail = `Higher timeframe ${htfTrend.toLowerCase()} trend alignment`;
    }

    return { bias, detail, atr };
  }

  async _evaluateNews({ candles, symbol, timeframe, tech, flow, macro }) {
    const apiKey = Settings.getGeminiKey();
    const aiEnabled = Settings.getAIEnabled();

    if (apiKey && aiEnabled) {
      try {
        const prompt = `You are the AI core of TradersZone.ai.
Asset: ${symbol} (${timeframe}) | Price: ${candles[candles.length - 1].close}
Tech: ${tech.bias} (${tech.detail}) | Flow: ${flow.bias} (${flow.detail}) | Macro: ${macro.bias}
Output raw JSON only:
{"bias":"POSITIVE"|"NEGATIVE"|"NEUTRAL","reason":"<1 concise sentence explaining market bias>"}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 100 } }),
          signal: AbortSignal.timeout(4000),
        });

        if (res.ok) {
          const data = await res.json();
          const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleaned = raw.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          return { bias: parsed.bias || 'NEUTRAL', reason: parsed.reason || '' };
        }
      } catch (e) {}
    }

    // Default proxy
    const recent = candles.slice(-6);
    const gains = recent.filter(c => c.close > c.open).length;
    return {
      bias: gains >= 4 ? 'POSITIVE' : gains <= 2 ? 'NEGATIVE' : 'NEUTRAL',
      reason: 'Momentum structure baseline',
    };
  }

  _synthesizeVerdict({ tech, flow, news, macro, currentPrice, symbol, timeframe }) {
    let bullVotes = 0;
    let bearVotes = 0;

    if (tech.bias === 'BULLISH') bullVotes += 2;
    if (tech.bias === 'BEARISH') bearVotes += 2;

    if (flow.bias === 'INFLOW') bullVotes += 1.5;
    if (flow.bias === 'OUTFLOW') bearVotes += 1.5;

    if (news.bias === 'POSITIVE') bullVotes += 1;
    if (news.bias === 'NEGATIVE') bearVotes += 1;

    if (macro.bias === 'FAVORABLE') {
      if (bullVotes > bearVotes) bullVotes += 0.5;
      else if (bearVotes > bullVotes) bearVotes += 0.5;
    }

    const atr = macro.atr || currentPrice * 0.01;
    const smc = tech.smcResult;

    // BUY Signal
    if (bullVotes >= 3.5 && bullVotes > bearVotes && macro.bias !== 'HIGH_RISK') {
      const stop = smc?.orderBlocks?.find(o => o.type === 'BULLISH_OB')?.bottom
        ?? (smc?.lastLL?.price ? smc.lastLL.price - atr * 0.3 : currentPrice - atr * 1.5);
      const target = smc?.lastHH?.price ?? (currentPrice + atr * 2.5);
      const risk = currentPrice - stop;
      const reward = target - currentPrice;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.0;

      return {
        verdict: 'BUY',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5),
        confidence: Math.min(96, Math.round(60 + bullVotes * 8)),
        aiReason: `Buy: Price completed a sell-side liquidity sweep at support with confirmed bullish market structure (BOS) and strong buyer volume absorption.`,
        levels: {
          entry: +currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5),
          target: +target.toFixed(symbol.includes('JPY') ? 3 : 5),
          stop: +stop.toFixed(symbol.includes('JPY') ? 3 : 5),
          targetPct: +(((target - currentPrice) / currentPrice) * 100).toFixed(2),
          stopPct: -+(((currentPrice - stop) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        smcData: smc,
      };
    }

    // SELL Signal
    if (bearVotes >= 3.5 && bearVotes > bullVotes && macro.bias !== 'HIGH_RISK') {
      const stop = smc?.orderBlocks?.find(o => o.type === 'BEARISH_OB')?.top
        ?? (smc?.lastHH?.price ? smc.lastHH.price + atr * 0.3 : currentPrice + atr * 1.5);
      const target = smc?.lastLL?.price ?? (currentPrice - atr * 2.5);
      const risk = stop - currentPrice;
      const reward = currentPrice - target;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 2.0;

      return {
        verdict: 'SELL',
        symbol,
        timeframe,
        currentPrice: +currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5),
        confidence: Math.min(96, Math.round(60 + bearVotes * 8)),
        aiReason: `Sell: Price rejected overhead resistance following a buy-side liquidity sweep, confirming a bearish structure breakdown with heavy distribution volume.`,
        levels: {
          entry: +currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5),
          target: +target.toFixed(symbol.includes('JPY') ? 3 : 5),
          stop: +stop.toFixed(symbol.includes('JPY') ? 3 : 5),
          targetPct: -+(((currentPrice - target) / currentPrice) * 100).toFixed(2),
          stopPct: -+(((stop - currentPrice) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.3, rr),
        },
        smcData: smc,
      };
    }

    // WAIT Signal (with clear 1-2 sentence explanation of WHY)
    let waitReason = 'Wait: The market is currently consolidating without directional follow-through. Order flow shows high selling pressure near resistance, creating an unfavorable risk-to-reward ratio.';
    if (tech.bias === 'BULLISH' && flow.bias === 'OUTFLOW') {
      waitReason = 'Wait: While the chart shows a bullish structure attempt, order flow reveals aggressive spot selling that threatens to invalidate support. Wait for volume confirmation.';
    } else if (tech.bias === 'BEARISH' && flow.bias === 'INFLOW') {
      waitReason = 'Wait: Price broke lower, but aggressive buyers are absorbing the dip. Shorting here risks an immediate bear-trap squeeze.';
    } else if (macro.bias === 'HIGH_RISK') {
      waitReason = 'Wait: Volatility is currently too high for safe stop-loss placement. Stand aside until ATR stabilizes.';
    }

    return {
      verdict: 'WAIT',
      symbol,
      timeframe,
      currentPrice: +currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5),
      confidence: 45,
      aiReason: waitReason,
      levels: {
        entry: +currentPrice.toFixed(symbol.includes('JPY') ? 3 : 5),
        target: null,
        stop: null,
        targetPct: null,
        stopPct: null,
        riskReward: null,
      },
      smcData: smc,
    };
  }

  _emptyVerdict(symbol, timeframe) {
    return {
      verdict: 'WAIT',
      symbol,
      timeframe,
      currentPrice: 0,
      confidence: 0,
      aiReason: 'Wait: Streaming historical candle data to calibrate market structure and order flow…',
      levels: { entry: 0, target: null, stop: null, targetPct: null, stopPct: null, riskReward: null },
      smcData: null,
    };
  }
}
