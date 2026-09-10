/**
 * aiEngine.js — Google Gemini AI Integration for TradersZone.ai
 *
 * Synthesizes institutional SMC analysis into crisp, professional trade reasoning.
 * Falls back cleanly to mathematical heuristic analysis if no key is configured.
 */

import { Settings } from './settings.js';

const GEMINI_MODEL    = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export const AIEngine = {
  _lastCallTime: 0,
  _minInterval:  4000, // 4 seconds between Gemini calls to stay safely in free tier

  /**
   * Enhance a verdict with real-time Gemini AI synthesis if key is present
   * @param {Object} params
   * @param {Object} params.verdictData - Result from FourLaneEngine.analyze()
   * @param {Array}  params.candles     - Recent OHLCV candles
   * @returns {Promise<Object>}
   */
  async enhanceVerdict({ verdictData, candles }) {
    if (!verdictData) return verdictData;

    const apiKey = Settings.getGeminiKey();
    if (!apiKey || !Settings.getAIEnabled()) {
      return verdictData;
    }

    // Rate-limit guard
    const now = Date.now();
    if (now - this._lastCallTime < this._minInterval) {
      return verdictData;
    }
    this._lastCallTime = now;

    const prompt = this._buildEnhancedPrompt({ verdictData, candles });

    try {
      const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature:     0.25,
            maxOutputTokens: 256,
            topP:            0.8,
          },
        }),
      });

      if (!response.ok) return verdictData;

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      if (text) {
        return {
          ...verdictData,
          aiReason: `🤖 AI Synthesis: ${text}`,
        };
      }
    } catch (err) {
      console.warn('[AIEngine] Gemini synthesis skipped:', err.message);
    }

    return verdictData;
  },

  _buildEnhancedPrompt({ verdictData, candles }) {
    const { verdict, symbol, timeframe, currentPrice, confidence, confluence, mtfMatrix, levels } = verdictData;
    const cfList = confluence?.checklist?.map(c => `${c.name}: ${c.status} (${c.detail})`).join('; ') || 'n/a';
    const mtfStr = Object.entries(mtfMatrix || {}).map(([k, v]) => `${k}:${v}`).join(', ') || 'n/a';

    return `You are an elite quantitative market analyst at an institutional proprietary trading firm.
Asset: ${symbol} | Timeframe: ${timeframe}
Current Price: ${currentPrice}
Signal Verdict: ${verdict} (Model Confidence: ${confidence}%)
Confluence Score: ${confluence?.score || '0/8'} Met (${confluence?.conviction || 'Moderate'} Conviction)
Criteria: ${cfList}
Multi-Timeframe Matrix: ${mtfStr}
Key Levels: Entry=${levels?.entry}, TP1=${levels?.target}, SL=${levels?.stop}

Write exactly 2 concise, highly precise, professional sentences explaining the institutional market structure rationale behind this ${verdict} decision. Mention key price corridors and volume order flow directly. Do not use bullet points or markdown headers. Return plain text only.`;
  },
};
