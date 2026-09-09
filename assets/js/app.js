/**
 * app.js — Application bootstrap
 *
 * Entry point. Wires DataFeed → SignalEngine → UI → ChartManager.
 * Handles: symbol/TF selection, market switching, tab switching,
 *          theme toggle, settings, notification permission.
 */

import { DataFeed }      from './dataFeed.js';
import { ChartManager }  from './chart.js';
import { SignalEngine }  from './signalEngine.js';
import { UI }            from './ui.js';
import { Settings }      from './settings.js';
import { Notifications } from './notifications.js';

// ─── Symbol lists ────────────────────────────────────────────────
const CRYPTO_SYMBOLS = [
  { value: 'BTCUSDT',  label: 'BTC/USDT' },
  { value: 'ETHUSDT',  label: 'ETH/USDT' },
  { value: 'BNBUSDT',  label: 'BNB/USDT' },
  { value: 'SOLUSDT',  label: 'SOL/USDT' },
  { value: 'XRPUSDT',  label: 'XRP/USDT' },
  { value: 'ADAUSDT',  label: 'ADA/USDT' },
  { value: 'DOGEUSDT', label: 'DOGE/USDT' },
  { value: 'AVAXUSDT', label: 'AVAX/USDT' },
  { value: 'MATICUSDT',label: 'MATIC/USDT' },
  { value: 'LINKUSDT', label: 'LINK/USDT' },
];

const FOREX_SYMBOLS = [
  { value: 'EURUSD', label: 'EUR/USD' },
  { value: 'GBPUSD', label: 'GBP/USD' },
  { value: 'USDJPY', label: 'USD/JPY' },
  { value: 'AUDUSD', label: 'AUD/USD' },
  { value: 'USDCAD', label: 'USD/CAD' },
  { value: 'USDCHF', label: 'USD/CHF' },
  { value: 'NZDUSD', label: 'NZD/USD' },
  { value: 'XAUUSD', label: 'XAU/USD (Gold)' },
  { value: 'GBPJPY', label: 'GBP/JPY' },
  { value: 'EURJPY', label: 'EUR/JPY' },
];

const TIMEFRAMES = [
  { value: '1',   label: '1m' },
  { value: '3',   label: '3m' },
  { value: '5',   label: '5m' },
  { value: '15',  label: '15m' },
  { value: '30',  label: '30m' },
  { value: '60',  label: '1H' },
  { value: '120', label: '2H' },
  { value: '240', label: '4H' },
  { value: '720', label: '12H' },
  { value: '1D',  label: '1D' },
  { value: '1W',  label: '1W' },
];

// ─── App State ───────────────────────────────────────────────────
let dataFeed;
let chartManager;
let signalEngine;
let ui;

let currentSymbol    = Settings.getLastSymbol();
let currentTF        = Settings.getLastTF();
let currentMarket    = Settings.getLastMarket();
let activeChartTab   = 'main'; // 'main' | 'tv'
let isLoading        = false;

// ─── Initialize ──────────────────────────────────────────────────
async function init() {
  const theme = Settings.getTheme();

  // Init UI manager
  ui = new UI();
  ui.applyTheme(theme);

  // Populate symbol and TF dropdowns
  populateSymbolDropdown(currentMarket);
  populateTFDropdown();

  // Restore last selections
  setDropdownValue('symbol-select', currentSymbol);
  setDropdownValue('tf-select', currentTF);
  setMarketToggle(currentMarket);

  // Init Chart
  chartManager = new ChartManager('main-chart', 'vol-chart');
  chartManager.init(theme);

  // Init Signal Engine
  signalEngine = new SignalEngine(chartManager, (signal) => {
    ui.addSignal(signal);
    ui.toast(
      `${signal.type} signal on ${signal.symbol} — ${signal.confidence}% confidence`,
      signal.type === 'BUY' ? 'success' : 'danger',
      5000,
    );
  });

  // Init DataFeed
  dataFeed = new DataFeed();

  dataFeed.on('history', (candles) => {
    chartManager.setHistory(candles);
    signalEngine.start(currentSymbol, currentTF, currentMarket);
    ui.setStatus({ text: `Loaded ${candles.length} candles`, type: 'info' });

    // Run initial analysis
    runAnalysis(candles);
  });

  dataFeed.on('candle', async (candle) => {
    chartManager.updateCandle(candle);
    if (candle.isClosed !== false) { // closed or undefined = treat as closed
      await signalEngine.onNewCandle(dataFeed.candles);
    }
    // Update price ticker
    ui.updateTicker({
      symbol:    currentSymbol,
      price:     candle.close,
      change24h: null,
    });
  });

  dataFeed.on('status', ({ connected, source }) => {
    if (connected) {
      ui.setConnected(source);
    } else {
      ui.setDisconnected();
    }
  });

  dataFeed.on('error', (msg) => {
    ui.setStatus({ text: msg, type: 'warn' });
    ui.toast(msg, 'warning', 6000);
  });

  // Request notification permission
  await Notifications.requestPermission();

  // Wire UI event listeners
  wireEvents();

  // Start data feed
  await loadSymbol(currentSymbol, currentTF, currentMarket);
}

// ─── Load symbol ─────────────────────────────────────────────────
async function loadSymbol(symbol, tf, market) {
  if (isLoading) return;
  isLoading = true;

  ui.clearSignals();
  chartManager.clearMarkers();
  chartManager.clearSLTPLines();
  signalEngine.stop();
  ui.setStatus({ text: `Loading ${symbol} ${tf}…`, type: 'info' });

  // Update TV widget if that tab is visible
  updateTVWidget(symbol, tf, market);

  try {
    await dataFeed.subscribe(symbol, tf, market);
  } finally {
    isLoading = false;
  }
}

async function runAnalysis(candles) {
  ui.setAnalyzing();
  const result = await signalEngine.analyzeNow(candles);
  if (result) {
    ui.showAnalysisPanel(result);
    ui.setStatus({
      text:   `Analysis complete — ${result.signal} (${result.confidence}%)`,
      type:   result.signal === 'NEUTRAL' ? 'info' : 'ok',
      source: 'SMC Engine',
    });
  }
}

// ─── Event Wiring ────────────────────────────────────────────────
function wireEvents() {
  // Symbol select
  document.getElementById('symbol-select')?.addEventListener('change', e => {
    currentSymbol = e.target.value;
    Settings.setLastSymbol(currentSymbol);
    loadSymbol(currentSymbol, currentTF, currentMarket);
  });

  // Custom symbol input
  document.getElementById('symbol-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim().toUpperCase();
      if (val.length >= 3) {
        currentSymbol = val;
        Settings.setLastSymbol(val);
        loadSymbol(val, currentTF, currentMarket);
      }
    }
  });

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTF = btn.dataset.tf;
      Settings.setLastTF(currentTF);
      loadSymbol(currentSymbol, currentTF, currentMarket);
    });
  });

  // TF select dropdown (mobile fallback)
  document.getElementById('tf-select')?.addEventListener('change', e => {
    currentTF = e.target.value;
    Settings.setLastTF(currentTF);
    loadSymbol(currentSymbol, currentTF, currentMarket);
  });

  // Market toggle
  document.querySelectorAll('.market-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMarket = btn.dataset.market;
      Settings.setLastMarket(currentMarket);
      setMarketToggle(currentMarket);
      populateSymbolDropdown(currentMarket);
      const defaultSymbol = currentMarket === 'CRYPTO' ? 'BTCUSDT' : 'EURUSD';
      currentSymbol = defaultSymbol;
      Settings.setLastSymbol(defaultSymbol);
      setDropdownValue('symbol-select', defaultSymbol);
      loadSymbol(currentSymbol, currentTF, currentMarket);
    });
  });

  // Chart tab switching
  document.getElementById('tab-main')?.addEventListener('click', () => switchTab('main'));
  document.getElementById('tab-tv')?.addEventListener('click',   () => switchTab('tv'));

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const newTheme = Settings.getTheme() === 'dark' ? 'light' : 'dark';
    Settings.setTheme(newTheme);
    ui.applyTheme(newTheme);
    chartManager.setTheme(newTheme);
  });

  // Settings modal
  document.getElementById('settings-btn')?.addEventListener('click',  () => ui.openSettings());
  document.getElementById('settings-close')?.addEventListener('click', () => ui.closeSettings());
  document.getElementById('settings-save')?.addEventListener('click',  () => {
    ui.saveSettings();
    signalEngine.reloadConfig();
  });

  // Close modal on backdrop click
  document.getElementById('settings-modal')?.addEventListener('click', e => {
    if (e.target.id === 'settings-modal') ui.closeSettings();
  });

  // Analyze Now button
  document.getElementById('analyze-btn')?.addEventListener('click', () => {
    const candles = dataFeed.candles;
    if (candles.length > 0) runAnalysis(candles);
    else ui.toast('No data loaded yet', 'warning');
  });

  // Notification permission button
  document.getElementById('notif-btn')?.addEventListener('click', async () => {
    const perm = await Notifications.requestPermission();
    if (perm === 'granted') ui.toast('Notifications enabled ✓', 'success');
    else ui.toast('Notifications blocked in browser settings', 'warning');
  });

  // HTF bias selector
  document.getElementById('htf-bias')?.addEventListener('change', e => {
    signalEngine.setHTFTrend(e.target.value);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ui.closeSettings();
  });
}

// ─── TradingView Widget ──────────────────────────────────────────
function updateTVWidget(symbol, tf, market) {
  const container = document.getElementById('tv-widget');
  if (!container) return;

  // Convert symbol to TradingView format
  let tvSymbol;
  if (market === 'CRYPTO') {
    tvSymbol = `BINANCE:${symbol}`;
  } else {
    tvSymbol = `FX:${symbol}`;
  }

  // Convert TF to TV interval
  const tvInterval = tf === '1D' ? 'D' : tf === '1W' ? 'W' : tf;
  const tvTheme    = Settings.getTheme();

  // Clear and re-create widget
  container.innerHTML = '';
  const script = document.createElement('script');
  script.src   = 'https://s3.tradingview.com/tv.js';
  script.async = true;
  script.onload = () => {
    /* global TradingView */
    if (typeof TradingView !== 'undefined') {
      new TradingView.widget({
        autosize:           true,
        symbol:             tvSymbol,
        interval:           tvInterval,
        timezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
        theme:              tvTheme,
        style:              '1',
        locale:             'en',
        toolbar_bg:         tvTheme === 'dark' ? '#0f1117' : '#ffffff',
        enable_publishing:  false,
        hide_top_toolbar:   false,
        hide_legend:        false,
        save_image:         false,
        container_id:       'tv-inner',
        allow_symbol_change: true,
        studies: [
          'RSI@tv-basicstudies',
          'MACD@tv-basicstudies',
        ],
        withdateranges:     true,
      });
    }
  };

  const inner = document.createElement('div');
  inner.id    = 'tv-inner';
  inner.style.cssText = 'width:100%;height:100%';
  container.appendChild(inner);
  container.appendChild(script);
}

// ─── Tab Switching ───────────────────────────────────────────────
function switchTab(tab) {
  activeChartTab = tab;
  const mainArea = document.getElementById('chart-area-main');
  const tvArea   = document.getElementById('chart-area-tv');
  const tabMain  = document.getElementById('tab-main');
  const tabTv    = document.getElementById('tab-tv');

  if (tab === 'main') {
    mainArea?.style.setProperty('display', 'flex');
    tvArea?.style.setProperty('display', 'none');
    tabMain?.classList.add('active');
    tabTv?.classList.remove('active');
  } else {
    mainArea?.style.setProperty('display', 'none');
    tvArea?.style.setProperty('display', 'block');
    tabTv?.classList.add('active');
    tabMain?.classList.remove('active');
    updateTVWidget(currentSymbol, currentTF, currentMarket);
  }
}

// ─── UI Helpers ──────────────────────────────────────────────────
function populateSymbolDropdown(market) {
  const select  = document.getElementById('symbol-select');
  if (!select) return;
  const symbols = market === 'CRYPTO' ? CRYPTO_SYMBOLS : FOREX_SYMBOLS;
  select.innerHTML = symbols.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
}

function populateTFDropdown() {
  const select = document.getElementById('tf-select');
  if (!select) return;
  select.innerHTML = TIMEFRAMES.map(tf => `<option value="${tf.value}">${tf.label}</option>`).join('');
}

function setDropdownValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setMarketToggle(market) {
  document.querySelectorAll('.market-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.market === market);
  });
}

// ─── Boot ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
