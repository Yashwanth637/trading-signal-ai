/**
 * app.js — TradersZone.ai Application Bootstrap
 *
 * Coordinates:
 *   - Symbol and Market selection (Crypto, Gold, Forex)
 *   - DataFeed subscriptions (Zero-key Binance + PAXG Gold + Forex)
 *   - Chart updates and theme transitions
 *   - Main Signal & Simple AI Explanation rendering
 */

import { DataFeed } from './dataFeed.js';
import { ChartManager } from './chart.js';
import { SignalEngine } from './signalEngine.js';
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

const FOREX_AND_GOLD_SYMBOLS = [
  { value: 'XAUUSD', label: 'XAU/USD (Gold)' },
  { value: 'EURUSD', label: 'EUR/USD' },
  { value: 'GBPUSD', label: 'GBP/USD' },
  { value: 'USDJPY', label: 'USD/JPY' },
  { value: 'AUDUSD', label: 'AUD/USD' },
  { value: 'USDCAD', label: 'USD/CAD' },
];

let dataFeed;
let chartManager;
let signalEngine;
let ui;

let currentSymbol = Settings.getLastSymbol();
let currentTF = Settings.getLastTF() || '60';
let currentMarket = Settings.getLastMarket() || 'CRYPTO';

async function init() {
  ui = new UI();
  const initialTheme = Settings.getTheme() || 'dark';
  ui.applyTheme(initialTheme);

  // Setup dropdowns
  populateSymbolDropdown(currentMarket);
  setDropdownValue('sym-select', currentSymbol);

  // Initialize Chart
  chartManager = new ChartManager('main-chart', 'vol-chart');
  chartManager.init(initialTheme);

  // Initialize Signal Engine
  signalEngine = new SignalEngine(
    chartManager,
    (verdictData) => {
      ui.renderHeroVerdict(verdictData);
      ui.renderMainSignalCard(verdictData);
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

  // Initialize Market Data Feed
  dataFeed = new DataFeed();

  dataFeed.on('history', (candles) => {
    // Clean transition to new symbol's data
    chartManager.clearMarkers();
    chartManager.clearProjectionZones();
    chartManager.clearSLTPLines();

    chartManager.setHistory(candles);
    signalEngine.start(currentSymbol, currentTF, currentMarket);
    ui.setStatus({ text: `Live: ${currentSymbol} (${currentTF})`, type: 'ok', source: currentMarket });

    // Run analysis immediately on the newly loaded pair
    signalEngine.analyzeNow(candles);
    ui.renderGradedScorecard(signalEngine.tracker.getScorecard());
  });

  dataFeed.on('candle', async (candle) => {
    chartManager.updateCandle(candle);
    ui.updateTicker({ price: candle.close, change24h: null });

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
    ui.toast(msg, 'warning', 4000);
  });

  // Request browser notifications
  await Notifications.requestPermission();

  // Wire Event Listeners
  wireEventListeners();

  // Load initial symbol data
  await loadMarketData(currentSymbol, currentTF, currentMarket);
}

async function loadMarketData(symbol, tf, market) {
  signalEngine.stop();
  chartManager.clearMarkers();
  chartManager.clearProjectionZones();
  chartManager.clearSLTPLines();

  ui.setStatus({ text: `Loading ${symbol} (${tf})…`, type: 'info', source: market });

  try {
    await dataFeed.subscribe(symbol, tf, market);
  } catch (err) {
    ui.toast(`Feed error: ${err.message}`, 'danger');
  }
}

function wireEventListeners() {
  // Currency Pair Selector Change
  document.getElementById('sym-select')?.addEventListener('change', (e) => {
    currentSymbol = e.target.value;
    Settings.setLastSymbol(currentSymbol);
    loadMarketData(currentSymbol, currentTF, currentMarket);
  });

  // Market Switcher (Crypto vs Forex/Gold)
  document.getElementById('mkt-crypto')?.addEventListener('click', () => switchMarket('CRYPTO'));
  document.getElementById('mkt-forex')?.addEventListener('click', () => switchMarket('FOREX'));

  // Timeframe Chips
  document.querySelectorAll('.tf-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTF = btn.dataset.tf;
      Settings.setLastTF(currentTF);
      loadMarketData(currentSymbol, currentTF, currentMarket);
    });
  });

  // Analyze Now Button
  document.getElementById('analyze-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('analyze-btn');
    btn.classList.add('pulse');
    ui.setStatus({ text: 'Executing analysis…', type: 'info', source: 'Engine' });

    const verdict = await signalEngine.analyzeNow(dataFeed.candles);
    btn.classList.remove('pulse');

    if (verdict) {
      ui.toast(
        verdict.verdict === 'WAIT'
          ? `WAIT: ${verdict.aiReason}`
          : `${verdict.verdict} Signal Generated!`,
        verdict.verdict === 'BUY' ? 'success' : verdict.verdict === 'SELL' ? 'danger' : 'warning',
        5000
      );
    }
  });

  // Dynamic Light / Dark Theme Toggle
  document.getElementById('theme-btn')?.addEventListener('click', () => {
    const newTheme = ui.toggleTheme();
    chartManager.setTheme(newTheme);
    ui.toast(`Theme switched to ${newTheme.toUpperCase()}`, 'info', 2000);
  });

  // Notification Button
  document.getElementById('notif-btn')?.addEventListener('click', async () => {
    const perm = await Notifications.requestPermission();
    ui.toast(perm === 'granted' ? 'Browser push alerts active ✓' : 'Alerts blocked by browser', perm === 'granted' ? 'success' : 'warning');
  });

  // Settings Modal
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
  currentSymbol = market === 'CRYPTO' ? 'BTCUSDT' : 'XAUUSD';
  Settings.setLastSymbol(currentSymbol);
  setDropdownValue('sym-select', currentSymbol);

  loadMarketData(currentSymbol, currentTF, currentMarket);
}

function populateSymbolDropdown(market) {
  const sel = document.getElementById('sym-select');
  if (!sel) return;
  const list = market === 'CRYPTO' ? CRYPTO_SYMBOLS : FOREX_AND_GOLD_SYMBOLS;
  sel.innerHTML = list.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
}

function setDropdownValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

document.addEventListener('DOMContentLoaded', init);
