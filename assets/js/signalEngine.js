/**
 * signalEngine.js — TradersZone.ai Orchestrator
 *
 * Coordinates:
 *   - Yashwanth's Pine Script S/R Horizon Boxes
 *   - Historical & Live BUY / SELL Arrow Markers on Chart
 *   - Performance Tracker
 *   - UI State Updates
 */

import { FourLaneEngine } from './fourLaneEngine.js';
import { PerformanceTracker } from './performanceTracker.js';
import { Notifications } from './notifications.js';

export class SignalEngine {
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

  async onNewCandle(candles) {
    if (!this._running || !candles || candles.length < 20) return;

    const latest = candles[candles.length - 1];

    // 1. Grade open calls against live price
    const resolvedCalls = this._tracker.updateOnCandle(this._symbol, latest);
    for (const r of resolvedCalls) {
      this._onCallResolved?.(r);
      Notifications.fireInfo(
        `${r.status === 'TARGET_HIT' ? '🎯 Target Hit' : '🛑 Stop Hit'} — ${r.symbol}`,
        `${r.verdict} reached ${r.exitPrice} (${r.realizedPnlPct > 0 ? '+' : ''}${r.realizedPnlPct}%)`
      );
    }

    // 2. Run analysis
    const verdictData = await this._engine.analyze({
      candles,
      symbol: this._symbol,
      timeframe: this._timeframe,
      htfTrend: this._htfTrend,
    });

    // 3. Draw Pine Script S/R Horizon Boxes
    if (verdictData.horizonZones) {
      this._chart.drawHorizonBoxes(verdictData.horizonZones);
    }

    // 4. Populate Historical & Live Signal Markers
    if (verdictData.historicalSignals && verdictData.historicalSignals.length > 0) {
      this._chart.setAllMarkers(verdictData.historicalSignals);
    }

    // 5. Handle Live Actionable Signal
    if (verdictData.verdict === 'BUY' || verdictData.verdict === 'SELL') {
      const levels = verdictData.levels;

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

      this._chart.addSignalMarker({
        time: latest.time,
        type: verdictData.verdict,
        text: `${verdictData.verdict} · ${verdictData.confidence}%`,
      });

      if (latest.time > this._lastSignalTime) {
        this._lastSignalTime = latest.time;

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
          reasons: [verdictData.aiReason],
        });

        Notifications.fireSignalAlert({
          type: verdictData.verdict,
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
      this._chart.clearProjectionZones();
      this._chart.clearSLTPLines();
    }

    this._onVerdictUpdate?.(verdictData);
  }

  async analyzeNow(candles) {
    if (!candles || candles.length < 20) return null;
    const verdictData = await this._engine.analyze({
      candles,
      symbol: this._symbol,
      timeframe: this._timeframe,
      htfTrend: this._htfTrend,
    });

    if (verdictData.horizonZones) {
      this._chart.drawHorizonBoxes(verdictData.horizonZones);
    }

    if (verdictData.historicalSignals && verdictData.historicalSignals.length > 0) {
      this._chart.setAllMarkers(verdictData.historicalSignals);
    }

    if (verdictData.verdict === 'BUY' || verdictData.verdict === 'SELL') {
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
      this._chart.addSignalMarker({
        time: candles[candles.length - 1].time,
        type: verdictData.verdict,
        text: `${verdictData.verdict} · ${verdictData.confidence}%`,
      });
    }

    this._onVerdictUpdate?.(verdictData);
    return verdictData;
  }

  setHTFTrend(trend) {
    this._htfTrend = trend;
  }
}
