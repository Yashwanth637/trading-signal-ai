/**
 * settings.js — User preferences and API key management
 * Stores everything in localStorage (never sent to any server except provider APIs).
 */

const KEYS = {
  GEMINI_KEY:     'tsai_gemini_key',
  AV_KEY:         'tsai_av_key',         // Alpha Vantage
  TD_KEY:         'tsai_td_key',         // Twelve Data (optional)
  WEBHOOK_URL:    'tsai_webhook_url',    // Discord/Telegram-compatible webhook
  THEME:          'tsai_theme',
  NOTIFICATIONS:  'tsai_notifications',
  AUDIO_ALERTS:   'tsai_audio_alerts',
  SMC_THRESHOLD:  'tsai_smc_threshold',
  SWING_LOOKBACK: 'tsai_swing_lb',
  AI_ENABLED:     'tsai_ai_enabled',
  LAST_SYMBOL:    'tsai_last_symbol',
  LAST_TF:        'tsai_last_tf',
  LAST_MARKET:    'tsai_last_market',
  RISK_BALANCE:   'tsai_risk_balance',   // Account balance for risk calc
  RISK_PCT:       'tsai_risk_pct',       // Risk % for position sizing
};

export const Settings = {
  // ─── API Keys ───────────────────────────────────────────────
  getGeminiKey()    { return localStorage.getItem(KEYS.GEMINI_KEY)     || ''; },
  setGeminiKey(k)   { localStorage.setItem(KEYS.GEMINI_KEY, k.trim()); },

  getAVKey()        { return localStorage.getItem(KEYS.AV_KEY)         || ''; },
  setAVKey(k)       { localStorage.setItem(KEYS.AV_KEY, k.trim()); },

  getTDKey()        { return localStorage.getItem(KEYS.TD_KEY)         || ''; },
  setTDKey(k)       { localStorage.setItem(KEYS.TD_KEY, k.trim()); },

  // ─── UI Preferences ────────────────────────────────────────
  getTheme()        { return localStorage.getItem(KEYS.THEME)          || 'dark'; },
  setTheme(t)       { localStorage.setItem(KEYS.THEME, t); },

  getNotifications()  { return localStorage.getItem(KEYS.NOTIFICATIONS)  !== 'false'; },
  setNotifications(b) { localStorage.setItem(KEYS.NOTIFICATIONS, b); },

  getAudioAlerts()  { return localStorage.getItem(KEYS.AUDIO_ALERTS)   !== 'false'; },
  setAudioAlerts(b) { localStorage.setItem(KEYS.AUDIO_ALERTS, b); },

  // ─── Webhook ────────────────────────────────────────────────
  getWebhookURL()   { return localStorage.getItem(KEYS.WEBHOOK_URL)    || ''; },
  setWebhookURL(u)  { localStorage.setItem(KEYS.WEBHOOK_URL, u.trim()); },

  // ─── Risk Calculator Defaults ───────────────────────────────
  getRiskBalance()  { return parseFloat(localStorage.getItem(KEYS.RISK_BALANCE) || '10000'); },
  setRiskBalance(n) { localStorage.setItem(KEYS.RISK_BALANCE, n); },

  getRiskPct()      { return parseFloat(localStorage.getItem(KEYS.RISK_PCT)     || '1'); },
  setRiskPct(n)     { localStorage.setItem(KEYS.RISK_PCT, n); },

  // ─── SMC Engine Tuning ──────────────────────────────────────
  getSMCThreshold()   { return parseInt(localStorage.getItem(KEYS.SMC_THRESHOLD) || '5'); },
  setSMCThreshold(n)  { localStorage.setItem(KEYS.SMC_THRESHOLD, n); },

  getSwingLookback()  { return parseInt(localStorage.getItem(KEYS.SWING_LOOKBACK) || '5'); },
  setSwingLookback(n) { localStorage.setItem(KEYS.SWING_LOOKBACK, n); },

  getAIEnabled()      { return localStorage.getItem(KEYS.AI_ENABLED) !== 'false'; },
  setAIEnabled(b)     { localStorage.setItem(KEYS.AI_ENABLED, b); },

  // ─── Session State ──────────────────────────────────────────
  getLastSymbol()   { return localStorage.getItem(KEYS.LAST_SYMBOL)    || 'BTCUSDT'; },
  setLastSymbol(s)  { localStorage.setItem(KEYS.LAST_SYMBOL, s); },

  getLastTF()       { return localStorage.getItem(KEYS.LAST_TF)        || '60'; },
  setLastTF(tf)     { localStorage.setItem(KEYS.LAST_TF, tf); },

  getLastMarket()   { return localStorage.getItem(KEYS.LAST_MARKET)    || 'CRYPTO'; },
  setLastMarket(m)  { localStorage.setItem(KEYS.LAST_MARKET, m); },

  // ─── Helper: export/import all settings ────────────────────
  exportAll() {
    const out = {};
    for (const k of Object.values(KEYS)) {
      out[k] = localStorage.getItem(k);
    }
    return JSON.stringify(out, null, 2);
  },

  importAll(jsonStr) {
    try {
      const obj = JSON.parse(jsonStr);
      for (const [k, v] of Object.entries(obj)) {
        if (Object.values(KEYS).includes(k) && v !== null) {
          localStorage.setItem(k, v);
        }
      }
      return true;
    } catch {
      return false;
    }
  },

  clearAll() {
    for (const k of Object.values(KEYS)) {
      localStorage.removeItem(k);
    }
  },
};
