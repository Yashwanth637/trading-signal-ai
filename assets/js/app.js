/**
 * app.js — Application Bootstrap & Deeepr.ai Workflow Coordinator
 */

import { DataFeed } from './dataFeed.js';
import { ChartManager } from './chart.js';
import { SignalEngine } from './signalEngine.js';
import { StrategyBuilder } from './strategyBuilder.js';
import { UI } from './ui.js';
import { Settings } from './settings.js';
import { Notifications } from './notifications.js';

const CRYPTO_SYMBOLS = [
  { value: 'BTCUSDT', label: 'BTC/USDT' },
  { value: 'ETHUSDT', label: 'ETH/USDT' },
  { value: 'SOLUSDT', label: 'SOL/USDT' },
  { value: 'BNBUSDT', label: 'BNB/USDT' },
  { value: 'XRPUSDT', label: 'XRP/USDT' },
  { value: 'ADAUSDT', label: 'ADA/USDT' },
  { value: 'AVAXUSDT', label: 'AVAX/USDT' },
  { value: 'DOGEUSDT', label: 'DOGE/USDT' },
];

const FOREX_SYMBOLS = [
  { value: 'EURUSD', label: 'EUR/USD' },
  { value: 'GBPUSD', label: 'GBP/USD' },
  { value: 'USDJPY', label: 'USD/JPY' },
  { value: 'AUDUSD', label: 'AUD/USD' },
  { value: 'USDCAD', label: 'USD/CAD' },
  { value: 'XAUUSD', label: 'XAU/USD (Gold)' },
];

let dataFeed;
let chartManager;
let signalEngine;
let strategyBuilder;
let ui;

let currentSymbol = Settings.getLastSymbol();
let currentTF = Settings.getLastTF() || '60';
let currentMarket = Settings.getLastMarket() || 'CRYPTO';
let activeNav = 'terminal'; // 'terminal' | 'strategy' | 'graded'

async function init() {
  ui = new UI();
  strategyBuilder = new StrategyBuilder();

  // Populate symbol dropdown
  populateSymbolDropdown(currentMarket);
  setDropdownValue('sym-select', currentSymbol);

  // Initialize Chart
  chartManager = new ChartManager('main-chart', 'vol-chart');
  chartManager.init('dark');

  // Initialize Signal Engine with callbacks for UI updates
  signalEngine = new SignalEngine(
    chartManager,
    (verdictData) => {
      ui.renderHeroVerdict(verdictData);
      ui.renderLaneBreakdown(verdictData);
      ui.renderGradedScorecard(signalEngine.tracker.getScorecard());
    },
    (resolvedCall) => {
      ui.renderGradedScorecard(signalEngine.tracker.getScorecard());
      ui.toast(
        `${resolvedCall.status === 'TARGET_HIT' ? '🎯 Target Hit' : '🛑 Stop Hit'}: ${resolvedCall.symbol} ${resolvedCall.verdict}`,
        resolvedCall.status === 'TARGET_HIT' ? 'success' : 'danger',
        6000
      );
    }
  );

  // Initialize Data Feed
  dataFeed = new DataFeed();

  dataFeed.on('history', (candles) => {
    chartManager.setHistory(candles);
    signalEngine.start(currentSymbol, currentTF, currentMarket);
    ui.setStatus({ text: `Loaded ${candles.length} candles · ${currentSymbol}`, type: 'ok', source: 'Live Stream' });

    // Run initial 4-lane analysis
    signalEngine.analyzeNow(candles);
    ui.renderGradedScorecard(signalEngine.tracker.getScorecard());
  });

  dataFeed.on('candle', async (candle) => {
    chartManager.updateCandle(candle);
    ui.updateTicker({ price: candle.close, change24h: null });

    // Every closed candle triggers the 4-lane reconciliation engine
    if (candle.isClosed !== false) {
      await signalEngine.onNewCandle(dataFeed.candles);
    }
  });

  dataFeed.on('status', ({ connected, source }) => {
    ui.setStatus({
      text: connected ? `Live stream connected` : `Reconnecting…`,
      type: connected ? 'ok' : 'warn',
      source: source || 'Binance WS',
    });
  });

  dataFeed.on('error', (msg) => {
    ui.toast(msg, 'warning', 5000);
  });

  // Request browser notifications permission
  await Notifications.requestPermission();

  // Wire all UI Event Handlers
  wireEventListeners();

  // Load initial data
  await loadMarketData(currentSymbol, currentTF, currentMarket);
}

async function loadMarketData(symbol, tf, market) {
  signalEngine.stop();
  ui.setStatus({ text: `Subscribing to ${symbol} (${tf})…`, type: 'info', source: market });

  try {
    await dataFeed.subscribe(symbol, tf, market);
  } catch (err) {
    ui.toast(err.message, 'danger');
  }
}

function wireEventListeners() {
  // Symbol dropdown
  document.getElementById('sym-select')?.addEventListener('change', (e) => {
    currentSymbol = e.target.value;
    Settings.setLastSymbol(currentSymbol);
    loadMarketData(currentSymbol, currentTF, currentMarket);
  });

  // Market toggle
  document.getElementById('mkt-crypto')?.addEventListener('click', () => switchMarket('CRYPTO'));
  document.getElementById('mkt-forex')?.addEventListener('click', () => switchMarket('FOREX'));

  // Timeframe chips
  document.querySelectorAll('.tf-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTF = btn.dataset.tf;
      Settings.setLastTF(currentTF);
      loadMarketData(currentSymbol, currentTF, currentMarket);
    });
  });

  // Analyze Now button
  document.getElementById('analyze-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('analyze-btn');
    btn.classList.add('pulse');
    ui.setStatus({ text: 'Executing 4-lane reconciliation…', type: 'info', source: 'Engine' });

    const verdict = await signalEngine.analyzeNow(dataFeed.candles);
    btn.classList.remove('pulse');

    if (verdict) {
      ui.toast(
        verdict.verdict === 'WAIT'
          ? `WAIT verdict: ${verdict.waitReason}`
          : `Verdict: ${verdict.verdict} (${verdict.agreementCount}/4 lanes agree)`,
        verdict.verdict === 'LONG' ? 'success' : verdict.verdict === 'SHORT' ? 'danger' : 'warning',
        5000
      );
    }
  });

  // Strategy Builder compilation & backtest
  document.getElementById('btn-compile-strategy')?.addEventListener('click', () => {
    const promptInput = document.getElementById('strategy-prompt-input');
    const prompt = promptInput?.value?.trim();
    if (!prompt) {
      ui.toast('Please enter a strategy description in plain English', 'warning');
      return;
    }

    const compiled = strategyBuilder.compile(prompt);
    const backtest = strategyBuilder.backtest(compiled, dataFeed.candles);
    ui.renderStrategyResults(compiled, backtest);
    ui.toast(`Strategy compiled and backtested on ${backtest.totalTrades} historical trades!`, 'success');
  });

  // HTF bias selector
  document.getElementById('htf-bias-sel')?.addEventListener('change', (e) => {
    signalEngine.setHTFTrend(e.target.value);
    signalEngine.analyzeNow(dataFeed.candles);
  });

  // Mode tabs (SMC vs TV)
  document.getElementById('btn-mode-smc')?.addEventListener('click', () => switchChartMode('smc'));
  document.getElementById('btn-mode-tv')?.addEventListener('click', () => switchChartMode('tv'));

  // Notification button
  document.getElementById('notif-btn')?.addEventListener('click', async () => {
    const perm = await Notifications.requestPermission();
    ui.toast(perm === 'granted' ? 'Notifications active ✓' : 'Notifications blocked', perm === 'granted' ? 'success' : 'warning');
  });

  // Settings modal
  document.getElementById('settings-btn')?.addEventListener('click', () => ui.openSettings());
  document.getElementById('modal-close-btn')?.addEventListener('click', () => ui.closeSettings());
  document.getElementById('modal-cancel-btn')?.addEventListener('click', () => ui.closeSettings());
  document.getElementById('modal-save-btn')?.addEventListener('click', () => ui.saveSettings());
}

function switchMarket(market) {
  currentMarket = market;
  Settings.setLastMarket(market);

  document.getElementById('mkt-crypto')?.classList.toggle('active', market === 'CRYPTO');
  document.getElementById('mkt-forex')?.classList.toggle('active', market === 'FOREX');

  populateSymbolDropdown(market);
  currentSymbol = market === 'CRYPTO' ? 'BTCUSDT' : 'EURUSD';
  Settings.setLastSymbol(currentSymbol);
  setDropdownValue('sym-select', currentSymbol);

  loadMarketData(currentSymbol, currentTF, currentMarket);
}

function switchChartMode(mode) {
  const mainChart = document.getElementById('main-chart');
  const volChart = document.getElementById('vol-chart');
  const tvFrame = document.getElementById('tv-widget-frame');
  const btnSmc = document.getElementById('btn-mode-smc');
  const btnTv = document.getElementById('btn-mode-tv');

  if (mode === 'smc') {
    mainChart.style.display = 'block';
    volChart.style.display = 'block';
    tvFrame.style.display = 'none';
    btnSmc.classList.add('active');
    btnTv.classList.remove('active');
  } else {
    mainChart.style.display = 'none';
    volChart.style.display = 'none';
    tvFrame.style.display = 'block';
    btnTv.classList.add('active');
    btnSmc.classList.remove('active');

    // Embed TV widget
    tvFrame.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.onload = () => {
      /* global TradingView */
      if (typeof TradingView !== 'undefined') {
        new TradingView.widget({
          autosize: true,
          symbol: currentMarket === 'CRYPTO' ? `BINANCE:${currentSymbol}` : `FX:${currentSymbol}`,
          interval: currentTF === '1D' ? 'D' : currentTF,
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          container_id: 'tv-widget-frame',
        });
      }
    };
    tvFrame.appendChild(script);
  }
}

// Global Nav switching functions
window.switchNavTab = function (tab) {
  activeNav = tab;
  document.querySelectorAll('.nav-link').forEach((b) => b.classList.remove('active'));
  document.getElementById(`nav-${tab}`)?.classList.add('active');

  const chartArea = document.getElementById('chart-area');
  const sbView = document.getElementById('strategy-builder-view');

  if (tab === 'strategy') {
    chartArea.style.display = 'none';
    sbView.style.display = 'flex';
  } else {
    chartArea.style.display = 'flex';
    sbView.style.display = 'none';
    if (tab === 'graded') {
      window.switchSidebarTab('graded');
    } else {
      window.switchSidebarTab('lanes');
    }
  }
};

window.switchSidebarTab = function (tab) {
  const tabLanes = document.getElementById('sbtab-lanes');
  const tabGraded = document.getElementById('sbtab-graded');
  const cLanes = document.getElementById('sb-content-lanes');
  const cGraded = document.getElementById('sb-content-graded');

  if (tab === 'lanes') {
    tabLanes?.classList.add('active');
    tabGraded?.classList.remove('active');
    if (cLanes) cLanes.style.display = 'flex';
    if (cGraded) cGraded.style.display = 'none';
  } else {
    tabGraded?.classList.add('active');
    tabLanes?.classList.remove('active');
    if (cGraded) cGraded.style.display = 'flex';
    if (cLanes) cLanes.style.display = 'none';
  }
};

window.toast = function (msg, type = 'info') {
  ui?.toast(msg, type);
};

function populateSymbolDropdown(market) {
  const sel = document.getElementById('sym-select');
  if (!sel) return;
  const list = market === 'CRYPTO' ? CRYPTO_SYMBOLS : FOREX_SYMBOLS;
  sel.innerHTML = list.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
}

function setDropdownValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

document.addEventListener('DOMContentLoaded', init);
