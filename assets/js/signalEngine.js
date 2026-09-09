/**
 * signalEngine.js — Signal aggregator
 *
 * Orchestrates:
 *  - SMC Engine (logic)
 *  - AI Engine (Gemini confirmation)
 *  - Chart zone rendering
 *  - Notification dispatch
 *  - Signal history log
 */

import { SMCEngine }     from './smcEngine.js';
import { AIEngine }      from './aiEngine.js';
import { Notifications } from './notifications.js';
import { Settings }      from './settings.js';

// Minimum RR to accept a signal (must be ≥ 1.5)
const MIN_RR = 1.5;

export class SignalEngine {
  /**
   * @param {ChartManager} chartManager
   * @param {Function} onSignal  callback(signal) called when a signal fires
   */
  constructor(chartManager, onSignal) {
    this._chart     = chartManager;
    this._onSignal  = onSignal;
    this._smc       = null;     // SMCEngine instance (re-created on settings change)
    this._signals   = [];       // Signal history (last 50)
    this._lastSignalTime = 0;   // Debounce: 1 signal per candle
    this._htfTrend  = 'NEUTRAL';
    this._symbol    = '';
    this._timeframe = '';
    this._market    = '';
    this._running   = false;
    this._refreshSMC();
  }

  _refreshSMC() {
    this._smc = new SMCEngine({
      swingLookback:   Settings.getSwingLookback(),
      signalThreshold: Settings.getSMCThreshold(),
    });
  }

  /** Start signal engine for a given symbol/TF */
  start(symbol, timeframe, market) {
    this._symbol    = symbol;
    this._timeframe = timeframe;
    this._market    = market;
    this._running   = true;
    this._refreshSMC();
  }

  stop() {
    this._running = false;
  }

  get signals() { return [...this._signals]; }

  /**
   * Called on every new closed candle from DataFeed.
   * Runs full SMC analysis and fires signal if conditions met.
   * @param {Candle[]} candles  Full candle history up to now
   */
  async onNewCandle(candles) {
    if (!this._running || candles.length < 20) return;

    const latest = candles[candles.length - 1];

    // Debounce: skip if we already signaled on this candle
    if (latest.time <= this._lastSignalTime) return;

    // Run SMC analysis
    const smcResult = this._smc.analyze(candles, this._htfTrend);

    // Always draw SMC zones on chart (regardless of signal)
    this._chart.drawSMCZones(smcResult);

    // Only proceed if logic engine has a non-NEUTRAL signal
    if (smcResult.signal === 'NEUTRAL') return;

    // Require minimum RR
    if (smcResult.riskReward !== null && smcResult.riskReward < MIN_RR) {
      console.log(`[SignalEngine] RR too low (${smcResult.riskReward}) — skipping`);
      return;
    }

    this._lastSignalTime = latest.time;

    // Get AI confirmation (async, non-blocking for UI)
    let aiResult;
    try {
      aiResult = await AIEngine.analyzeSignal({
        symbol:    this._symbol,
        timeframe: this._timeframe,
        market:    this._market,
        smcResult,
        candles,
      });
    } catch {
      aiResult = {
        source: 'LOGIC_ONLY', finalSignal: smcResult.signal,
        finalConfidence: smcResult.confidence, reasoning: '',
        adjustedSL: smcResult.stopLoss, adjustedTP: smcResult.takeProfit,
      };
    }

    // AI can veto the signal
    if (aiResult.finalSignal === 'NEUTRAL') {
      console.log('[SignalEngine] AI vetoed signal — standing aside');
      return;
    }

    // Build final signal object
    const signal = {
      id:          `${this._symbol}_${latest.time}`,
      type:        aiResult.finalSignal,
      symbol:      this._symbol,
      timeframe:   this._timeframe,
      market:      this._market,
      price:       latest.close,
      stopLoss:    aiResult.adjustedSL  ?? smcResult.stopLoss,
      takeProfit:  aiResult.adjustedTP  ?? smcResult.takeProfit,
      riskReward:  smcResult.riskReward,
      confidence:  aiResult.finalConfidence,
      logicScore:  smcResult.confidence,
      aiScore:     aiResult.aiSignal !== null ? aiResult.finalConfidence : null,
      reasons:     smcResult.reasons,
      reasoning:   aiResult.reasoning,
      warnings:    aiResult.warnings,
      source:      aiResult.source,
      bosSignal:   smcResult.bosSignal,
      trend:       smcResult.trend,
      atr:         smcResult.atr,
      timestamp:   Date.now(),
      candleTime:  latest.time,
    };

    // Add arrow marker to chart
    this._chart.addSignalMarker({
      time: latest.time,
      type: signal.type,
      text: `${signal.type} ${signal.confidence}%`,
    });

    // Show SL/TP lines
    this._chart.showSLTPLines({
      entryPrice: signal.price,
      stopLoss:   signal.stopLoss,
      takeProfit: signal.takeProfit,
    });

    // Add to history (keep last 50)
    this._signals.unshift(signal);
    if (this._signals.length > 50) this._signals.pop();

    // Fire browser notification
    Notifications.fireSignalAlert(signal);

    // Notify UI callback
    this._onSignal?.(signal);

    console.log(`[SignalEngine] ${signal.type} signal on ${signal.symbol} @ ${signal.price} | Confidence: ${signal.confidence}% | RR: ${signal.riskReward}`);
  }

  /**
   * Run analysis without waiting for a new closed candle.
   * Used for "Analyze Now" button.
   */
  async analyzeNow(candles) {
    if (!candles || candles.length < 20) return null;
    const smcResult = this._smc.analyze(candles, this._htfTrend);
    this._chart.drawSMCZones(smcResult);
    return smcResult;
  }

  /** Set HTF trend bias (called externally, e.g., from multi-TF dropdown) */
  setHTFTrend(trend) {
    this._htfTrend = trend; // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  }

  /** Reload SMC config from settings */
  reloadConfig() { this._refreshSMC(); }

  clearHistory() { this._signals = []; }
}
