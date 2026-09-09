/**
 * strategyBuilder.js — Plain-English Strategy Compiler & Backtest Simulator
 *
 * "Describe it. The engine builds it."
 * 1. Describe: Natural language setup (e.g. "Buy when RSI is under 30 and price holds 200 EMA with 2R target")
 * 2. Compile: Translates sentence into algorithmic logic rules
 * 3. Backtest: Replays on real historical candles trade-by-trade
 * 4. Stats: Win rate %, profit factor, max drawdown, trade timeline
 */

export class StrategyBuilder {
  constructor() {}

  /**
   * Parse plain English text into structured strategy rules
   * @param {string} prompt
   * @returns {StrategyRule}
   */
  compile(prompt) {
    const p = prompt.toLowerCase();

    // 1. Action type
    let action = 'BUY';
    if (p.includes('sell') || p.includes('short')) action = 'SELL';

    // 2. Technical conditions
    const conditions = [];
    let rsiThreshold = 30;
    let hasRsi = false;
    let hasEma = false;
    let emaPeriod = 200;
    let hasSweep = false;
    let hasBos = false;
    let hasOb = false;

    // RSI check
    if (p.includes('rsi')) {
      hasRsi = true;
      const match = p.match(/rsi.*?(\d{2})/);
      if (match) rsiThreshold = parseInt(match[1]);
      else rsiThreshold = action === 'BUY' ? 30 : 70;
      conditions.push({
        type: 'RSI',
        comparator: action === 'BUY' ? '<=' : '>=',
        value: rsiThreshold,
        label: `RSI(14) ${action === 'BUY' ? '<=' : '>='} ${rsiThreshold}`
      });
    }

    // EMA check
    if (p.includes('ema') || p.includes('ma')) {
      hasEma = true;
      const match = p.match(/(?:ema|ma).*?(\d{2,3})/);
      if (match) emaPeriod = parseInt(match[1]);
      conditions.push({
        type: 'EMA',
        period: emaPeriod,
        comparator: action === 'BUY' ? 'ABOVE' : 'BELOW',
        label: `Close ${action === 'BUY' ? 'above' : 'below'} EMA(${emaPeriod})`
      });
    }

    // Liquidity sweep check
    if (p.includes('sweep') || p.includes('liquidity') || p.includes('stop hunt')) {
      hasSweep = true;
      conditions.push({
        type: 'SWEEP',
        direction: action === 'BUY' ? 'BULLISH' : 'BEARISH',
        label: `${action === 'BUY' ? 'Sell-side (SSL)' : 'Buy-side (BSL)'} liquidity sweep`
      });
    }

    // BOS / Structure check
    if (p.includes('bos') || p.includes('break of structure') || p.includes('choch') || p.includes('structure')) {
      hasBos = true;
      conditions.push({
        type: 'BOS',
        signal: action === 'BUY' ? 'BULL' : 'BEAR',
        label: `${action === 'BUY' ? 'Bullish' : 'Bearish'} BOS/CHoCH confirmed`
      });
    }

    // Order Block check
    if (p.includes('order block') || p.includes('ob')) {
      hasOb = true;
      conditions.push({
        type: 'OB',
        obType: action === 'BUY' ? 'BULLISH_OB' : 'BEARISH_OB',
        label: `Price tests ${action === 'BUY' ? 'Bullish' : 'Bearish'} Order Block`
      });
    }

    // Default fallback if nothing specified
    if (conditions.length === 0) {
      conditions.push({
        type: 'RSI',
        comparator: action === 'BUY' ? '<=' : '>=',
        value: action === 'BUY' ? 35 : 65,
        label: `RSI momentum confirmation`
      });
      conditions.push({
        type: 'EMA',
        period: 50,
        comparator: action === 'BUY' ? 'ABOVE' : 'BELOW',
        label: `Trend filter above EMA(50)`
      });
    }

    // 3. Targets & Risk-Reward
    let targetPct = 2.5;
    let stopPct = 1.2;

    const tpMatch = p.match(/(?:tp|target|take profit).*?([0-9.]+)\s*%/);
    if (tpMatch) targetPct = parseFloat(tpMatch[1]);

    const slMatch = p.match(/(?:sl|stop|stop loss).*?([0-9.]+)\s*%/);
    if (slMatch) stopPct = parseFloat(slMatch[1]);

    const rrMatch = p.match(/([0-9.]+)\s*(?:r|rr|:1)/);
    if (rrMatch) {
      const rr = parseFloat(rrMatch[1]);
      targetPct = +(stopPct * rr).toFixed(2);
    }

    return {
      rawPrompt: prompt,
      action,
      conditions,
      targetPct,
      stopPct,
      riskReward: +(targetPct / stopPct).toFixed(2),
      summary: `${action} setup with ${conditions.length} conditions: Target +${targetPct}%, Stop -${stopPct}% (R:R 1:${(targetPct / stopPct).toFixed(1)})`
    };
  }

  /**
   * Run historical backtest of compiled rules on candles
   * @param {StrategyRule} strategy
   * @param {Array} candles
   * @returns {BacktestResult}
   */
  backtest(strategy, candles) {
    if (!candles || candles.length < 50) {
      return { totalTrades: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0, netProfit: 0, trades: [] };
    }

    // Calculate technical indicators
    const rsiValues = this._calcRSI(candles, 14);
    const emaValues = this._calcEMA(candles, 50);

    const trades = [];
    let inTrade = false;
    let activeTrade = null;
    let cumulativeReturn = 0;
    let maxDrawdown = 0;
    let peakReturn = 0;

    for (let i = 25; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      // If already in a trade, check exit
      if (inTrade) {
        if (activeTrade.action === 'BUY') {
          // Check Take Profit
          if (c.high >= activeTrade.targetPrice) {
            activeTrade.exitPrice = activeTrade.targetPrice;
            activeTrade.exitTime = c.time;
            activeTrade.outcome = 'WIN';
            activeTrade.pnlPct = strategy.targetPct;
            cumulativeReturn += strategy.targetPct;
            trades.push(activeTrade);
            inTrade = false;
            activeTrade = null;
            continue;
          }
          // Check Stop Loss
          if (c.low <= activeTrade.stopPrice) {
            activeTrade.exitPrice = activeTrade.stopPrice;
            activeTrade.exitTime = c.time;
            activeTrade.outcome = 'LOSS';
            activeTrade.pnlPct = -strategy.stopPct;
            cumulativeReturn -= strategy.stopPct;
            trades.push(activeTrade);
            inTrade = false;
            activeTrade = null;
            continue;
          }
        } else {
          // SELL / SHORT trade
          if (c.low <= activeTrade.targetPrice) {
            activeTrade.exitPrice = activeTrade.targetPrice;
            activeTrade.exitTime = c.time;
            activeTrade.outcome = 'WIN';
            activeTrade.pnlPct = strategy.targetPct;
            cumulativeReturn += strategy.targetPct;
            trades.push(activeTrade);
            inTrade = false;
            activeTrade = null;
            continue;
          }
          if (c.high >= activeTrade.stopPrice) {
            activeTrade.exitPrice = activeTrade.stopPrice;
            activeTrade.exitTime = c.time;
            activeTrade.outcome = 'LOSS';
            activeTrade.pnlPct = -strategy.stopPct;
            cumulativeReturn -= strategy.stopPct;
            trades.push(activeTrade);
            inTrade = false;
            activeTrade = null;
            continue;
          }
        }

        // Drawdown track
        peakReturn = Math.max(peakReturn, cumulativeReturn);
        const dd = peakReturn - cumulativeReturn;
        maxDrawdown = Math.max(maxDrawdown, dd);
        continue;
      }

      // Check entry conditions
      let triggered = true;
      const rsi = rsiValues[i];
      const ema = emaValues[i];

      for (const cond of strategy.conditions) {
        if (cond.type === 'RSI') {
          if (cond.comparator === '<=' && rsi > cond.value) triggered = false;
          if (cond.comparator === '>=' && rsi < cond.value) triggered = false;
        }
        if (cond.type === 'EMA') {
          if (cond.comparator === 'ABOVE' && c.close < ema) triggered = false;
          if (cond.comparator === 'BELOW' && c.close > ema) triggered = false;
        }
        if (cond.type === 'SWEEP') {
          // Check if current candle had a wick lower than prior 5 bars then closed up
          const prev5Lows = candles.slice(Math.max(0, i - 5), i).map(x => x.low);
          const minLow = Math.min(...prev5Lows);
          if (cond.direction === 'BULLISH' && !(c.low < minLow && c.close > c.open)) {
            triggered = false;
          }
        }
      }

      if (triggered) {
        const entry = c.close;
        const targetPrice = strategy.action === 'BUY'
          ? entry * (1 + strategy.targetPct / 100)
          : entry * (1 - strategy.targetPct / 100);
        const stopPrice = strategy.action === 'BUY'
          ? entry * (1 - strategy.stopPct / 100)
          : entry * (1 + strategy.stopPct / 100);

        inTrade = true;
        activeTrade = {
          action: strategy.action,
          entryPrice: +entry.toFixed(5),
          targetPrice: +targetPrice.toFixed(5),
          stopPrice: +stopPrice.toFixed(5),
          entryTime: c.time,
        };
      }
    }

    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS');
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? +((wins.length / totalTrades) * 100).toFixed(1) : 0;
    const totalGains = wins.length * strategy.targetPct;
    const totalLosses = losses.length * strategy.stopPct || 0.0001;
    const profitFactor = +(totalGains / totalLosses).toFixed(2);

    return {
      totalTrades,
      winRate,
      wins: wins.length,
      losses: losses.length,
      profitFactor,
      maxDrawdown: +maxDrawdown.toFixed(2),
      netProfit: +cumulativeReturn.toFixed(2),
      trades: trades.slice(-20), // return last 20 trades
    };
  }

  // Helper indicator calculations
  _calcRSI(candles, period = 14) {
    const rsi = new Array(candles.length).fill(50);
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[i] = avgLoss === 0 ? 100 : +(100 - (100 / (1 + avgGain / avgLoss))).toFixed(1);
    }
    return rsi;
  }

  _calcEMA(candles, period = 50) {
    const k = 2 / (period + 1);
    const ema = new Array(candles.length).fill(candles[0]?.close || 0);

    for (let i = 1; i < candles.length; i++) {
      ema[i] = candles[i].close * k + ema[i - 1] * (1 - k);
    }
    return ema;
  }
}
