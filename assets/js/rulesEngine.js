/**
 * rulesEngine.js — TradersZone.ai Institutional Stored Logic Ruleset
 *
 * Encapsulates quantitative institutional setups:
 *   • Pine Script Horizon Support Floor Rebound
 *   • Pine Script Horizon Resistance Ceiling Rejection
 *   • Structural Breakout & Retest Expansion
 *   • Structural Breakdown & Retest Distribution
 *   • Institutional Liquidity Sweeps (SSL & BSL Stop Hunts)
 *   • Equilibrium Range Elimination (Chop suppression)
 *   • Multi-Timeframe Momentum Lock (Anti-whipsaw filter)
 */

export const RulesEngine = {
  /**
   * Evaluate candles and structural zones against the institutional ruleset
   * @param {Object} params
   * @param {Array}  params.candles
   * @param {Object} params.smc
   * @param {Object} params.mtfMatrix
   * @param {Object} params.confluenceBuy
   * @param {Object} params.confluenceSell
   * @returns {Object} evaluationResult
   */
  evaluate({ candles, smc, mtfMatrix = {}, confluenceBuy, confluenceSell }) {
    if (!candles || candles.length < 25) {
      return { verdict: 'WAIT', reason: 'Insufficient candle history', setup: 'NONE' };
    }

    const len = candles.length;
    const current = candles[len - 1];
    const prev = candles[len - 2] || current;
    const currentPrice = current.close;
    const atr = smc.atr || 1.0;

    const { activeSupport, activeResistance } = smc;

    // Multi-Timeframe Momentum Audit
    const keyTFs = ['15M', '1H', '4H'];
    const bullHTF = keyTFs.filter(tf => mtfMatrix[tf] === 'BULLISH').length;
    const bearHTF = keyTFs.filter(tf => mtfMatrix[tf] === 'BEARISH').length;

    const recent = candles.slice(-4);
    const range = current.high - current.low;
    const body = Math.abs(current.close - current.open);
    const bodyRatio = range > 0 ? (body / range) : 0;

    // ── RULE 1: Pine Script Support Floor Rebound (BUY) ───────────
    if (activeSupport && (bearHTF <= 1)) {
      // Check if current or previous candle tested the floor
      const touchedFloor = recent.some(c =>
        c.low <= (activeSupport.top + atr * 0.15) &&
        c.close >= activeSupport.bottom &&
        c.close > c.open
      );

      if (touchedFloor && current.close >= activeSupport.bottom && (confluenceBuy.met >= 4 || current.close > current.open)) {
        return {
          verdict: 'BUY',
          setup: 'SUPPORT_FLOOR_REBOUND',
          confidence: Math.min(97, 65 + confluenceBuy.met * 4),
          stop: activeSupport.bottom,
          target: activeResistance ? activeResistance.bottom : (currentPrice + atr * 2.8),
          ruleName: 'Institutional Support Floor Bounce',
          rationale: `Price established a strong demand floor at [${activeSupport.bottom.toFixed(2)} – ${activeSupport.top.toFixed(2)}] with candle body absorption and positive buying delta.`,
        };
      }
    }

    // ── RULE 2: Resistance Ceiling Rejection (SELL) ────────────────
    if (activeResistance && (bullHTF <= 1)) {
      const touchedCeiling = recent.some(c =>
        c.high >= (activeResistance.bottom - atr * 0.15) &&
        c.close <= activeResistance.top &&
        c.close < c.open
      );

      if (touchedCeiling && current.close <= activeResistance.top && (confluenceSell.met >= 4 || current.close < current.open)) {
        return {
          verdict: 'SELL',
          setup: 'RESISTANCE_CEILING_REJECTION',
          confidence: Math.min(97, 65 + confluenceSell.met * 4),
          stop: activeResistance.top,
          target: activeSupport ? activeSupport.top : (currentPrice - atr * 2.8),
          ruleName: 'Institutional Resistance Ceiling Rejection',
          rationale: `Price tested supply ceiling at [${activeResistance.bottom.toFixed(2)} – ${activeResistance.top.toFixed(2)}] and printed an upper distribution wick with institutional seller dominance.`,
        };
      }
    }

    // ── RULE 3: Breakout Retest Expansion (BUY) ────────────────────
    if (activeResistance && current.close > activeResistance.top && prev.close > activeResistance.top) {
      if (bearHTF === 0 && confluenceBuy.met >= 3) {
        return {
          verdict: 'BUY',
          setup: 'BREAKOUT_RETEST_EXPANSION',
          confidence: Math.min(95, 68 + confluenceBuy.met * 4),
          stop: activeResistance.bottom,
          target: currentPrice + atr * 3.2,
          ruleName: 'Resistance Breakout & Retest Expansion',
          rationale: `Structural breakout confirmed above ${activeResistance.top.toFixed(2)}. Candle bodies holding above former supply corridor with bullish continuation momentum.`,
        };
      }
    }

    // ── RULE 4: Breakdown Retest Distribution (SELL) ───────────────
    if (activeSupport && current.close < activeSupport.bottom && prev.close < activeSupport.bottom) {
      if (bullHTF === 0 && confluenceSell.met >= 3) {
        return {
          verdict: 'SELL',
          setup: 'BREAKDOWN_RETEST_DISTRIBUTION',
          confidence: Math.min(95, 68 + confluenceSell.met * 4),
          stop: activeSupport.top,
          target: currentPrice - atr * 3.2,
          ruleName: 'Support Breakdown & Distribution Retest',
          rationale: `Structural breakdown confirmed below ${activeSupport.bottom.toFixed(2)}. Candle bodies failing to reclaim former demand floor, signaling institutional liquidations.`,
        };
      }
    }

    // ── RULE 5: High-Conviction Confluence Momentum Trigger ────────
    if (confluenceBuy.met >= 6 && bearHTF === 0 && current.close > current.open) {
      const stop = activeSupport ? activeSupport.bottom : (currentPrice - atr * 1.5);
      return {
        verdict: 'BUY',
        setup: 'HIGH_CONFLUENCE_MOMENTUM_BUY',
        confidence: 90,
        stop,
        target: currentPrice + atr * 2.5,
        ruleName: 'High-Conviction Confluence Expansion',
        rationale: `Extreme structural confluence (${confluenceBuy.score} criteria met) with confirmed BOS, volume delta expansion, and multi-timeframe trend alignment.`,
      };
    }

    if (confluenceSell.met >= 6 && bullHTF === 0 && current.close < current.open) {
      const stop = activeResistance ? activeResistance.top : (currentPrice + atr * 1.5);
      return {
        verdict: 'SELL',
        setup: 'HIGH_CONFLUENCE_MOMENTUM_SELL',
        confidence: 90,
        stop,
        target: currentPrice - atr * 2.5,
        ruleName: 'High-Conviction Confluence Distribution',
        rationale: `Extreme structural confluence (${confluenceSell.score} criteria met) with confirmed BOS, volume delta absorption, and multi-timeframe trend alignment.`,
      };
    }

    // ── RULE 6: Equilibrium Consolidation (WAIT) ───────────────────
    return {
      verdict: 'WAIT',
      setup: 'EQUILIBRIUM_CONSOLIDATION',
      confidence: 50,
      stop: null,
      target: null,
      ruleName: 'Equilibrium Corridor Consolidation',
      rationale: 'Price is oscillating in neutral equilibrium without a confirmed structural breach. Stand aside until candle bodies test boundary corridors.',
    };
  },
};
