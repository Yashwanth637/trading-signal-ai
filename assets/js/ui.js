/**
 * ui.js — Dashboard UI rendering
 *
 * Handles:
 *  - Signal feed panel
 *  - AI reasoning panel
 *  - Status bar updates
 *  - Price ticker
 *  - Settings modal
 *  - Toast messages
 */

import { Settings }      from './settings.js';
import { Notifications } from './notifications.js';

export class UI {
  constructor() {
    this._signalList   = document.getElementById('signal-list');
    this._aiPanel      = document.getElementById('ai-panel');
    this._statusBar    = document.getElementById('status-bar');
    this._ticker       = document.getElementById('price-ticker');
    this._toastEl      = document.getElementById('toast');
    this._toastTimer   = null;
    this._signalCount  = 0;
  }

  // ─── Signal Feed ─────────────────────────────────────────────

  addSignal(signal) {
    if (!this._signalList) return;
    this._signalCount++;

    const card = document.createElement('div');
    card.className = `signal-card ${signal.type.toLowerCase()}`;
    card.dataset.id = signal.id;

    const priceFmt  = this._fmt(signal.price);
    const slFmt     = signal.stopLoss   ? this._fmt(signal.stopLoss)   : '—';
    const tpFmt     = signal.takeProfit ? this._fmt(signal.takeProfit) : '—';
    const rrFmt     = signal.riskReward ? `1:${signal.riskReward}`     : '—';
    const timeStr   = new Date(signal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const srcBadge  = signal.source === 'AI_CONFIRMED'
      ? '<span class="badge ai">AI+Logic</span>'
      : '<span class="badge logic">Logic</span>';
    const confClass = signal.confidence >= 75 ? 'high' : signal.confidence >= 50 ? 'mid' : 'low';

    card.innerHTML = `
      <div class="sc-header">
        <span class="sc-type ${signal.type.toLowerCase()}">${signal.type === 'BUY' ? '▲ BUY' : '▼ SELL'}</span>
        <span class="sc-symbol">${signal.symbol}</span>
        <span class="sc-tf">${this._tfLabel(signal.timeframe)}</span>
        ${srcBadge}
        <span class="sc-time">${timeStr}</span>
      </div>
      <div class="sc-body">
        <div class="sc-prices">
          <div class="sc-price-item"><span class="label">Entry</span><span class="value">${priceFmt}</span></div>
          <div class="sc-price-item"><span class="label">SL</span><span class="value sl">${slFmt}</span></div>
          <div class="sc-price-item"><span class="label">TP</span><span class="value tp">${tpFmt}</span></div>
          <div class="sc-price-item"><span class="label">R:R</span><span class="value">${rrFmt}</span></div>
        </div>
        <div class="sc-conf">
          <div class="conf-bar-wrap">
            <div class="conf-bar ${confClass}" style="width:${signal.confidence}%"></div>
          </div>
          <span class="conf-label">${signal.confidence}% Confidence</span>
        </div>
        <div class="sc-reasons">${(signal.reasons || []).slice(0, 3).map(r => `<span class="reason-tag">✓ ${r}</span>`).join('')}</div>
        ${signal.reasoning ? `
        <details class="sc-ai-detail">
          <summary>AI Reasoning</summary>
          <p class="ai-text">${signal.reasoning}</p>
          ${signal.warnings ? `<p class="ai-warn">⚠ ${signal.warnings}</p>` : ''}
        </details>` : ''}
      </div>
    `;

    // Click to show SL/TP on chart
    card.addEventListener('click', () => {
      document.querySelectorAll('.signal-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });

    // Prepend (newest first)
    this._signalList.insertBefore(card, this._signalList.firstChild);

    // Keep max 20 cards
    while (this._signalList.children.length > 20) {
      this._signalList.removeChild(this._signalList.lastChild);
    }

    // Update counter
    const counter = document.getElementById('signal-count');
    if (counter) counter.textContent = this._signalCount;
  }

  clearSignals() {
    if (this._signalList) this._signalList.innerHTML = '';
    this._signalCount = 0;
    const counter = document.getElementById('signal-count');
    if (counter) counter.textContent = '0';
  }

  // ─── Price Ticker ────────────────────────────────────────────

  updateTicker({ symbol, price, change24h }) {
    if (!this._ticker) return;
    const sign    = change24h >= 0 ? '+' : '';
    const cls     = change24h >= 0 ? 'up' : 'down';
    this._ticker.innerHTML = `
      <span class="tick-symbol">${symbol}</span>
      <span class="tick-price">${this._fmt(price)}</span>
      <span class="tick-change ${cls}">${sign}${change24h?.toFixed(2)}%</span>
    `;
  }

  // ─── Status Bar ──────────────────────────────────────────────

  setStatus({ text, type = 'info', source = '' }) {
    if (!this._statusBar) return;
    const cls = { info: '●', ok: '●', warn: '●', error: '●' };
    const dot = `<span class="status-dot ${type}"></span>`;
    this._statusBar.innerHTML = `${dot} ${text}${source ? ` <span class="source-tag">${source}</span>` : ''}`;
  }

  setConnected(source) {
    this.setStatus({ text: 'Live feed connected', type: 'ok', source });
  }

  setDisconnected() {
    this.setStatus({ text: 'Reconnecting…', type: 'warn' });
  }

  setAnalyzing() {
    this.setStatus({ text: 'Analyzing market structure…', type: 'info' });
  }

  // ─── Toast Notifications ─────────────────────────────────────

  toast(message, type = 'info', durationMs = 3500) {
    if (!this._toastEl) return;
    clearTimeout(this._toastTimer);
    this._toastEl.textContent = message;
    this._toastEl.className   = `toast show ${type}`;
    this._toastTimer = setTimeout(() => {
      this._toastEl.classList.remove('show');
    }, durationMs);
  }

  // ─── Settings Modal ──────────────────────────────────────────

  openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // Populate fields from Settings
    document.getElementById('input-gemini-key').value = Settings.getGeminiKey();
    document.getElementById('input-av-key').value     = Settings.getAVKey();
    document.getElementById('input-td-key').value     = Settings.getTDKey();
    document.getElementById('toggle-ai').checked      = Settings.getAIEnabled();
    document.getElementById('toggle-notif').checked   = Settings.getNotifications();
    document.getElementById('toggle-audio').checked   = Settings.getAudioAlerts();
    document.getElementById('input-threshold').value  = Settings.getSMCThreshold();
    document.getElementById('input-lookback').value   = Settings.getSwingLookback();

    modal.classList.add('open');
  }

  closeSettings() {
    document.getElementById('settings-modal')?.classList.remove('open');
  }

  saveSettings() {
    Settings.setGeminiKey(document.getElementById('input-gemini-key').value);
    Settings.setAVKey(document.getElementById('input-av-key').value);
    Settings.setTDKey(document.getElementById('input-td-key').value);
    Settings.setAIEnabled(document.getElementById('toggle-ai').checked);
    Settings.setNotifications(document.getElementById('toggle-notif').checked);
    Settings.setAudioAlerts(document.getElementById('toggle-audio').checked);
    Settings.setSMCThreshold(parseInt(document.getElementById('input-threshold').value) || 5);
    Settings.setSwingLookback(parseInt(document.getElementById('input-lookback').value) || 5);
    this.closeSettings();
    this.toast('Settings saved ✓', 'success');
  }

  // ─── Theme Toggle ─────────────────────────────────────────────

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
  }

  // ─── SMC Analysis Result Panel ────────────────────────────────

  showAnalysisPanel(smcResult) {
    const panel = document.getElementById('analysis-panel');
    if (!panel) return;

    const {
      signal, confidence, trend, bosSignal, atr,
      orderBlocks, fvgs, srZones, sweeps, reasons,
      bullScore, bearScore,
    } = smcResult;

    panel.innerHTML = `
      <div class="ap-header">
        <span class="ap-signal ${(signal||'neutral').toLowerCase()}">${signal || 'NEUTRAL'}</span>
        <span class="ap-trend">LTF: ${trend}</span>
        <span class="ap-bos">${bosSignal || '—'}</span>
      </div>
      <div class="ap-scores">
        <div class="score bull">▲ Bull: ${bullScore}</div>
        <div class="score bear">▼ Bear: ${bearScore}</div>
        <div class="score">ATR: ${atr?.toFixed(5) || '—'}</div>
      </div>
      <div class="ap-details">
        <div class="ap-row"><b>Order Blocks:</b> ${orderBlocks.length > 0 ? orderBlocks.map(o => `<span class="tag ${o.type.toLowerCase()}">${o.type}</span>`).join(' ') : '—'}</div>
        <div class="ap-row"><b>FVGs:</b> ${fvgs.length > 0 ? fvgs.map(f => `<span class="tag ${f.type.toLowerCase()}">${f.type}</span>`).join(' ') : '—'}</div>
        <div class="ap-row"><b>Sweeps:</b> ${sweeps.length > 0 ? sweeps.map(s => `<span class="tag sweep">${s.type}</span>`).join(' ') : '—'}</div>
        <div class="ap-row"><b>S/R Zones:</b> ${srZones.length}</div>
        <div class="ap-row"><b>Confluence:</b> ${reasons.slice(0,4).map(r => `<div class="reason-item">✓ ${r}</div>`).join('')}</div>
      </div>
    `;
    panel.style.display = 'block';
  }

  // ─── Helpers ─────────────────────────────────────────────────

  _fmt(price) {
    if (!price && price !== 0) return '—';
    if (price >= 10000)  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 100)    return price.toFixed(2);
    if (price >= 1)      return price.toFixed(4);
    return price.toFixed(6);
  }

  _tfLabel(tf) {
    const map = {
      '1':'1m','3':'3m','5':'5m','15':'15m','30':'30m',
      '60':'1H','120':'2H','240':'4H','720':'12H','D':'1D','1D':'1D','W':'1W','1W':'1W',
    };
    return map[tf] || tf;
  }
}
