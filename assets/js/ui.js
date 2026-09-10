/**
 * ui.js — TradersZone.ai UI Controller
 *
 * Controls:
 *  - Confluence Checklist (8 criteria with live ✓/✗)
 *  - MTF Alignment Matrix widget
 *  - Risk & Position Calculator
 *  - Main Signal Card + 1-2 Sentence AI Reason
 *  - Hero Verdict Bar with exact levels
 *  - Graded Calls Scorecard + Signal Journal (richer cards)
 *  - Settings Modal, Theme, Ticker, Toasts
 */

import { Settings } from './settings.js';
import { RiskCalculator } from './riskCalculator.js';

export class UI {
  constructor() {
    this._toastEl   = document.getElementById('toast');
    this._toastTimer = null;
    this._lastVerdict = null;
  }

  // ─── HERO VERDICT BAR ───────────────────────────────────────────
  renderHeroVerdict(verdictData) {
    const { verdict, levels, aiReason, currentPrice } = verdictData;

    const pill     = document.getElementById('hero-verdict-pill');
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

    const entryEl  = document.getElementById('hl-entry');
    const targetEl = document.getElementById('hl-target');
    const stopEl   = document.getElementById('hl-stop');
    const rrEl     = document.getElementById('hl-rr');

    if (entryEl)  entryEl.textContent  = this._fmt(levels.entry || currentPrice);
    if (targetEl) targetEl.textContent = levels.target ? `${this._fmt(levels.target)} (+${levels.targetPct}%)` : '—';
    if (stopEl)   stopEl.textContent   = levels.stop   ? `${this._fmt(levels.stop)} (${levels.stopPct}%)`   : '—';
    if (rrEl)     rrEl.textContent     = levels.riskReward ? `1:${levels.riskReward}` : '—';

    // MTF Matrix update
    if (verdictData.mtfMatrix) {
      this.renderMTFMatrix(verdictData.mtfMatrix);
    }
  }

  // ─── MTF ALIGNMENT MATRIX ─────────────────────────────────────────
  renderMTFMatrix(matrix) {
    const container = document.getElementById('mtf-matrix');
    if (!container) return;
    container.innerHTML = '';

    const TFS = ['1M', '5M', '15M', '1H', '4H', '1D'];
    for (const tf of TFS) {
      const bias = matrix[tf] || 'NEUTRAL';
      const cls  = bias === 'BULLISH' ? 'mtf-bull' : bias === 'BEARISH' ? 'mtf-bear' : 'mtf-neu';
      const icon = bias === 'BULLISH' ? '▲' : bias === 'BEARISH' ? '▼' : '─';
      const cell = document.createElement('div');
      cell.className = `mtf-cell ${cls}`;
      cell.innerHTML = `<span class="mtf-tf">${tf}</span><span class="mtf-icon">${icon}</span>`;
      cell.title = `${tf}: ${bias}`;
      container.appendChild(cell);
    }
  }

  // ─── CONFLUENCE CHECKLIST ─────────────────────────────────────────
  renderConfluenceChecklist(confluence) {
    const container = document.getElementById('confluence-checklist');
    const scoreEl   = document.getElementById('confluence-score');
    if (!container || !confluence) return;

    if (scoreEl) {
      const convClass = confluence.conviction === 'Extreme' ? 'pos'
        : confluence.conviction === 'High' ? 'pos'
        : confluence.conviction === 'Moderate' ? 'warn'
        : 'neg';
      scoreEl.innerHTML = `<span class="conf-score-num ${convClass}">${confluence.score}</span> Met — <span class="${convClass}">${confluence.conviction} Conviction ${confluence.direction}</span>`;
    }

    container.innerHTML = '';
    for (const item of confluence.checklist) {
      const isM  = item.status === 'met';
      const isN  = item.status === 'neutral';
      const icon = isM ? '✓' : isN ? '◐' : '✗';
      const cls  = isM ? 'cf-met' : isN ? 'cf-neu' : 'cf-miss';

      const row = document.createElement('div');
      row.className = `cf-row ${cls}`;
      row.title = item.detail;
      row.innerHTML = `
        <span class="cf-icon">${icon}</span>
        <span class="cf-name">${item.name}</span>
        <span class="cf-detail">${item.detail}</span>
      `;
      container.appendChild(row);
    }
  }

  // ─── MAIN SIGNAL CARD (SIDEBAR) ──────────────────────────────────
  renderMainSignalCard(verdictData) {
    const { verdict, confidence, aiReason, levels, currentPrice, confluence } = verdictData;

    const card    = document.getElementById('main-signal-card');
    const titleEl = document.getElementById('msc-title');
    const confEl  = document.getElementById('msc-confidence');
    const aiTextEl = document.getElementById('msc-ai-reason');

    const lvlEntry  = document.getElementById('lvl-entry');
    const lvlTarget = document.getElementById('lvl-target');
    const lvlStop   = document.getElementById('lvl-stop');
    const lvlRR     = document.getElementById('lvl-rr');

    if (card)    card.className    = `main-signal-card ${verdict.toLowerCase()}`;
    if (titleEl) {
      const label = verdict === 'BUY' ? '▲ BUY SIGNAL' : verdict === 'SELL' ? '▼ SELL SIGNAL' : '⏸ WAIT — STAND ASIDE';
      titleEl.textContent = label;
      titleEl.className   = `msc-verdict-title ${verdict.toLowerCase()}`;
    }
    if (confEl)   confEl.textContent   = `${confidence}% Confidence`;
    if (aiTextEl) aiTextEl.textContent = aiReason;

    if (lvlEntry)  lvlEntry.textContent  = this._fmt(levels.entry || currentPrice);
    if (lvlTarget) lvlTarget.textContent = levels.target ? `${this._fmt(levels.target)} (+${levels.targetPct}%)` : '—';
    if (lvlStop)   lvlStop.textContent   = levels.stop   ? `${this._fmt(levels.stop)} (${levels.stopPct}%)`   : '—';
    if (lvlRR)     lvlRR.textContent     = levels.riskReward ? `1:${levels.riskReward}` : '—';

    // Render confluence checklist
    if (confluence) {
      this.renderConfluenceChecklist(confluence);
    }

    // Auto-update risk calculator if signal is BUY/SELL or preview in WAIT
    this._lastVerdict = verdictData;
    if ((verdict === 'BUY' || verdict === 'SELL') && levels.entry && levels.stop) {
      this.computeAndRenderRiskCalculator(levels.entry, levels.stop, verdict, levels.riskReward);
    } else if (currentPrice && currentPrice > 0) {
      const estStop = verdictData.horizonZones?.find(z => !z.isResistance && !z.isBreached)?.bottom || +(currentPrice * 0.985);
      this.computeAndRenderRiskCalculator(currentPrice, estStop, 'BUY', 2.0);
    }
  }

  // ─── RISK CALCULATOR ─────────────────────────────────────────────
  computeAndRenderRiskCalculator(entry, stop, direction, rr) {
    const balanceEl = document.getElementById('risk-balance');
    const pctEl     = document.getElementById('risk-pct');
    if (!balanceEl || !pctEl) return;

    const balance  = parseFloat(balanceEl.value) || Settings.getRiskBalance();
    const riskPct  = parseFloat(pctEl.value)     || Settings.getRiskPct();
    const symbol   = document.getElementById('sym-select')?.value || 'BTCUSDT';

    const result = RiskCalculator.calc({ balance, riskPct, entry, stop, symbol, direction });
    this.renderRiskCalculator(result);
  }

  renderRiskCalculator(result) {
    const el = (id) => document.getElementById(id);
    if (!el('risk-dollar')) return;

    el('risk-dollar').textContent   = `$${result.dollarRisk}`;
    el('risk-size').textContent     = result.positionLabel;
    el('risk-tp1').textContent      = result.tp1 ? this._fmt(result.tp1) : '—';
    el('risk-tp2').textContent      = result.tp2 ? this._fmt(result.tp2) : '—';
    el('risk-runner').textContent   = result.runner ? this._fmt(result.runner) : '—';
    el('risk-rr1').textContent      = result.rr1;
    el('risk-rr2').textContent      = result.rr2;
    el('risk-rr-run').textContent   = result.rrRunner;
    el('risk-be-note').textContent  = result.tp1 ? `💡 ${result.breakevenNote} (${this._fmt(result.tp1)})` : '';
    el('risk-pot1').textContent     = `+$${result.dollarPotential1}`;
    el('risk-pot2').textContent     = `+$${result.dollarPotential2}`;
  }

  // ─── GRADED CALLS SCORECARD ─────────────────────────────────────
  renderGradedScorecard(scorecard) {
    const wrEl     = document.getElementById('sc-winrate');
    const winEl    = document.getElementById('sc-targets');
    const lossEl   = document.getElementById('sc-stops');
    const openEl   = document.getElementById('sc-open');
    const netREl   = document.getElementById('sc-netr');
    const streamEl = document.getElementById('graded-stream');

    if (wrEl)   wrEl.textContent   = `${scorecard.winRate}%`;
    if (winEl)  winEl.textContent  = scorecard.targetHits;
    if (lossEl) lossEl.textContent = scorecard.stopHits;
    if (openEl) openEl.textContent = scorecard.openCalls;
    if (netREl) netREl.textContent = `${scorecard.netR > 0 ? '+' : ''}${scorecard.netR}R`;

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

    scorecard.recentCalls.slice(0, 12).forEach(call => {
      const isWin   = call.status === 'TARGET_HIT';
      const isLoss  = call.status === 'STOP_HIT';
      const isDemo  = call.id?.startsWith('demo_');
      const clrKey  = isWin ? 'pos' : isLoss ? 'neg' : 'warn';
      const lbl     = isWin ? '✓ Target Hit' : isLoss ? '✕ Stop Hit' : '⏳ Active';
      const rMult   = call.rMultiple || (isWin ? '+R' : isLoss ? '-1R' : '');

      // Time display
      const timeStr = call.entryTime
        ? new Date(call.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
      const exitStr = call.exitTime
        ? new Date(call.exitTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null;

      const card = document.createElement('div');
      card.className = 'graded-call-card';
      card.style.borderLeftColor = `var(--${clrKey})`;
      card.innerHTML = `
        <div class="gcc-header">
          <span class="gcc-pair">${call.symbol} <span style="font-size:9px;opacity:0.7;">${call.timeframe}</span></span>
          <span class="gcc-badge gcc-${clrKey}">${lbl}</span>
        </div>
        <div class="gcc-levels">
          <span>Entry: <b>${this._fmt(call.entry)}</b></span>
          <span>TP: <b class="tp">${call.target ? this._fmt(call.target) : '—'}</b></span>
          <span>SL: <b class="sl">${call.stop ? this._fmt(call.stop) : '—'}</b></span>
        </div>
        <div class="gcc-meta">
          <span class="gcc-dir ${call.verdict === 'BUY' ? 'pos' : 'neg'}">${call.verdict === 'BUY' ? '▲ BUY' : '▼ SELL'}</span>
          <span class="gcc-time">${timeStr}</span>
          ${rMult ? `<span class="gcc-rmult ${isWin ? 'pos' : 'neg'}">${rMult}</span>` : ''}
          ${isDemo ? `<span class="gcc-demo">Demo</span>` : ''}
        </div>
        ${exitStr ? `<div class="gcc-exit-time">Closed: ${exitStr}</div>` : ''}
      `;
      streamEl.appendChild(card);
    });
  }

  // ─── SETTINGS MODAL ─────────────────────────────────────────────
  openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    document.getElementById('cfg-gemini-key').value        = Settings.getGeminiKey();
    document.getElementById('cfg-gemini-enabled').checked  = Settings.getAIEnabled();
    document.getElementById('cfg-av-key').value            = Settings.getAVKey();
    document.getElementById('cfg-td-key').value            = Settings.getTDKey();
    document.getElementById('cfg-webhook-url').value       = Settings.getWebhookURL();
    document.getElementById('cfg-audio-alerts').checked    = Settings.getAudioAlerts();
    document.getElementById('cfg-notifications').checked   = Settings.getNotifications();
    const riskBalInput = document.getElementById('cfg-risk-balance');
    const riskPctInput = document.getElementById('cfg-risk-pct');
    if (riskBalInput) riskBalInput.value = Settings.getRiskBalance();
    if (riskPctInput) riskPctInput.value = Settings.getRiskPct();
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
    Settings.setWebhookURL(document.getElementById('cfg-webhook-url').value);
    Settings.setAudioAlerts(document.getElementById('cfg-audio-alerts').checked);
    Settings.setNotifications(document.getElementById('cfg-notifications').checked);

    // Save risk defaults
    const riskBal = parseFloat(document.getElementById('cfg-risk-balance')?.value);
    const riskPct = parseFloat(document.getElementById('cfg-risk-pct')?.value);
    if (!isNaN(riskBal) && riskBal > 0) {
      Settings.setRiskBalance(riskBal);
      const mainBal = document.getElementById('risk-balance');
      if (mainBal) mainBal.value = riskBal;
    }
    if (!isNaN(riskPct) && riskPct > 0) {
      Settings.setRiskPct(riskPct);
      const mainPct = document.getElementById('risk-pct');
      if (mainPct) mainPct.value = riskPct;
    }

    this.closeSettings();
    this.toast('Settings saved ✓', 'success');
  }

  // ─── DYNAMIC THEME TOGGLE ────────────────────────────────────────
  toggleTheme() {
    const current = Settings.getTheme() || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
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
    const chgEl   = document.getElementById('ticker-chg');

    if (priceEl) priceEl.textContent = this._fmt(price);
    if (chgEl && change24h !== null && change24h !== undefined) {
      const sign = change24h >= 0 ? '+' : '';
      chgEl.textContent = `${sign}${change24h.toFixed(2)}%`;
      chgEl.className   = `ticker-chg ${change24h >= 0 ? 'pos' : 'neg'}`;
    }
  }

  // ─── STATUS BAR ─────────────────────────────────────────────────
  setStatus({ text, type = 'info', source = '' }) {
    const statusText = document.getElementById('status-text');
    const statusDot  = document.getElementById('status-dot');
    const srcTag     = document.getElementById('feed-src-tag');

    if (statusText) statusText.textContent = text;
    if (statusDot)  statusDot.className    = `status-dot ${type}`;
    if (srcTag && source) srcTag.textContent = source;
  }

  // ─── TOAST NOTIFICATIONS ────────────────────────────────────────
  toast(message, type = 'info', durationMs = 3500) {
    if (!this._toastEl) return;
    clearTimeout(this._toastTimer);
    this._toastEl.textContent = message;
    this._toastEl.className   = `toast show ${type}`;
    this._toastTimer = setTimeout(() => {
      this._toastEl.classList.remove('show');
    }, durationMs);
  }

  _fmt(price) {
    if (!price && price !== 0) return '—';
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1)    return price.toFixed(4);
    return price.toFixed(6);
  }
}
