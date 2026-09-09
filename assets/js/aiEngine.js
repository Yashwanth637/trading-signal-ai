/**
 * aiEngine.js — Google Gemini AI integration
 * Sends SMC analysis context to Gemini for signal confirmation and reasoning.
 * Falls back gracefully if no API key is set.
 */

import { Settings } from './settings.js';

const GEMINI_MODEL    = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Maximum last N candles to include in prompt (keeps tokens low) */
const CANDLE_CONTEXT = 30;

export const AIEngine = {
  _lastCallTime: 0,
  _minInterval:  4000, // 4 seconds between calls (well under 15 req/min)

  /**
   * Ask Gemini to confirm or deny an SMC signal.
   * @param {Object} params
   * @param {string} params.symbol
   * @param {string} params.timeframe
   * @param {string} params.market       'CRYPTO' | 'FOREX'
   * @param {Object} params.smcResult    Full result from SMCEngine.analyze()
   * @param {Array}  params.candles      Recent OHLCV candles
   * @returns {Promise<AIResult>}
   */
  async analyzeSignal({ symbol, timeframe, market, smcResult, candles }) {
    const apiKey = Settings.getGeminiKey();
    if (!apiKey || !Settings.getAIEnabled()) {
      return this._noKeyResult(smcResult);
    }

    // Rate-limit guard
    const now = Date.now();
    if (now - this._lastCallTime < this._minInterval) {
      return this._rateResult(smcResult);
    }
    this._lastCallTime = now;

    const prompt = this._buildPrompt({ symbol, timeframe, market, smcResult, candles });

    try {
      const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature:     0.3,   // Low temp = more consistent/reliable
            maxOutputTokens: 512,
            topP:            0.8,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return this._parseResponse(text, smcResult);

    } catch (err) {
      console.error('[AIEngine] Gemini error:', err.message);
      return this._errorResult(smcResult, err.message);
    }
  },

  // ─── Prompt Builder ──────────────────────────────────────────────
  _buildPrompt({ symbol, timeframe, market, smcResult, candles }) {
    const {
      signal, confidence, trend, bosSignal, reasons,
      orderBlocks, fvgs, sweeps, srZones, atr, entryPrice,
      stopLoss, takeProfit, riskReward,
    } = smcResult;

    const recentCandles = candles.slice(-CANDLE_CONTEXT).map(c => ({
      t: c.time, o: +c.open.toFixed(5), h: +c.high.toFixed(5),
      l: +c.low.toFixed(5), c: +c.close.toFixed(5),
    }));

    const obSummary = orderBlocks.slice(0, 3).map(ob =>
      `${ob.type}: [${ob.bottom.toFixed(5)} – ${ob.top.toFixed(5)}]`
    ).join(', ') || 'none';

    const fvgSummary = fvgs.slice(0, 3).map(f =>
      `${f.type}: [${f.bottom.toFixed(5)} – ${f.top.toFixed(5)}]`
    ).join(', ') || 'none';

    const sweepSummary = sweeps.map(s =>
      `${s.type} @ ${s.price.toFixed(5)} (${s.direction})`
    ).join(', ') || 'none';

    return `You are an expert Smart Money Concepts (SMC) trader. Analyze the following trading setup and respond with a structured JSON object ONLY — no markdown, no extra text.

MARKET: ${market} — ${symbol} | Timeframe: ${timeframe}
CURRENT PRICE: ${entryPrice?.toFixed(5)}
TREND (LTF): ${trend}
BOS/CHoCH: ${bosSignal || 'none'}
ATR(14): ${atr?.toFixed(5)}

SMC FEATURES DETECTED:
- Reasons: ${reasons.join('; ') || 'none'}
- Order Blocks: ${obSummary}
- Fair Value Gaps: ${fvgSummary}
- Liquidity Sweeps: ${sweepSummary}

LOGIC ENGINE SIGNAL: ${signal} (confidence: ${confidence}%)
Proposed Entry: ${entryPrice?.toFixed(5)}
Proposed SL: ${stopLoss?.toFixed(5) || 'n/a'}
Proposed TP: ${takeProfit?.toFixed(5) || 'n/a'}
Risk:Reward: ${riskReward || 'n/a'}

RECENT OHLCV (last ${recentCandles.length} candles):
${JSON.stringify(recentCandles)}

Respond ONLY with this JSON (no markdown):
{
  "confirmation": "BUY" | "SELL" | "NEUTRAL",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentence analysis>",
  "warnings": "<any red flags or risks, or empty string>",
  "adjustedSL": <price or null>,
  "adjustedTP": <price or null>
}`;
  },

  // ─── Response Parser ────────────────────────────────────────────
  _parseResponse(text, smcResult) {
    try {
      // Strip any accidental markdown code fences
      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed  = JSON.parse(cleaned);

      const aiConf    = Math.max(0, Math.min(100, parseInt(parsed.confidence) || 0));
      const logicConf = smcResult.confidence;

      // Weighted blend: 60% logic, 40% AI
      const finalConfidence = Math.round(logicConf * 0.6 + aiConf * 0.4);

      // AI can veto: if AI says NEUTRAL or opposite, reduce confidence
      let finalSignal = smcResult.signal;
      if (parsed.confirmation !== smcResult.signal && parsed.confirmation !== 'NEUTRAL') {
        finalSignal = 'NEUTRAL'; // conflicting — stand aside
      }

      return {
        source:          'AI_CONFIRMED',
        aiSignal:        parsed.confirmation,
        logicSignal:     smcResult.signal,
        finalSignal,
        finalConfidence,
        reasoning:       parsed.reasoning  || '',
        warnings:        parsed.warnings   || '',
        adjustedSL:      parsed.adjustedSL || smcResult.stopLoss,
        adjustedTP:      parsed.adjustedTP || smcResult.takeProfit,
        riskReward:      smcResult.riskReward,
      };
    } catch {
      return this._errorResult(smcResult, 'Failed to parse AI response');
    }
  },

  // ─── Fallback Results ───────────────────────────────────────────
  _noKeyResult(smcResult) {
    return {
      source:          'LOGIC_ONLY',
      aiSignal:        null,
      logicSignal:     smcResult.signal,
      finalSignal:     smcResult.signal,
      finalConfidence: smcResult.confidence,
      reasoning:       'AI engine disabled — add your Gemini API key in Settings to enable.',
      warnings:        '',
      adjustedSL:      smcResult.stopLoss,
      adjustedTP:      smcResult.takeProfit,
      riskReward:      smcResult.riskReward,
    };
  },

  _rateResult(smcResult) {
    return {
      source:          'LOGIC_ONLY',
      aiSignal:        null,
      logicSignal:     smcResult.signal,
      finalSignal:     smcResult.signal,
      finalConfidence: smcResult.confidence,
      reasoning:       'AI rate limit — using logic engine score.',
      warnings:        '',
      adjustedSL:      smcResult.stopLoss,
      adjustedTP:      smcResult.takeProfit,
      riskReward:      smcResult.riskReward,
    };
  },

  _errorResult(smcResult, message) {
    return {
      source:          'LOGIC_ONLY',
      aiSignal:        null,
      logicSignal:     smcResult.signal,
      finalSignal:     smcResult.signal,
      finalConfidence: smcResult.confidence,
      reasoning:       `AI error: ${message}`,
      warnings:        'Operating on logic engine only.',
      adjustedSL:      smcResult.stopLoss,
      adjustedTP:      smcResult.takeProfit,
      riskReward:      smcResult.riskReward,
    };
  },
};

/**
 * @typedef {{ source: string, aiSignal: string|null, logicSignal: string, finalSignal: string,
 *   finalConfidence: number, reasoning: string, warnings: string,
 *   adjustedSL: number|null, adjustedTP: number|null, riskReward: number|null }} AIResult
 */
