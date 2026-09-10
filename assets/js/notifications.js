/**
 * notifications.js — Browser Push Notification + Audio Alert engine
 */

import { Settings } from './settings.js';

// Lightweight audio chime using Web Audio API (no file dependency)
function playChime(type = 'BUY') {
  if (!Settings.getAudioAlerts()) return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(type === 'BUY' ? 880 : 440, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Audio context not available — skip silently
  }
}

export const Notifications = {
  _permission: 'default',

  /** Request notification permission (call once on startup) */
  async requestPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      this._permission = 'granted';
    } else if (Notification.permission !== 'denied') {
      this._permission = await Notification.requestPermission();
    } else {
      this._permission = Notification.permission;
    }
    return this._permission;
  },

  /**
   * Fire a trading signal notification.
   * @param {Object} signal
   * @param {string} signal.type     'BUY' | 'SELL'
   * @param {string} signal.symbol
   * @param {string} signal.timeframe
   * @param {number} signal.confidence
   * @param {number} signal.price
   * @param {number} [signal.stopLoss]
   * @param {number} [signal.takeProfit]
   * @param {number} [signal.riskReward]
   */
  fireSignalAlert(signal) {
    if (!Settings.getNotifications()) return;

    const { type, symbol, timeframe, confidence, price, stopLoss, takeProfit, riskReward } = signal;
    const emoji = type === 'BUY' ? '🟢' : '🔴';

    // Play audio
    playChime(type);

    // Browser notification
    if (this._permission === 'granted') {
      const body = [
        `${timeframe} | Confidence: ${confidence}%`,
        `Entry: ${this._fmt(price)}`,
        stopLoss   ? `SL: ${this._fmt(stopLoss)}`   : '',
        takeProfit ? `TP: ${this._fmt(takeProfit)}`  : '',
        riskReward ? `R:R = 1:${riskReward}`         : '',
      ].filter(Boolean).join('\n');

      try {
        const n = new Notification(`${emoji} ${type} — ${symbol}`, {
          body,
          icon: 'assets/icons/logo.svg',
          tag:  `signal-${symbol}-${Date.now()}`,
          requireInteraction: false,
        });
        setTimeout(() => n.close(), 8000);
      } catch (e) {
        console.warn('[Notifications] Could not show notification:', e.message);
      }
    }
  },

  /**
   * Fire a general info notification.
   * @param {string} title
   * @param {string} body
   */
  fireInfo(title, body = '') {
    if (this._permission !== 'granted' || !Settings.getNotifications()) return;
    try {
      const n = new Notification(title, { body, icon: 'assets/icons/logo.svg' });
      setTimeout(() => n.close(), 5000);
    } catch {}
  },

  /**
   * POST a JSON payload to the configured webhook URL (Discord/Telegram-compatible).
   * Discord expects { content: "..." } or { embeds: [...] }.
   * Custom bots can use the raw payload directly.
   * @param {Object} payload
   */
  async fireWebhook(payload) {
    const url = Settings.getWebhookURL();
    if (!url) return;

    try {
      const body = JSON.stringify({
        username: 'TradersZone.ai',
        content:  `**${payload.signal} — ${payload.symbol}**\n` +
                  `Timeframe: ${payload.timeframe} | Confidence: ${payload.confidence}%\n` +
                  `Entry: ${payload.entry} | Stop: ${payload.stop} | Target: ${payload.target}\n` +
                  `R:R = 1:${payload.riskReward} | ${new Date(payload.timestamp).toUTCString()}`,
        embeds: [{
          title:       `${payload.signal === 'BUY' ? '🟢' : '🔴'} ${payload.signal} Signal — ${payload.symbol}`,
          color:       payload.signal === 'BUY' ? 0x00f090 : 0xff3366,
          fields: [
            { name: 'Entry',      value: `\`${payload.entry}\``,      inline: true },
            { name: 'Stop Loss',  value: `\`${payload.stop}\``,       inline: true },
            { name: 'Target',     value: `\`${payload.target}\``,     inline: true },
            { name: 'Timeframe',  value: `\`${payload.timeframe}\``,  inline: true },
            { name: 'Confidence', value: `\`${payload.confidence}%\``, inline: true },
            { name: 'R:R',        value: `\`1:${payload.riskReward}\``, inline: true },
          ],
          timestamp: new Date(payload.timestamp).toISOString(),
          footer: { text: 'TradersZone.ai · Institutional Signal Platform' },
        }],
      });

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      console.warn('[Notifications] Webhook POST failed:', e.message);
    }
  },

  isGranted() {
    return this._permission === 'granted';
  },

  _fmt(price) {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1)    return price.toFixed(4);
    return price.toFixed(6);
  },
};
