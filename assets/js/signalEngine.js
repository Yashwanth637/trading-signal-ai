/**
 * signalEngine.js — Signal & 4-Lane Orchestrator
 *
 * Coordinates:
 *   - FourLaneEngine ([T] Tech, [F] Flow, [N] News, [M] Macro)
 *   - PerformanceTracker (Graded Calls: Target Hit vs Stop Hit)
 *   - ChartManager (Projected Shaded Boxes, Markers, Lines)
 *   - Notifications & Audio Alerts
 */

import { FourLaneEngine } from './fourLaneEngine.js';
import { PerformanceTracker } from './performanceTracker.js';
import { Notifications } from './notifications.js';

export class SignalEngine {
  /**
   * @param {ChartManager} chartManager
   * @param {Function} onVerdictUpdate  callback(verdictData)
   * @param {Function} onCallResolved   callback(resolvedCall)
   */
  constructor(chartManager, onVerdictUpdate, onCallResolved) {
    this._chart = chartManager;
    this._onVerdictUpdate = onVerdictUpdate;
    this._onCallResolved = onCallResolved;
    this._engine = new FourLaneEngine();
    this._tracker = new PerformanceTracker();

    this._symbol = '';
    this._timeframe = '';
    this._market = '';
    this._htfTrend = 'NEUTRAL';
    this._running = false;
    this._lastSignalTime = 0;
  }

  start(symbol, timeframe, market) {
    this._symbol = symbol;
    this._timeframe = timeframe;
    this._market = market;
    this._running = true;
  }

  stop() {
    this._running = false;
  }

  get tracker() {
    return this._tracker;
  }

  /**
   * Process an incoming closed candle or full history update
   * @param {Candle[]} candles
   */
  async onNewCandle(candles) {
    if (!this._running || !candles || candles.length < 20) return;

    const latest = candles[candles.length - 1];

    // 1. Grade open calls against the incoming candle in real-time
    const resolvedCalls = this._tracker.updateOnCandle(this._symbol, latest);
    for (const r of resolvedCalls) {
      this._onCallResolved?.(r);
      const isWin = r.status === 'TARGET_HIT';
      Notifications.fireInfo(
        `${isWin ? '🎯 Target Hit' : '🛑 Stop Hit'} — ${r.symbol}`,
        `${r.verdict} completed at ${r.exitPrice} (${r.realizedPnlPct > 0 ? '+' : ''}${r.realizedPnlPct}%)`
      );
    }

    // 2. Run 4-Lane Real-Time Analysis
    const verdictData = await this._engine.analyze({
      candles,
      symbol: this._symbol,
      timeframe: this._timeframe,
      htfTrend: this._htfTrend,
    });

    // 3. Draw SMC structural zones
    if (verdictData.smcData) {
      this._chart.drawSMCZones(verdictData.smcData);
    }

    // 4. Handle actionable trade calls (LONG or SHORT)
    if (verdictData.verdict === 'LONG' || verdictData.verdict === 'SHORT') {
      const levels = verdictData.levels;

      // Draw Deeepr-style forward-projected shaded boxes on chart
      this._chart.drawProjectionZones({
        entry: levels.entry,
        target: levels.target,
        stop: levels.stop,
        verdict: verdictData.verdict,
        startTime: latest.time,
      });

      this._chart.showSLTPLines({
        entryPrice: levels.entry,
        stopLoss: levels.stop,
        takeProfit: levels.target,
      });

      // Avoid double-signaling on identical bar
      if (latest.time > this._lastSignalTime) {
        this._lastSignalTime = latest.time;

        // Register to Graded Calls Performance Tracker
        this._tracker.registerCall({
          symbol: this._symbol,
          timeframe: this._timeframe,
          verdict: verdictData.verdict,
          entry: levels.entry,
          target: levels.target,
          stop: levels.stop,
          targetPct: levels.targetPct,
          stopPct: levels.stopPct,
          riskReward: levels.riskReward,
          reasons: verdictData.reasons,
        });

        // Add visual arrow marker to chart
        this._chart.addSignalMarker({
          time: latest.time,
          type: verdictData.verdict,
          text: `${verdictData.verdict} · ${verdictData.agreementCount}/4`,
        });

        // Dispatch browser notification & audio alert
        Notifications.fireSignalAlert({
          type: verdictData.verdict === 'LONG' ? 'BUY' : 'SELL',
          symbol: this._symbol,
          timeframe: this._timeframe,
          confidence: verdictData.confidence,
          price: levels.entry,
          stopLoss: levels.stop,
          takeProfit: levels.target,
          riskReward: levels.riskReward,
        });
      }
    } else {
      // Verdict is WAIT
      this._chart.clearProjectionZones();
      this._chart.clearSLTPLines();
    }

    // 5. Notify UI to update Hero Card & Lane breakdown
    this._onVerdictUpdate?.(verdictData);
  }

  /**
   * Manual instant analysis (e.g. from "⚡ Analyze" button)
   * @param {Candle[]} candles
   */
  async analyzeNow(candles) {
    if (!candles || candles.length < 20) return null;
    const verdictData = await this._engine.analyze({
      candles,
      symbol: this._symbol,
      timeframe: this._timeframe,
      htfTrend: this._htfTrend,
    });

    if (verdictData.smcData) {
      this._chart.drawSMCZones(verdictData.smcData);
    }

    if (verdictData.verdict === 'LONG' || verdictData.verdict === 'SHORT') {
      const levels = verdictData.levels;
      this._chart.drawProjectionZones({
        entry: levels.entry,
        target: levels.target,
        stop: levels.stop,
        verdict: verdictData.verdict,
        startTime: candles[candles.length - 1].time,
      });
      this._chart.showSLTPLines({
        entryPrice: levels.entry,
        stopLoss: levels.stop,
        takeProfit: levels.target,
      });
    }

    this._onVerdictUpdate?.(verdictData);
    return verdictData;
  }

  setHTFTrend(trend) {
    this._htfTrend = trend;
  }
}
