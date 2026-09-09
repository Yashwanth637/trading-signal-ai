/**
 * ui.js — Deeepr.ai Dashboard UI Manager
 *
 * Controls:
 *  - Hero Verdict Bar (LONG / SHORT / WAIT, 4-lane agreement, exact levels)
 *  - 4-Lane Analysis Cards ([T] Tech, [F] Flow, [N] News, [M] Macro)
 *  - Graded Calls Tracker Scorecard & Real-time Stream
 *  - Plain-English Strategy Builder View & Backtest Output
 *  - Settings Modal, Ticker, Toasts
 */

import { Settings } from './settings.js';

export class UI {
  constructor() {
    this._toastEl = document.getElementById('toast');
    this._toastTimer = null;
  }

  // ─── HERO VERDICT & LEVELS BAR ──────────────────────────────────
  renderHeroVerdict(verdictData) {
    const { verdict, agreementCount, levels, lanes, waitReason, currentPrice } = verdictData;

    // 1. Verdict Pill
    const pill = document.getElementById('hero-verdict-pill');
    const pillText = document.getElementById('hero-verdict-text');
    const pulseDot = document.getElementById('hero-pulse-dot');
    const agreeText = document.getElementById('hero-agreement-text');

    if (pill && pillText) {
      pill.className = `verdict-badge ${verdict.toLowerCase()}`;
      pillText.textContent = verdict;
      const icon = verdict === 'LONG' ? '↗' : verdict === 'SHORT' ? '↘' : '⏸';
      pill.firstElementChild.textContent = icon;
    }

    if (pulseDot && agreeText) {
      pulseDot.className = `pulse-dot ${verdict.toLowerCase()}`;
      if (verdict === 'WAIT') {
        agreeText.textContent = waitReason || 'Lanes in conflict — standing aside';
      } else {
        agreeText.textContent = `${agreementCount} of 4 lanes agree · Momentum holds`;
      }
    }

    // 2. 4-Lane Micro Badges in Hero Bar
    this._updateHeroTag('tag-tech', lanes.technical.bias !== 'NEUTRAL');
    this._updateHeroTag('tag-flow', lanes.flow.bias !== 'NEUTRAL');
    this._updateHeroTag('tag-news', lanes.news.bias !== 'NEUTRAL');
    this._updateHeroTag('tag-macro', lanes.macro.bias === 'FAVORABLE');

    // 3. Exact Levels
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

  _updateHeroTag(id, isLit) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('lit', isLit);
    }
  }

  // ─── 4-LANE SIDEBAR BREAKDOWN ───────────────────────────────────
  renderLaneBreakdown(verdictData) {
    const { lanes, verdict, waitReason } = verdictData;

    // Technical Lane
    const tStat = document.getElementById('lc-tech-status');
    const tRead = document.getElementById('lc-tech-read');
    if (tStat && tRead) {
      const cls = lanes.technical.bias === 'BULLISH' ? 'pos' : lanes.technical.bias === 'BEARISH' ? 'neg' : 'neu';
      tStat.className = `status-chip ${cls}`;
      tStat.textContent = lanes.technical.bias;
      tRead.textContent = lanes.technical.summary;
    }

    // Flow Lane
    const fStat = document.getElementById('lc-flow-status');
    const fRead = document.getElementById('lc-flow-read');
    if (fStat && fRead) {
      const cls = lanes.flow.bias === 'INFLOW' ? 'pos' : lanes.flow.bias === 'OUTFLOW' ? 'neg' : 'neu';
      fStat.className = `status-chip ${cls}`;
      fStat.textContent = lanes.flow.bias;
      fRead.textContent = `${lanes.flow.summary} (${lanes.flow.buyRatio || 50}% buy delta)`;
    }

    // News Lane
    const nStat = document.getElementById('lc-news-status');
    const nRead = document.getElementById('lc-news-read');
    if (nStat && nRead) {
      const cls = lanes.news.bias === 'POSITIVE' ? 'pos' : lanes.news.bias === 'NEGATIVE' ? 'neg' : 'neu';
      nStat.className = `status-chip ${cls}`;
      nStat.textContent = lanes.news.bias;
      nRead.textContent = `${lanes.news.summary} [${lanes.news.source}]`;
    }

    // Macro Lane
    const mStat = document.getElementById('lc-macro-status');
    const mRead = document.getElementById('lc-macro-read');
    if (mStat && mRead) {
      const cls = lanes.macro.bias === 'FAVORABLE' ? 'pos' : lanes.macro.bias === 'HIGH_RISK' ? 'neg' : 'cau';
      mStat.className = `status-chip ${cls}`;
      mStat.textContent = lanes.macro.bias;
      mRead.textContent = lanes.macro.summary;
    }

    // Summary description
    const desc = document.getElementById('lane-verdict-desc');
    if (desc) {
      if (verdict === 'WAIT') {
        desc.textContent = waitReason || 'Lanes disagree — waiting for clean 3-lane confluence.';
      } else {
        desc.textContent = `${verdict} confirmed: Structure, flow, and narrative agree on the ${verdict === 'LONG' ? 'long' : 'short'} side.`;
      }
    }
  }

  // ─── GRADED CALLS SCORECARD & STREAM ────────────────────────────
  renderGradedScorecard(scorecard) {
    const wrEl = document.getElementById('gc-winrate');
    const tgEl = document.getElementById('gc-targets');
    const spEl = document.getElementById('gc-stops');
    const opEl = document.getElementById('gc-open');
    const listEl = document.getElementById('graded-calls-list');

    if (wrEl) wrEl.textContent = `${scorecard.winRate}%`;
    if (tgEl) tgEl.textContent = scorecard.targetHits;
    if (spEl) spEl.textContent = scorecard.stopHits;
    if (opEl) opEl.textContent = scorecard.openCalls;

    if (!listEl) return;
    listEl.innerHTML = '';

    if (scorecard.recentCalls.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-3);font-size:11px;">
          No graded calls recorded yet.<br>
          <span style="font-size:10px;">Actionable calls are graded automatically against live candles.</span>
        </div>`;
      return;
    }

    scorecard.recentCalls.forEach(call => {
      const card = document.createElement('div');
      const gradeCls = call.status === 'TARGET_HIT' ? 'win' : call.status === 'STOP_HIT' ? 'loss' : 'open';
      const gradeText = call.status === 'TARGET_HIT' ? 'Target Hit ✓' : call.status === 'STOP_HIT' ? 'Stop Hit ✕' : 'Open ⏳';

      card.className = `graded-card ${gradeCls}`;
      card.innerHTML = `
        <div class="gc-head">
          <span class="gc-sym">${call.symbol} · ${call.verdict}</span>
          <span class="gc-grade ${gradeCls}">${gradeText}</span>
        </div>
        <div class="gc-grid">
          <div class="gc-cell"><span class="k">Entry</span><span class="v">${this._fmt(call.entry)}</span></div>
          <div class="gc-cell"><span class="k">Target</span><span class="v" style="color:var(--pos);">${this._fmt(call.target)}</span></div>
          <div class="gc-cell"><span class="k">Stop</span><span class="v" style="color:var(--neg);">${this._fmt(call.stop)}</span></div>
          <div class="gc-cell"><span class="k">R:R</span><span class="v">1:${call.riskReward}</span></div>
        </div>
        ${call.realizedPnlPct ? `
          <div style="font-size:10px;font-family:var(--mono);color:${call.realizedPnlPct > 0 ? 'var(--pos)' : 'var(--neg)'};margin-top:2px;">
            Realized Outcome: ${call.realizedPnlPct > 0 ? '+' : ''}${call.realizedPnlPct}%
          </div>` : ''}
      `;
      listEl.appendChild(card);
    });
  }

  // ─── STRATEGY BUILDER RENDERING ─────────────────────────────────
  renderStrategyResults(compiled, backtest) {
    const compiledBox = document.getElementById('strategy-compiled-box');
    const rulesList = document.getElementById('strategy-rules-list');
    const resultsBox = document.getElementById('strategy-backtest-results');

    if (compiledBox && rulesList) {
      compiledBox.style.display = 'flex';
      rulesList.innerHTML = compiled.conditions.map(c =>
        `<span style="padding:3px 8px;border-radius:4px;background:var(--card);border:1px solid var(--border);font-size:11px;font-family:var(--mono);color:var(--accent);">✓ ${c.label}</span>`
      ).join('') + `<span style="padding:3px 8px;border-radius:4px;background:var(--pos-dim);color:var(--pos);border:1px solid rgba(0,240,144,0.3);font-size:11px;font-family:var(--mono);">Target +${compiled.targetPct}%</span>`
      + `<span style="padding:3px 8px;border-radius:4px;background:var(--neg-dim);color:var(--neg);border:1px solid rgba(255,51,102,0.3);font-size:11px;font-family:var(--mono);">Stop -${compiled.stopPct}%</span>`;
    }

    if (resultsBox) {
      resultsBox.style.display = 'flex';
      document.getElementById('bt-winrate').textContent = `${backtest.winRate}%`;
      document.getElementById('bt-profitfactor').textContent = backtest.profitFactor;
      document.getElementById('bt-drawdown').textContent = `${backtest.maxDrawdown}%`;
      document.getElementById('bt-trades').textContent = backtest.totalTrades;
    }
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
    if (statusDot) {
      statusDot.className = `status-dot ${type}`;
    }
    if (srcTag && source) {
      srcTag.textContent = source;
    }
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
    if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 100)   return price.toFixed(2);
    if (price >= 1)     return price.toFixed(4);
    return price.toFixed(6);
  }
}
