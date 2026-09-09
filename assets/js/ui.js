/**
 * ui.js — TradersZone.ai UI Controller
 *
 * Controls:
 *  - Main Signal & 1–2 Sentence AI Explanation Card
 *  - Top Hero Verdict Bar with exact levels
 *  - Dynamic Light & Dark Theme Switching
 *  - Live Graded Calls Scorecard
 *  - Settings Modal, Real-time Ticker, Toasts
 */

import { Settings } from './settings.js';

export class UI {
  constructor() {
    this._toastEl = document.getElementById('toast');
    this._toastTimer = null;
  }

  // ─── HERO VERDICT BAR ───────────────────────────────────────────
  renderHeroVerdict(verdictData) {
    const { verdict, levels, aiReason, currentPrice } = verdictData;

    // 1. Verdict Badge
    const pill = document.getElementById('hero-verdict-pill');
    const pillText = document.getElementById('hero-verdict-text');
    const heroSentence = document.getElementById('hero-sentence-text');

    if (pill && pillText) {
      pill.className = `verdict-badge ${verdict.toLowerCase()}`;
      const icon = verdict === 'BUY' ? '▲' : verdict === 'SELL' ? '▼' : '⏸';
      pill.firstElementChild.textContent = icon;
      pillText.textContent = verdict;
    }

    if (heroSentence) {
      heroSentence.textContent = aiReason;
    }

    // 2. Exact Levels
    const entryEl = document.getElementById('hl-entry');
    const targetEl = document.getElementById('hl-target');
    const stopEl = document.getElementById('hl-stop');
    const rrEl = document.getElementById('hl-rr');

    if (entryEl) entryEl.textContent = this._fmt(levels.entry || currentPrice);
    if (targetEl) {
      targetEl.textContent = levels.target ? `${this._fmt(levels.target)} (+${levels.targetPct}%)` : '—';
    }
    if (stopEl) {
      stopEl.textContent = levels.stop ? `${this._fmt(levels.stop)} (${levels.stopPct}%)` : '—';
    }
    if (rrEl) {
      rrEl.textContent = levels.riskReward ? `1:${levels.riskReward}` : '—';
    }
  }

  // ─── MAIN SIGNAL & AI REASON CARD (SIDEBAR) ─────────────────────
  renderMainSignalCard(verdictData) {
    const { verdict, confidence, aiReason, levels, currentPrice } = verdictData;

    const card = document.getElementById('main-signal-card');
    const titleEl = document.getElementById('msc-title');
    const confEl = document.getElementById('msc-confidence');
    const aiTextEl = document.getElementById('msc-ai-reason');

    const lvlEntry = document.getElementById('lvl-entry');
    const lvlTarget = document.getElementById('lvl-target');
    const lvlStop = document.getElementById('lvl-stop');
    const lvlRR = document.getElementById('lvl-rr');

    if (card) {
      card.className = `main-signal-card ${verdict.toLowerCase()}`;
    }

    if (titleEl) {
      const label = verdict === 'BUY' ? '▲ BUY SIGNAL' : verdict === 'SELL' ? '▼ SELL SIGNAL' : '⏸ WAIT — STAND ASIDE';
      titleEl.textContent = label;
      titleEl.className = `msc-verdict-title ${verdict.toLowerCase()}`;
    }

    if (confEl) {
      confEl.textContent = `${confidence}% Confidence`;
    }

    if (aiTextEl) {
      aiTextEl.textContent = aiReason;
    }

    // Key Levels
    if (lvlEntry) lvlEntry.textContent = this._fmt(levels.entry || currentPrice);
    if (lvlTarget) lvlTarget.textContent = levels.target ? `${this._fmt(levels.target)} (+${levels.targetPct}%)` : '—';
    if (lvlStop) lvlStop.textContent = levels.stop ? `${this._fmt(levels.stop)} (${levels.stopPct}%)` : '—';
    if (lvlRR) lvlRR.textContent = levels.riskReward ? `1:${levels.riskReward}` : '—';
  }

  // ─── GRADED CALLS SCORECARD ─────────────────────────────────────
  renderGradedScorecard(scorecard) {
    const wrEl = document.getElementById('sc-winrate');
    const winEl = document.getElementById('sc-targets');
    const lossEl = document.getElementById('sc-stops');
    const openEl = document.getElementById('sc-open');
    const streamEl = document.getElementById('graded-stream');

    if (wrEl) wrEl.textContent = `${scorecard.winRate}%`;
    if (winEl) winEl.textContent = scorecard.targetHits;
    if (lossEl) lossEl.textContent = scorecard.stopHits;
    if (openEl) openEl.textContent = scorecard.openCalls;

    if (!streamEl) return;
    streamEl.innerHTML = '';

    if (scorecard.recentCalls.length === 0) {
      streamEl.innerHTML = `
        <div style="text-align:center;padding:18px;color:var(--text-3);font-size:11px;">
          No signals triggered yet.<br>
          <span style="font-size:10px;">Actionable calls are graded automatically against live ticks.</span>
        </div>`;
      return;
    }

    scorecard.recentCalls.slice(0, 10).forEach(call => {
      const card = document.createElement('div');
      const isWin = call.status === 'TARGET_HIT';
      const isLoss = call.status === 'STOP_HIT';
      const statusClass = isWin ? 'pos' : isLoss ? 'neg' : 'neu';
      const statusLabel = isWin ? 'Target Hit ✓' : isLoss ? 'Stop Hit ✕' : 'Active ⏳';

      card.style.cssText = `background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--${statusClass});border-radius:6px;padding:8px;font-size:11px;display:flex;flex-direction:column;gap:3px;`;
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-weight:700;font-family:var(--mono);">
          <span>${call.symbol} · ${call.verdict}</span>
          <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--${statusClass}-dim);color:var(--${statusClass});">${statusLabel}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--text-2);font-family:var(--mono);font-size:10px;">
          <span>Entry: ${this._fmt(call.entry)}</span>
          <span>TP: ${this._fmt(call.target)}</span>
          <span>SL: ${this._fmt(call.stop)}</span>
        </div>
      `;
      streamEl.appendChild(card);
    });
  }

  // ─── DYNAMIC LIGHT & DARK THEME TOGGLE ───────────────────────────
  toggleTheme() {
    const current = Settings.getTheme() || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    Settings.setTheme(next);
    this.applyTheme(next);
    return next;
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
  }

  // ─── PRICE TICKER ───────────────────────────────────────────────
  updateTicker({ price, change24h }) {
    const priceEl = document.getElementById('ticker-price');
    const chgEl = document.getElementById('ticker-chg');

    if (priceEl) priceEl.textContent = this._fmt(price);
    if (chgEl && change24h !== null && change24h !== undefined) {
      const sign = change24h >= 0 ? '+' : '';
      chgEl.textContent = `${sign}${change24h.toFixed(2)}%`;
      chgEl.className = `ticker-chg ${change24h >= 0 ? 'pos' : 'neg'}`;
    }
  }

  // ─── STATUS BAR ─────────────────────────────────────────────────
  setStatus({ text, type = 'info', source = '' }) {
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    const srcTag = document.getElementById('feed-src-tag');

    if (statusText) statusText.textContent = text;
    if (statusDot) statusDot.className = `status-dot ${type}`;
    if (srcTag && source) srcTag.textContent = source;
  }

  // ─── TOAST NOTIFICATIONS ────────────────────────────────────────
  toast(message, type = 'info', durationMs = 3500) {
    if (!this._toastEl) return;
    clearTimeout(this._toastTimer);
    this._toastEl.textContent = message;
    this._toastEl.className = `toast show ${type}`;
    this._toastTimer = setTimeout(() => {
      this._toastEl.classList.remove('show');
    }, durationMs);
  }

  // ─── SETTINGS MODAL ─────────────────────────────────────────────
  openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    document.getElementById('cfg-gemini-key').value = Settings.getGeminiKey();
    document.getElementById('cfg-gemini-enabled').checked = Settings.getAIEnabled();
    document.getElementById('cfg-av-key').value = Settings.getAVKey();
    document.getElementById('cfg-td-key').value = Settings.getTDKey();
    modal.classList.add('open');
  }

  closeSettings() {
    document.getElementById('settings-modal')?.classList.remove('open');
  }

  saveSettings() {
    Settings.setGeminiKey(document.getElementById('cfg-gemini-key').value);
    Settings.setAIEnabled(document.getElementById('cfg-gemini-enabled').checked);
    Settings.setAVKey(document.getElementById('cfg-av-key').value);
    Settings.setTDKey(document.getElementById('cfg-td-key').value);
    this.closeSettings();
    this.toast('Settings saved ✓', 'success');
  }

  _fmt(price) {
    if (!price && price !== 0) return '—';
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }
}
