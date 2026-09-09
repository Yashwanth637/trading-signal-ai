/**
 * app.js — TradersZone.ai Application Bootstrap
 *
 * Guaranteed non-blocking event listener registration,
 * instant Light/Dark theme switching, and seamless currency pair switching.
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

// ── GLOBAL FAIL-SAFE WINDOW METHODS ───────────────────────────────
window.toggleTheme = function () {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  Settings.setTheme(next);

  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = next === 'dark' ? '☀' : '☾';

  if (chartManager) chartManager.setTheme(next);
  if (ui) ui.toast(`Theme: ${next.toUpperCase()}`, 'info', 1500);
};

window.onSymbolSelect = function (val) {
  if (!val || val === currentSymbol) return;
  currentSymbol = val;
  Settings.setLastSymbol(val);
  loadMarketData(currentSymbol, currentTF, currentMarket);
};

// ── INITIALIZATION ────────────────────────────────────────────────
function init() {
  ui = new UI();
  window.ui = ui;

  // 1. Wire event listeners immediately and synchronously (non-blocking)
  wireEventListeners();

  // 2. Set initial theme
  const initialTheme = Settings.getTheme() || 'dark';
  document.documentElement.setAttribute('data-theme', initialTheme);
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.textContent = initialTheme === 'dark' ? '☀' : '☾';

  // 3. Populate dropdowns
  populateSymbolDropdown(currentMarket);
  setDropdownValue('sym-select', currentSymbol);

  // 4. Initialize Chart
  chartManager = new ChartManager('main-chart', 'vol-chart');
  chartManager.init(initialTheme);
  window.chartManager = chartManager;

  // 5. Initialize Signal Engine
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

  // 6. Initialize Data Feed
  dataFeed = new DataFeed();

  dataFeed.on('history', (candles) => {
    chartManager.clearMarkers();
    chartManager.clearProjectionZones();
    chartManager.clearSLTPLines();

    chartManager.setHistory(candles);
    signalEngine.start(currentSymbol, currentTF, currentMarket);
    ui.setStatus({ text: `Live: ${currentSymbol} (${currentTF})`, type: 'ok', source: currentMarket });

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

  // 7. Non-blocking permission request (does not block initialization)
  Notifications.requestPermission().catch(() => {});

  // 8. Load initial symbol data
  loadMarketData(currentSymbol, currentTF, currentMarket);
}

async function loadMarketData(symbol, tf, market) {
  signalEngine?.stop();
  chartManager?.clearMarkers();
  chartManager?.clearProjectionZones();
  chartManager?.clearSLTPLines();

  ui.setStatus({ text: `Subscribing to ${symbol} (${tf})…`, type: 'info', source: market });

  try {
    await dataFeed.subscribe(symbol, tf, market);
  } catch (err) {
    ui.toast(`Feed error: ${err.message}`, 'danger');
  }
}

function wireEventListeners() {
  // Theme Toggle Button
  document.getElementById('theme-btn')?.addEventListener('click', () => {
    window.toggleTheme();
  });

  // Symbol Dropdown
  document.getElementById('sym-select')?.addEventListener('change', (e) => {
    window.onSymbolSelect(e.target.value);
  });

  // Market Switcher (Crypto vs Forex & Gold)
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

  // Mobile Bottom Navigation Tabs (Phones)
  document.querySelectorAll('#mobile-bottom-nav .mob-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      document.querySelectorAll('#mobile-bottom-nav .mob-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Mobile Scroll Spy for Bottom Navigation
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          document.querySelectorAll('#mobile-bottom-nav .mob-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.target === id);
          });
        }
      });
    }, { threshold: 0.3 });

    ['chart-area', 'main-signal-card', 'scorecard-section'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) sectionObserver.observe(el);
    });
  }

  // Handle window resize and mobile orientation changes
  window.addEventListener('resize', () => {
    if (chartManager) chartManager.resize();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (chartManager) chartManager.resize();
    }, 200);
  });
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
