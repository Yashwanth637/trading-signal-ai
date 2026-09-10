/**
 * signalEngine.js — TradersZone.ai Orchestrator
 *
 * Coordinates:
 *   - Yashwanth's Pine Script S/R Horizon Boxes
 *   - Historical & Live BUY / SELL Arrow Markers on Chart
 *   - Multi-Timeframe Alignment Matrix
 *   - Performance Tracker
 *   - UI State Updates
 *   - Webhook dispatch on new signals
 */

import { FourLaneEngine } from './fourLaneEngine.js';
import { MTFEngine } from './mtfEngine.js';
import { PerformanceTracker } from './performanceTracker.js';
import { Notifications } from './notifications.js';

export class SignalEngine {
  constructor(chartManager, onVerdictUpdate, onCallResolved) {
    this._chart          = chartManager;
    this._onVerdictUpdate = onVerdictUpdate;
    this._onCallResolved  = onCallResolved;
    this._engine         = new FourLaneEngine();
    this._mtf            = new MTFEngine();
    this._tracker        = new PerformanceTracker();

    this._symbol    = '';
    this._timeframe = '';
    this._market    = '';
    this._running   = false;
    this._lastSignalTime = 0;
  }

  start(symbol, timeframe, market) {
    this._symbol    = symbol;
    this._timeframe = timeframe;
    this._market    = market;
    this._running   = true;
  }

  stop() {
    this._running = false;
  }

  get tracker() {
    return this._tracker;
  }

  get mtf() {
    return this._mtf;
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
        `${r.verdict} reached ${r.exitPrice} · ${r.rMultiple || ''}`
      );
    }

    // 2. Update MTF matrix & inject into engine
    const mtfMatrix = this._mtf.update(candles, this._timeframe);
    this._engine.setMTFMatrix(mtfMatrix);
    const htfTrend = this._mtf.getHTFBias();

    // 3. Run analysis
    const verdictData = await this._engine.analyze({
      candles,
      symbol: this._symbol,
      timeframe: this._timeframe,
      htfTrend,
    });

    // 4. Draw Pine Script S/R Horizon Boxes
    if (verdictData.horizonZones) {
      this._chart.drawHorizonBoxes(verdictData.horizonZones);
    }

    // 5. Populate Historical & Live Signal Markers
    if (verdictData.historicalSignals && verdictData.historicalSignals.length > 0) {
      this._chart.setAllMarkers(verdictData.historicalSignals);
    }

    // 6. Handle Live Actionable Signal
    if (verdictData.verdict === 'BUY' || verdictData.verdict === 'SELL') {
      const levels = verdictData.levels;

      this._chart.drawProjectionZones({
        entry:   levels.entry,
        target:  levels.target,
        stop:    levels.stop,
        verdict: verdictData.verdict,
        startTime: latest.time,
      });

      this._chart.showSLTPLines({
        entryPrice: levels.entry,
        stopLoss:   levels.stop,
        takeProfit: levels.target,
        tp2:        levels.tp2,
        runner:     levels.runner,
      });

      this._chart.addSignalMarker({
        time: latest.time,
        type: verdictData.verdict,
        text: `${verdictData.verdict} · ${verdictData.confidence}%`,
      });

      if (latest.time > this._lastSignalTime) {
        this._lastSignalTime = latest.time;

        this._tracker.registerCall({
          symbol:     this._symbol,
          timeframe:  this._timeframe,
          verdict:    verdictData.verdict,
          entry:      levels.entry,
          target:     levels.target,
          stop:       levels.stop,
          targetPct:  levels.targetPct,
          stopPct:    levels.stopPct,
          riskReward: levels.riskReward,
          reasons:    [verdictData.aiReason],
        });

        Notifications.fireSignalAlert({
          type:        verdictData.verdict,
          symbol:      this._symbol,
          timeframe:   this._timeframe,
          confidence:  verdictData.confidence,
          price:       levels.entry,
          stopLoss:    levels.stop,
          takeProfit:  levels.target,
          riskReward:  levels.riskReward,
        });

        // Webhook dispatch
        Notifications.fireWebhook({
          signal:     verdictData.verdict,
          symbol:     this._symbol,
          timeframe:  this._timeframe,
          confidence: verdictData.confidence,
          entry:      levels.entry,
          stop:       levels.stop,
          target:     levels.target,
          riskReward: levels.riskReward,
          timestamp:  Date.now(),
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

    // Update MTF matrix first
    const mtfMatrix = this._mtf.update(candles, this._timeframe);
    this._engine.setMTFMatrix(mtfMatrix);
    const htfTrend = this._mtf.getHTFBias();

    const verdictData = await this._engine.analyze({
      candles,
      symbol:    this._symbol,
      timeframe: this._timeframe,
      htfTrend,
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
        entry:   levels.entry,
        target:  levels.target,
        stop:    levels.stop,
        verdict: verdictData.verdict,
        startTime: candles[candles.length - 1].time,
      });
      this._chart.showSLTPLines({
        entryPrice: levels.entry,
        stopLoss:   levels.stop,
        takeProfit: levels.target,
        tp2:        levels.tp2,
        runner:     levels.runner,
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
    // Kept for API compatibility; MTF engine now handles this automatically
  }
}
