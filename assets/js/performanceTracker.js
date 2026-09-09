/**
 * performanceTracker.js — Deeepr-Inspired "The Market Grades Every Call" Tracker
 *
 * Automatically verifies every signal against subsequent price candles:
 *   🟢 Target Hit (+% Gain)
 *   🔴 Stop Hit   (-% Risk)
 *   ⚪ Open / Active
 *
 * Keeps a transparent scorecard of win rate, net PnL, and total calls.
 * Persists data to localStorage.
 */

const STORAGE_KEY = 'tsai_graded_calls';

export class PerformanceTracker {
  constructor() {
    this.calls = this._loadCalls();
  }

  /**
   * Register a new actionable call from the 4-Lane Engine
   * @param {Object} call
   * @returns {Object}
   */
  registerCall({ symbol, timeframe, verdict, entry, target, stop, targetPct, stopPct, riskReward, reasons }) {
    if (verdict !== 'LONG' && verdict !== 'SHORT') return null;

    // Check if an identical active call already exists for this candle
    const existing = this.calls.find(c => c.symbol === symbol && c.status === 'OPEN' && Math.abs(c.entry - entry) / entry < 0.0005);
    if (existing) return existing;

    const newCall = {
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol,
      timeframe,
      verdict, // 'LONG' | 'SHORT'
      entry,
      target,
      stop,
      targetPct,
      stopPct,
      riskReward,
      reasons: reasons || [],
      status: 'OPEN', // 'OPEN' | 'TARGET_HIT' | 'STOP_HIT'
      createdAt: Date.now(),
      resolvedAt: null,
      maxFavorablePrice: entry,
      maxAdversePrice: entry,
    };

    this.calls.unshift(newCall);
    if (this.calls.length > 100) this.calls.pop();
    this._saveCalls();
    return newCall;
  }

  /**
   * Update all OPEN calls against a new incoming candle
   * @param {string} symbol
   * @param {Candle} candle
   * @returns {Array} List of newly resolved calls this tick
   */
  updateOnCandle(symbol, candle) {
    const newlyResolved = [];

    for (const call of this.calls) {
      if (call.status !== 'OPEN' || call.symbol !== symbol) continue;

      if (call.verdict === 'LONG') {
        call.maxFavorablePrice = Math.max(call.maxFavorablePrice, candle.high);
        call.maxAdversePrice = Math.min(call.maxAdversePrice, candle.low);

        // Check Target Hit (High >= target)
        if (candle.high >= call.target) {
          call.status = 'TARGET_HIT';
          call.resolvedAt = Date.now();
          call.exitPrice = call.target;
          call.realizedPnlPct = call.targetPct;
          newlyResolved.push(call);
          continue;
        }

        // Check Stop Hit (Low <= stop)
        if (candle.low <= call.stop) {
          call.status = 'STOP_HIT';
          call.resolvedAt = Date.now();
          call.exitPrice = call.stop;
          call.realizedPnlPct = call.stopPct;
          newlyResolved.push(call);
          continue;
        }
      } else if (call.verdict === 'SHORT') {
        call.maxFavorablePrice = Math.min(call.maxFavorablePrice, candle.low);
        call.maxAdversePrice = Math.max(call.maxAdversePrice, candle.high);

        // Check Target Hit (Low <= target)
        if (candle.low <= call.target) {
          call.status = 'TARGET_HIT';
          call.resolvedAt = Date.now();
          call.exitPrice = call.target;
          call.realizedPnlPct = Math.abs(call.targetPct);
          newlyResolved.push(call);
          continue;
        }

        // Check Stop Hit (High >= stop)
        if (candle.high >= call.stop) {
          call.status = 'STOP_HIT';
          call.resolvedAt = Date.now();
          call.exitPrice = call.stop;
          call.realizedPnlPct = -Math.abs(call.stopPct);
          newlyResolved.push(call);
          continue;
        }
      }
    }

    if (newlyResolved.length > 0) {
      this._saveCalls();
    }

    return newlyResolved;
  }

  /**
   * Get overall scorecard statistics
   * @returns {Scorecard}
   */
  getScorecard() {
    const total = this.calls.length;
    const targetHits = this.calls.filter(c => c.status === 'TARGET_HIT');
    const stopHits = this.calls.filter(c => c.status === 'STOP_HIT');
    const openCalls = this.calls.filter(c => c.status === 'OPEN');
    const resolvedCount = targetHits.length + stopHits.length;

    const winRate = resolvedCount > 0 ? +((targetHits.length / resolvedCount) * 100).toFixed(1) : 0;
    const netPnl = this.calls.reduce((sum, c) => sum + (c.realizedPnlPct || 0), 0);

    return {
      total,
      targetHits: targetHits.length,
      stopHits: stopHits.length,
      openCalls: openCalls.length,
      winRate,
      netPnl: +netPnl.toFixed(2),
      recentCalls: this.calls.slice(0, 25),
    };
  }

  clearHistory() {
    this.calls = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  _loadCalls() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _saveCalls() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.calls));
    } catch {}
  }
}
