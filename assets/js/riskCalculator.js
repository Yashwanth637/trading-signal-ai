/**
 * riskCalculator.js — TradersZone.ai Risk & Position Sizing Calculator
 *
 * Pure function module. Calculates:
 *  - Dollar Risk
 *  - Position Size (crypto units or forex lots)
 *  - TP1 (1.5R), TP2 (3.0R), Runner (open-ended)
 *  - Break-Even note
 *
 * Automatically detects asset type from symbol string.
 */

const LOT_SIZES = {
  forex:  100000, // 1 standard lot = 100,000 units
  gold:   100,    // 1 lot of Gold = 100 troy oz (XAUUSD)
  crypto: null,   // no lot size; position expressed in base units
};

export const RiskCalculator = {
  /**
   * Calculate full risk parameters for a trade setup
   *
   * @param {Object} params
   * @param {number} params.balance      Account balance in USD
   * @param {number} params.riskPct      Risk percentage (e.g. 1 for 1%)
   * @param {number} params.entry        Entry price
   * @param {number} params.stop         Stop loss price
   * @param {string} params.symbol       Asset symbol (e.g. 'BTCUSDT', 'EURUSD')
   * @param {string} [params.direction]  'BUY' | 'SELL'
   * @returns {Object} Risk calculation result
   */
  calc({ balance, riskPct, entry, stop, symbol = '', direction = 'BUY' }) {
    if (!balance || !riskPct || !entry || !stop) {
      return this._emptyResult();
    }

    const dollarRisk = balance * (riskPct / 100);
    const riskPoints = Math.abs(entry - stop);

    if (riskPoints === 0) return this._emptyResult();

    const assetType = this._detectAssetType(symbol);
    const lotSize   = LOT_SIZES[assetType];

    // Position size calculation
    let positionSize, positionLabel;
    if (assetType === 'crypto') {
      positionSize = dollarRisk / riskPoints;
      const baseSymbol = symbol.replace('USDT', '').replace('BUSD', '');
      positionLabel = `${positionSize.toFixed(4)} ${baseSymbol}`;
    } else if (assetType === 'gold') {
      const pipValue = lotSize; // 1 lot gold = $100 per $1 move
      const lotsNeeded = dollarRisk / (riskPoints * pipValue);
      positionSize  = lotsNeeded;
      positionLabel = `${lotsNeeded.toFixed(3)} lots (Gold)`;
    } else {
      // Forex: pip value for major pairs
      const pipValue = lotSize * 0.0001; // USD value per pip per lot (approx for USD quote)
      const pipsAtRisk = riskPoints * 10000; // convert price diff to pips
      const lotsNeeded = dollarRisk / (pipsAtRisk * (lotSize * 0.0001));
      positionSize  = lotsNeeded;
      positionLabel = `${lotsNeeded.toFixed(3)} lots`;
    }

    // Multi-tier Take Profits
    const dir = direction === 'BUY' ? 1 : -1;
    const tp1   = +(entry + dir * riskPoints * 1.5).toFixed(5);
    const tp2   = +(entry + dir * riskPoints * 3.0).toFixed(5);
    const runner = +(entry + dir * riskPoints * 5.0).toFixed(5);

    return {
      dollarRisk:   +dollarRisk.toFixed(2),
      riskPct,
      positionSize: +positionSize.toFixed(5),
      positionLabel,
      assetType,
      riskPoints:   +riskPoints.toFixed(5),
      tp1,
      tp2,
      runner,
      rr1:          '1:1.5',
      rr2:          '1:3.0',
      rrRunner:     '1:5.0+',
      breakevenNote: 'Move SL to Break-Even after TP1 hit',
      dollarPotential1: +(dollarRisk * 1.5).toFixed(2),
      dollarPotential2: +(dollarRisk * 3.0).toFixed(2),
    };
  },

  _detectAssetType(symbol) {
    const s = symbol.toUpperCase();
    if (s.includes('XAU') || s.includes('PAXG')) return 'gold';
    if (s.includes('USDT') || s.includes('BUSD') || s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('BNB')) return 'crypto';
    return 'forex';
  },

  _emptyResult() {
    return {
      dollarRisk: 0,
      riskPct: 0,
      positionSize: 0,
      positionLabel: '—',
      assetType: 'crypto',
      riskPoints: 0,
      tp1: 0,
      tp2: 0,
      runner: 0,
      rr1: '1:1.5',
      rr2: '1:3.0',
      rrRunner: '1:5.0+',
      breakevenNote: 'Move SL to Break-Even after TP1 hit',
      dollarPotential1: 0,
      dollarPotential2: 0,
    };
  },
};
