/**
 * fourLaneEngine.js — Deeepr.ai-Inspired 4-Lane Real-Time Intelligence Engine
 *
 * Runs 4 independent analytical lanes:
 *   [T] Technical: Smart Money Concepts (BOS, CHoCH, OB, FVG, Liquidity Sweeps)
 *   [F] Flow: Real-time volume delta, buy/sell pressure, absorption
 *   [N] News / AI: Real-time catalyst & sentiment (Gemini AI or sentiment heuristic)
 *   [M] Macro & Regime: HTF alignment, market session killzones, ATR volatility
 *
 * Consensus Algorithm:
 *   ≥3/4 Lanes Bullish -> LONG (with exact Entry, TP, SL, R:R)
 *   ≥3/4 Lanes Bearish -> SHORT (with exact Entry, TP, SL, R:R)
 *   Conflicting Lanes  -> WAIT (with explicit explanation of why lanes disagree)
 */

import { SMCEngine } from './smcEngine.js';
import { Settings } from './settings.js';

export class FourLaneEngine {
  constructor(options = {}) {
    this.smc = new SMCEngine(options);
    this.geminiApiKey = Settings.getGeminiKey();
  }

  /**
   * Run full 4-lane analysis on candle array
   * @param {Object} params
   * @param {Array} params.candles
   * @param {string} params.symbol
   * @param {string} params.timeframe
   * @param {string} [params.htfTrend='NEUTRAL']
   * @returns {FourLaneVerdict}
   */
  async analyze({ candles, symbol, timeframe, htfTrend = 'NEUTRAL' }) {
    if (!candles || candles.length < 25) {
      return this._emptyVerdict(symbol, timeframe);
    }

    const currentPrice = candles[candles.length - 1].close;

    // 1. Lane Technical [T]
    const technicalLane = this._evaluateTechnicalLane(candles, htfTrend);

    // 2. Lane Flow [F]
    const flowLane = this._evaluateFlowLane(candles);

    // 3. Lane Macro & Regime [M]
    const macroLane = this._evaluateMacroLane(candles, htfTrend);

    // 4. Lane News / AI Catalyst [N]
    const newsLane = await this._evaluateNewsLane({
      candles,
      symbol,
      timeframe,
      technicalLane,
      flowLane,
      macroLane,
    });

    // 5. Reconcile all 4 lanes
    const reconciliation = this._reconcileLanes({
      technical: technicalLane,
      flow: flowLane,
      news: newsLane,
      macro: macroLane,
      currentPrice,
      candles,
    });

    return {
      symbol,
      timeframe,
      currentPrice,
      timestamp: Date.now(),
      verdict: reconciliation.verdict, // 'LONG' | 'SHORT' | 'WAIT'
      agreementCount: reconciliation.agreementCount, // 0 to 4
      lanesAgreeText: `${reconciliation.agreementCount} of 4 lanes agree`,
      reasons: reconciliation.reasons,
      waitReason: reconciliation.waitReason,
      confidence: reconciliation.confidence,
      levels: reconciliation.levels, // { entry, target, stop, targetPct, stopPct, riskReward }
      lanes: {
        technical: technicalLane,
        flow: flowLane,
        news: newsLane,
        macro: macroLane,
      },
      smcData: technicalLane.smcResult,
    };
  }

  // ─── LANE 1: TECHNICAL (SMC & PRICE ACTION) ──────────────────────
  _evaluateTechnicalLane(candles, htfTrend) {
    const smcResult = this.smc.analyze(candles, htfTrend);
    let bias = 'NEUTRAL';
    let summary = 'Consolidation — no clear structure break';

    if (smcResult.bullScore > smcResult.bearScore && smcResult.bullScore >= 3) {
      bias = 'BULLISH';
      if (smcResult.bosSignal === 'CHOCH_BULL') {
        summary = 'Bullish CHoCH: Structure reversal holding above support';
      } else if (smcResult.bosSignal === 'BOS_BULL') {
        summary = 'Bullish BOS: Higher highs forming into expansion zone';
      } else if (smcResult.sweeps.some(s => s.direction === 'BULLISH')) {
        summary = 'Sell-side liquidity swept; rejection wick confirmed';
      } else if (smcResult.orderBlocks.some(ob => ob.type === 'BULLISH_OB')) {
        summary = 'Demand reaction inside institutional Bullish Order Block';
      } else {
        summary = 'Bullish market structure holding key higher lows';
      }
    } else if (smcResult.bearScore > smcResult.bullScore && smcResult.bearScore >= 3) {
      bias = 'BEARISH';
      if (smcResult.bosSignal === 'CHOCH_BEAR') {
        summary = 'Bearish CHoCH: Trend flip rejecting supply overhead';
      } else if (smcResult.bosSignal === 'BOS_BEAR') {
        summary = 'Bearish BOS: Lower lows continuing trend breakdown';
      } else if (smcResult.sweeps.some(s => s.direction === 'BEARISH')) {
        summary = 'Buy-side liquidity swept; distribution wick rejecting';
      } else if (smcResult.orderBlocks.some(ob => ob.type === 'BEARISH_OB')) {
        summary = 'Supply absorption inside institutional Bearish Order Block';
      } else {
        summary = 'Bearish market structure creating consistent lower highs';
      }
    }

    return {
      lane: 'Technical',
      tag: 'TECH',
      bias, // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
      summary,
      score: Math.max(smcResult.bullScore, smcResult.bearScore),
      smcResult,
    };
  }

  // ─── LANE 2: FLOW (VOLUME DELTA & ORDER FLOW) ────────────────────
  _evaluateFlowLane(candles) {
    const lookback = Math.min(20, candles.length);
    const recent = candles.slice(-lookback);

    let buyVolume = 0;
    let sellVolume = 0;
    let deltaAccum = 0;

    for (const c of recent) {
      const range = c.high - c.low || 0.00001;
      const body = c.close - c.open;
      const upperWick = c.high - Math.max(c.close, c.open);
      const lowerWick = Math.min(c.close, c.open) - c.low;
      const vol = c.volume || 1000;

      // Estimate buy/sell volume using candle mechanics (CVD proxy)
      const buyFraction = Math.max(0.05, Math.min(0.95, (c.close - c.low + lowerWick) / (range * 2)));
      const sellFraction = 1 - buyFraction;

      const candleBuyVol = vol * buyFraction;
      const candleSellVol = vol * sellFraction;

      buyVolume += candleBuyVol;
      sellVolume += candleSellVol;
      deltaAccum += (candleBuyVol - candleSellVol);
    }

    const totalVol = buyVolume + sellVolume || 1;
    const buyRatio = buyVolume / totalVol;
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    let bias = 'NEUTRAL';
    let summary = 'Balanced order flow — volume delta neutral';

    if (buyRatio >= 0.56 || deltaAccum > totalVol * 0.15) {
      bias = 'INFLOW';
      if (lastCandle.close > lastCandle.open && lastCandle.volume > (prevCandle?.volume || 0)) {
        summary = 'Aggressive spot buyers absorbing resting limit sells';
      } else {
        summary = 'Net positive volume delta; buyers accumulating on dips';
      }
    } else if (buyRatio <= 0.44 || deltaAccum < -totalVol * 0.15) {
      bias = 'OUTFLOW';
      if (lastCandle.close < lastCandle.open && lastCandle.volume > (prevCandle?.volume || 0)) {
        summary = 'Spot sellers pressing into bids; distribution flow dominant';
      } else {
        summary = 'Net negative volume delta; liquidity drained below market';
      }
    } else {
      summary = 'Equilibrium order flow; no aggressive taker dominance';
    }

    return {
      lane: 'Flow',
      tag: 'FLOW',
      bias, // 'INFLOW' | 'OUTFLOW' | 'NEUTRAL'
      summary,
      buyRatio: +(buyRatio * 100).toFixed(1),
      delta: +deltaAccum.toFixed(0),
    };
  }

  // ─── LANE 3: NEWS & CATALYST (GEMINI AI / SENTIMENT) ─────────────
  async _evaluateNewsLane({ candles, symbol, timeframe, technicalLane, flowLane, macroLane }) {
    const apiKey = Settings.getGeminiKey();
    const aiEnabled = Settings.getAIEnabled();

    // If Gemini key is provided, execute rapid catalyst appraisal
    if (apiKey && aiEnabled) {
      try {
        const prompt = `You are the News/Macro Lane of an institutional trading terminal.
Asset: ${symbol} (${timeframe})
Current Price: ${candles[candles.length - 1].close}
Technical SMC status: ${technicalLane.bias} (${technicalLane.summary})
Flow status: ${flowLane.bias} (${flowLane.summary})
Macro status: ${macroLane.bias} (${macroLane.summary})

Provide a concise 1-sentence catalyst/sentiment appraisal for ${symbol}.
Respond ONLY with raw JSON format (no markdown):
{
  "bias": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
  "summary": "<1 brief sentence on market catalyst or narrative sentiment>"
}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 120 }
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const data = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleaned = rawText.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);

          return {
            lane: 'News',
            tag: 'NEWS',
            bias: parsed.bias || 'NEUTRAL',
            summary: parsed.summary || 'Narrative neutral with steady sentiment baseline',
            source: 'Gemini AI Live',
          };
        }
      } catch (e) {
        // Fallback gracefully if AI times out or rate limits
      }
    }

    // Algorithmic Proxy if no API key or call failed
    const recent = candles.slice(-10);
    const gains = recent.filter(c => c.close > c.open).length;
    let bias = 'NEUTRAL';
    let summary = 'No dominant macro catalyst; neutral narrative tone';

    if (gains >= 7) {
      bias = 'POSITIVE';
      summary = 'Sustained positive risk sentiment and momentum interest';
    } else if (gains <= 3) {
      bias = 'NEGATIVE';
      summary = 'Risk-off narrative prevailing with subdued market sentiment';
    }

    return {
      lane: 'News',
      tag: 'NEWS',
      bias,
      summary,
      source: 'Algorithmic Sentiment Engine',
    };
  }

  // ─── LANE 4: MACRO & REGIME ──────────────────────────────────────
  _evaluateMacroLane(candles, htfTrend) {
    const now = new Date();
    const utcHour = now.getUTCHours();

    // Session determination (UTC)
    let session = 'Asian Session';
    let sessionImpact = 'Standard';
    if (utcHour >= 7 && utcHour < 13) {
      session = 'London Morning';
      sessionImpact = 'High Liquidity';
    } else if (utcHour >= 13 && utcHour < 16) {
      session = 'London/NY Overlap Killzone';
      sessionImpact = 'Peak Institutional Volume';
    } else if (utcHour >= 16 && utcHour < 21) {
      session = 'New York Afternoon';
      sessionImpact = 'High Liquidity';
    }

    // Volatility regime using ATR / Candle average range
    const atr = this.smc.calculateATR(candles, 14);
    const curClose = candles[candles.length - 1].close;
    const atrPct = (atr / curClose) * 100;

    let bias = 'MIXED';
    let summary = `${session} — Volatility baseline normal (${atrPct.toFixed(2)}%)`;

    if (htfTrend === 'BULLISH') {
      bias = 'FAVORABLE';
      summary = `Higher timeframe macro trend is bullish; ${session} liquidity active`;
    } else if (htfTrend === 'BEARISH') {
      bias = 'FAVORABLE'; // Favorable for shorts
      summary = `Higher timeframe macro trend is bearish; ${session} liquidity active`;
    } else {
      if (atrPct > 3.0) {
        bias = 'HIGH_RISK';
        summary = `Elevated volatility regime (${atrPct.toFixed(2)}% ATR); wide stop risks`;
      } else {
        bias = 'MIXED';
        summary = `Ranging macro backdrop in ${session}; waiting on directional catalyst`;
      }
    }

    return {
      lane: 'Macro',
      tag: 'MACRO',
      bias, // 'FAVORABLE' | 'MIXED' | 'HIGH_RISK'
      summary,
      session,
      sessionImpact,
      atr,
      atrPct,
    };
  }

  // ─── 4-LANE RECONCILIATION & CONSENSUS ────────────────────────────
  _reconcileLanes({ technical, flow, news, macro, currentPrice, candles }) {
    let bullVotes = 0;
    let bearVotes = 0;
    const reasons = [];

    // Technical vote
    if (technical.bias === 'BULLISH') {
      bullVotes++;
      reasons.push(technical.summary);
    } else if (technical.bias === 'BEARISH') {
      bearVotes++;
      reasons.push(technical.summary);
    }

    // Flow vote
    if (flow.bias === 'INFLOW') {
      bullVotes++;
      reasons.push(flow.summary);
    } else if (flow.bias === 'OUTFLOW') {
      bearVotes++;
      reasons.push(flow.summary);
    }

    // News vote
    if (news.bias === 'POSITIVE') {
      bullVotes++;
      reasons.push(news.summary);
    } else if (news.bias === 'NEGATIVE') {
      bearVotes++;
      reasons.push(news.summary);
    }

    // Macro vote
    if (macro.bias === 'FAVORABLE') {
      if (technical.bias === 'BULLISH') bullVotes++;
      if (technical.bias === 'BEARISH') bearVotes++;
      reasons.push(macro.summary);
    }

    const atr = macro.atr || (currentPrice * 0.008);
    const smcRes = technical.smcResult;

    // Consensus decisions:
    // Need at least 3 agreeing lanes to fire a trade call
    if (bullVotes >= 3 && bullVotes > bearVotes && macro.bias !== 'HIGH_RISK') {
      const stop = smcRes?.orderBlocks?.find(ob => ob.type === 'BULLISH_OB')?.bottom
        ?? (smcRes?.lastLL?.price ? smcRes.lastLL.price - atr * 0.3 : currentPrice - atr * 1.5);
      const target = smcRes?.lastHH?.price
        ?? (currentPrice + atr * 2.5);

      const risk = currentPrice - stop;
      const reward = target - currentPrice;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 1.8;

      return {
        verdict: 'LONG',
        agreementCount: bullVotes,
        confidence: Math.min(95, Math.round(50 + (bullVotes / 4) * 45)),
        reasons,
        waitReason: null,
        levels: {
          entry: +currentPrice.toFixed(5),
          target: +target.toFixed(5),
          stop: +stop.toFixed(5),
          targetPct: +(((target - currentPrice) / currentPrice) * 100).toFixed(2),
          stopPct: -+(((currentPrice - stop) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.2, rr),
        }
      };
    }

    if (bearVotes >= 3 && bearVotes > bullVotes && macro.bias !== 'HIGH_RISK') {
      const stop = smcRes?.orderBlocks?.find(ob => ob.type === 'BEARISH_OB')?.top
        ?? (smcRes?.lastHH?.price ? smcRes.lastHH.price + atr * 0.3 : currentPrice + atr * 1.5);
      const target = smcRes?.lastLL?.price
        ?? (currentPrice - atr * 2.5);

      const risk = stop - currentPrice;
      const reward = currentPrice - target;
      const rr = risk > 0 ? +(reward / risk).toFixed(2) : 1.8;

      return {
        verdict: 'SHORT',
        agreementCount: bearVotes,
        confidence: Math.min(95, Math.round(50 + (bearVotes / 4) * 45)),
        reasons,
        waitReason: null,
        levels: {
          entry: +currentPrice.toFixed(5),
          target: +target.toFixed(5),
          stop: +stop.toFixed(5),
          targetPct: -+(((currentPrice - target) / currentPrice) * 100).toFixed(2),
          stopPct: -+(((stop - currentPrice) / currentPrice) * 100).toFixed(2),
          riskReward: Math.max(1.2, rr),
        }
      };
    }

    // Disagreement / Insufficient Confluence -> WAIT
    let waitReason = 'Lanes are in conflict. Standing aside until clear 3-lane consensus.';
    if (technical.bias === 'BULLISH' && flow.bias === 'OUTFLOW') {
      waitReason = 'Technical shows higher price structure, but Order Flow shows heavy sell absorption.';
    } else if (technical.bias === 'BEARISH' && flow.bias === 'INFLOW') {
      waitReason = 'Technical signals lower lows, but spot buyers are aggressively bidding up dips.';
    } else if (macro.bias === 'HIGH_RISK') {
      waitReason = 'High volatility regime detected — risk limits exceeded for reliable stop placement.';
    } else if (bullVotes === 2 && bearVotes === 2) {
      waitReason = 'Even 2-to-2 split between directional lanes. No dominant market edge.';
    }

    return {
      verdict: 'WAIT',
      agreementCount: Math.max(bullVotes, bearVotes),
      confidence: 40,
      reasons,
      waitReason,
      levels: {
        entry: +currentPrice.toFixed(5),
        target: null,
        stop: null,
        targetPct: null,
        stopPct: null,
        riskReward: null,
      }
    };
  }

  _emptyVerdict(symbol, timeframe) {
    return {
      symbol,
      timeframe,
      currentPrice: 0,
      timestamp: Date.now(),
      verdict: 'WAIT',
      agreementCount: 0,
      lanesAgreeText: '0 of 4 lanes agree',
      reasons: ['Insufficient historical data for 4-lane analysis'],
      waitReason: 'Waiting for candle stream…',
      confidence: 0,
      levels: { entry: 0, target: null, stop: null, targetPct: null, stopPct: null, riskReward: null },
      lanes: {
        technical: { lane: 'Technical', tag: 'TECH', bias: 'NEUTRAL', summary: 'Awaiting data' },
        flow: { lane: 'Flow', tag: 'FLOW', bias: 'NEUTRAL', summary: 'Awaiting volume' },
        news: { lane: 'News', tag: 'NEWS', bias: 'NEUTRAL', summary: 'Awaiting narrative' },
        macro: { lane: 'Macro', tag: 'MACRO', bias: 'MIXED', summary: 'Awaiting session' },
      }
    };
  }
}
