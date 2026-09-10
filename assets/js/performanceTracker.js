/**
 * performanceTracker.js — Deeepr-Inspired "The Market Grades Every Call" Tracker
 *
 * Automatically verifies every signal against subsequent price candles:
 *   🟢 Target Hit (+R Gain)
 *   🔴 Stop Hit   (-R Risk)
 *   ⚪ Open / Active
 *
 * Keeps a transparent scorecard of win rate, net R, and total calls.
 * Persists data to localStorage. Pre-seeds 8 demo historical calls on first run.
 */

const STORAGE_KEY  = 'tsai_graded_calls';
const SEEDED_KEY   = 'tsai_demo_seeded_v2';

export class PerformanceTracker {
  constructor() {
    this.calls = this._loadCalls();
    this._seedDemoDataIfEmpty();
  }

  /**
   * Register a new actionable call
   * Accepts verdict: 'BUY' | 'SELL' (fixes previous LONG/SHORT mismatch)
   */
  registerCall({ symbol, timeframe, verdict, entry, target, stop, targetPct, stopPct, riskReward, reasons }) {
    // Normalize direction: accept BUY/SELL or LONG/SHORT
    const dir = verdict === 'LONG' ? 'BUY' : verdict === 'SHORT' ? 'SELL' : verdict;
    if (dir !== 'BUY' && dir !== 'SELL') return null;

    // Deduplicate: skip if an identical active call exists
    const existing = this.calls.find(c =>
      c.symbol === symbol && c.status === 'OPEN' && Math.abs(c.entry - entry) / entry < 0.0005
    );
    if (existing) return existing;

    const newCall = {
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol,
      timeframe,
      verdict: dir,
      entry,
      target,
      stop,
      targetPct,
      stopPct,
      riskReward,
      reasons: reasons || [],
      status: 'OPEN',
      createdAt: Date.now(),
      entryTime: new Date().toISOString(),
      resolvedAt: null,
      exitTime: null,
      exitPrice: null,
      realizedPnlPct: null,
      rMultiple: null,
      maxFavorablePrice: entry,
      maxAdversePrice: entry,
    };

    this.calls.unshift(newCall);
    if (this.calls.length > 150) this.calls.pop();
    this._saveCalls();
    return newCall;
  }

  /**
   * Update all OPEN calls against a new incoming candle
   */
  updateOnCandle(symbol, candle) {
    const newlyResolved = [];

    for (const call of this.calls) {
      if (call.status !== 'OPEN' || call.symbol !== symbol) continue;

      const isBuy  = call.verdict === 'BUY'  || call.verdict === 'LONG';
      const isSell = call.verdict === 'SELL' || call.verdict === 'SHORT';

      if (isBuy) {
        call.maxFavorablePrice = Math.max(call.maxFavorablePrice, candle.high);
        call.maxAdversePrice   = Math.min(call.maxAdversePrice,   candle.low);

        if (call.target && candle.high >= call.target) {
          call.status = 'TARGET_HIT';
          call.resolvedAt = Date.now();
          call.exitTime = new Date().toISOString();
          call.exitPrice = call.target;
          call.realizedPnlPct = call.targetPct;
          call.rMultiple = call.riskReward ? `+${call.riskReward}R` : '+1.5R';
          newlyResolved.push(call);
          continue;
        }
        if (call.stop && candle.low <= call.stop) {
          call.status = 'STOP_HIT';
          call.resolvedAt = Date.now();
          call.exitTime = new Date().toISOString();
          call.exitPrice = call.stop;
          call.realizedPnlPct = call.stopPct;
          call.rMultiple = '-1.0R';
          newlyResolved.push(call);
          continue;
        }
      } else if (isSell) {
        call.maxFavorablePrice = Math.min(call.maxFavorablePrice, candle.low);
        call.maxAdversePrice   = Math.max(call.maxAdversePrice,   candle.high);

        if (call.target && candle.low <= call.target) {
          call.status = 'TARGET_HIT';
          call.resolvedAt = Date.now();
          call.exitTime = new Date().toISOString();
          call.exitPrice = call.target;
          call.realizedPnlPct = Math.abs(call.targetPct);
          call.rMultiple = call.riskReward ? `+${call.riskReward}R` : '+1.5R';
          newlyResolved.push(call);
          continue;
        }
        if (call.stop && candle.high >= call.stop) {
          call.status = 'STOP_HIT';
          call.resolvedAt = Date.now();
          call.exitTime = new Date().toISOString();
          call.exitPrice = call.stop;
          call.realizedPnlPct = -Math.abs(call.stopPct);
          call.rMultiple = '-1.0R';
          newlyResolved.push(call);
          continue;
        }
      }
    }

    if (newlyResolved.length > 0) this._saveCalls();
    return newlyResolved;
  }

  /**
   * Get overall scorecard statistics
   */
  getScorecard() {
    const total       = this.calls.length;
    const targetHits  = this.calls.filter(c => c.status === 'TARGET_HIT');
    const stopHits    = this.calls.filter(c => c.status === 'STOP_HIT');
    const openCalls   = this.calls.filter(c => c.status === 'OPEN');
    const resolvedCnt = targetHits.length + stopHits.length;

    const winRate = resolvedCnt > 0
      ? +((targetHits.length / resolvedCnt) * 100).toFixed(1)
      : 0;

    const netR = this.calls.reduce((sum, c) => {
      if (!c.rMultiple) return sum;
      return sum + parseFloat(c.rMultiple.replace('R', ''));
    }, 0);

    return {
      total,
      targetHits: targetHits.length,
      stopHits:   stopHits.length,
      openCalls:  openCalls.length,
      winRate,
      netR:       +netR.toFixed(1),
      recentCalls: this.calls.slice(0, 25),
    };
  }

  clearHistory() {
    this.calls = [];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEEDED_KEY);
  }

  // ── Demo Data Seeding ─────────────────────────────────────────
  _seedDemoDataIfEmpty() {
    if (localStorage.getItem(SEEDED_KEY)) return;

    const now = Date.now();
    const h   = 3600000;
    const seed = [
      { symbol: 'BTCUSDT', tf: '1H',  verdict: 'BUY',  entry: 64200, target: 65880, stop: 63780, rr: 4.0,  result: 'TARGET_HIT', r: '+4.0R', daysAgo: 1  },
      { symbol: 'ETHUSDT', tf: '4H',  verdict: 'SELL', entry: 3480,  target: 3332,  stop: 3556,  rr: 1.9,  result: 'TARGET_HIT', r: '+1.9R', daysAgo: 2  },
      { symbol: 'BTCUSDT', tf: '1H',  verdict: 'BUY',  entry: 62800, target: 64080, stop: 62220, rr: 2.2,  result: 'STOP_HIT',   r: '-1.0R', daysAgo: 3  },
      { symbol: 'XAUUSD',  tf: '4H',  verdict: 'BUY',  entry: 2318,  target: 2362,  stop: 2298,  rr: 2.2,  result: 'TARGET_HIT', r: '+2.2R', daysAgo: 4  },
      { symbol: 'EURUSD',  tf: '1H',  verdict: 'SELL', entry: 1.0843,target: 1.0790,stop: 1.0870, rr: 1.9, result: 'TARGET_HIT', r: '+1.9R', daysAgo: 5  },
      { symbol: 'SOLUSDT', tf: '15M', verdict: 'BUY',  entry: 172.4, target: 177.6, stop: 170.2, rr: 2.4,  result: 'TARGET_HIT', r: '+2.4R', daysAgo: 6  },
      { symbol: 'BTCUSDT', tf: '4H',  verdict: 'SELL', entry: 65800, target: 63900, stop: 66700, rr: 2.1,  result: 'STOP_HIT',   r: '-1.0R', daysAgo: 8  },
      { symbol: 'ETHUSDT', tf: '1H',  verdict: 'BUY',  entry: 3220,  target: 3380,  stop: 3148,  rr: 2.2,  result: 'TARGET_HIT', r: '+2.2R', daysAgo: 10 },
    ];

    for (const s of seed) {
      const createdAt = now - s.daysAgo * 24 * h;
      const resolvedAt = s.result !== 'OPEN' ? createdAt + h * 6 : null;
      this.calls.push({
        id: `demo_${Math.random().toString(36).substring(2, 9)}`,
        symbol: s.symbol,
        timeframe: s.tf,
        verdict: s.verdict,
        entry: s.entry,
        target: s.target,
        stop: s.stop,
        targetPct: +(((s.target - s.entry) / s.entry) * 100 * (s.verdict === 'SELL' ? -1 : 1)).toFixed(2),
        stopPct: -(Math.abs((s.stop - s.entry) / s.entry) * 100).toFixed(2),
        riskReward: s.rr,
        reasons: ['Historical demo signal — pre-seeded for demonstration'],
        status: s.result,
        createdAt,
        entryTime: new Date(createdAt).toISOString(),
        resolvedAt,
        exitTime: resolvedAt ? new Date(resolvedAt).toISOString() : null,
        exitPrice: s.result === 'TARGET_HIT' ? s.target : s.result === 'STOP_HIT' ? s.stop : null,
        realizedPnlPct: s.result !== 'OPEN' ? parseFloat(s.r) : null,
        rMultiple: s.result !== 'OPEN' ? s.r : null,
        maxFavorablePrice: s.entry,
        maxAdversePrice: s.entry,
      });
    }

    this._saveCalls();
    localStorage.setItem(SEEDED_KEY, '1');
  }

  _loadCalls() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _saveCalls() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.calls));
    } catch {}
  }
}
