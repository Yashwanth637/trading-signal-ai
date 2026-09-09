# Trading Signal AI 🚀

**AI-powered trading signal generator using Smart Money Concepts (SMC)**

[![GitHub Pages](https://img.shields.io/badge/Live-GitHub%20Pages-blue?style=flat-square&logo=github)](https://yashwanth637.github.io/trading-signal-ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

> **Live Site:** https://yashwanth637.github.io/trading-signal-ai/

---

## Features

| Feature | Description |
|---|---|
| 📊 **SMC Logic Engine** | Deterministic rule-based: BOS/CHoCH, Order Blocks, FVG, Liquidity Sweeps, S/R Zones |
| 🤖 **AI Confirmation** | Google Gemini 2.0 Flash confirms logic signals with natural-language reasoning |
| 📈 **Dual Chart Mode** | TradingView Lightweight Charts (SMC overlays) + Full TradingView Widget |
| ⚡ **Real-time Crypto** | Binance WebSocket — no API key required |
| 💱 **Forex Data** | Alpha Vantage (free 25 req/day) or Twelve Data (free 800 req/day) |
| 🔔 **Browser Alerts** | Push notifications + audio chime on signal fire |
| 🌙 **Dark / Light Mode** | Full theme switching |
| 📱 **Responsive** | Works on desktop, tablet, and mobile |

---

## Quick Start

### Option 1: Use the Live Site (Recommended)

1. Go to **https://yashwanth637.github.io/trading-signal-ai/**
2. Click **⚙ Settings** and enter:
   - Your **Gemini API Key** (free — get it at [aistudio.google.com](https://aistudio.google.com/app/apikey))
   - Your **Alpha Vantage API Key** (free — get it at [alphavantage.co](https://www.alphavantage.co/support/#api-key)) for Forex
3. Select a symbol, timeframe, and click **⚡ Analyze**
4. Signals appear automatically as each candle closes

### Option 2: Run Locally

```bash
# Clone the repo
git clone https://github.com/yashwanth637/trading-signal-ai.git
cd trading-signal-ai

# Serve with any static server — e.g. VS Code Live Server, or:
npx serve .
# → Open http://localhost:3000
```

> **No build step needed.** Pure vanilla HTML + JavaScript (ES modules).

---

## How Signals Work

### Logic Engine (Always Active)

Signals require **≥ 5 confluence points** from the following factors:

| Weight | Factor |
|---|---|
| +1 | HTF + LTF trend alignment |
| +2 | Break of Structure (BOS) confirmed |
| +3 | Change of Character (CHoCH) — trend reversal |
| +2 | Liquidity sweep (stop hunt) in counter-trend direction |
| +2 | Price entering a valid Order Block |
| +1 | Price inside an unfilled Fair Value Gap (FVG) |
| +1 | Price at validated Support / Resistance zone |

Additionally, **minimum Risk:Reward of 1.5:1** is required before a signal fires.

### AI Engine (When Gemini Key is Set)

- Receives the full SMC analysis context + 30 recent OHLCV candles
- Returns: `confirmation (BUY/SELL/NEUTRAL)`, `confidence (0-100)`, `reasoning`, `warnings`
- **Final confidence = Logic × 60% + AI × 40%**
- If AI says NEUTRAL or opposes the logic signal → signal is vetoed

---

## Chart Overlays

| Color | Meaning |
|---|---|
| 🟢 Green zone | Bullish Order Block |
| 🔴 Red zone | Bearish Order Block |
| 🟡 Yellow zone | Bullish Fair Value Gap |
| 🟣 Purple zone | Bearish Fair Value Gap |
| Teal zone | Support zone |
| Red zone | Resistance zone |
| `EQH` dashed line | Equal Highs (liquidity above) |
| `EQL` dashed line | Equal Lows (liquidity below) |
| ↑ Arrow below bar | BUY signal |
| ↓ Arrow above bar | SELL signal |
| — White price line | Entry |
| — Green dotted line | Take Profit |
| — Red dotted line | Stop Loss |

---

## API Keys Setup

All keys are stored **only in your browser's localStorage** — never sent to any server other than the respective API provider.

### Gemini (AI Engine)
1. Visit https://aistudio.google.com/app/apikey
2. Sign in with Google → Create API key
3. Paste into **⚙ Settings → Gemini API Key**
- Free tier: 15 req/min, 1,500 req/day

### Alpha Vantage (Forex Data)
1. Visit https://www.alphavantage.co/support/#api-key
2. Fill the form → Get free key instantly
3. Paste into **⚙ Settings → Alpha Vantage API Key**
- Free tier: 25 req/day, 5 req/min

### Twelve Data (Optional Premium Forex)
1. Visit https://twelvedata.com → Sign up
2. Paste into **⚙ Settings → Twelve Data API Key**
- Free tier: 800 req/day, 8 req/min, WebSocket included

> **Crypto data (Binance)** requires no API key — it uses the public Binance WebSocket directly.

---

## Deploy to GitHub Pages

```bash
# 1. Create a new repo on GitHub named: trading-signal-ai

# 2. Push the code
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/yashwanth637/trading-signal-ai.git
git push -u origin main

# 3. Enable GitHub Pages
# Go to: GitHub repo → Settings → Pages
# Source: Deploy from branch → main → / (root)
# Save — site will be live at https://yashwanth637.github.io/trading-signal-ai/
```

---

## SMC Concepts Reference

| Term | Definition |
|---|---|
| **BOS** | Break of Structure — price closes above last swing high (bull) or below swing low (bear) |
| **CHoCH** | Change of Character — BOS against the prevailing trend; signals reversal |
| **Order Block (OB)** | Last opposing candle before a BOS impulse — institutional entry zone |
| **FVG** | Fair Value Gap — three-candle price imbalance; price typically returns to fill it |
| **Liquidity Sweep** | Price wicks above EQH or below EQL then reverses — stop hunt |
| **EQH / EQL** | Equal Highs / Equal Lows — clustered liquidity targets |
| **S/R Zone** | Clustered swing highs (resistance) or swing lows (support) |
| **HTF Bias** | Higher timeframe trend direction used to filter lower-TF signals |

---

## Project Structure

```
trading-signal-ai/
├── index.html                  # Main dashboard (single page)
├── assets/
│   ├── css/
│   │   └── main.css            # Design system — dark/light themes
│   └── js/
│       ├── app.js              # Bootstrap — wires all modules
│       ├── smcEngine.js        # SMC algorithms (swing, BOS, OB, FVG, sweeps)
│       ├── signalEngine.js     # Signal orchestrator
│       ├── aiEngine.js         # Gemini 2.0 Flash client
│       ├── dataFeed.js         # Binance WS + Alpha Vantage + CoinGecko
│       ├── chart.js            # LW Charts v4 wrapper + zone renderer
│       ├── notifications.js    # Browser push + audio alerts
│       ├── settings.js         # LocalStorage preferences
│       └── ui.js               # Dashboard UI rendering
├── .nojekyll                   # Required for GitHub Pages
└── README.md
```

---

## Disclaimer

> ⚠️ **This tool is for educational and research purposes only.**
> Trading financial instruments involves significant risk of loss.
> Signals generated by this tool do not constitute financial advice.
> Always do your own research and use proper risk management.

---

## License

MIT © 2024 [yashwanth637](https://github.com/yashwanth637)
