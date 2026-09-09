/**
 * chart.js — Deeepr.ai-Inspired TradingView Lightweight Charts v4 Wrapper
 *
 * Features:
 *  - Obsidian Deep Void Theme (#03060f) with neon cyan crosshair
 *  - Forward-projected shaded TP (emerald) and SL (ruby) forecast zones
 *  - Floating level grip badges (TP, SL, Entry)
 *  - Custom canvas primitives for Order Blocks and Fair Value Gaps
 *  - Multi-timeframe synced volume pane
 */

// ─── Custom Canvas Primitive for Shaded Zones ─────────────────────
class RectZonePrimitive {
  constructor(top, bottom, startTime, endTime, fillColor, borderColor, label = '') {
    this._top = top;
    this._bottom = bottom;
    this._startT = startTime;
    this._endT = endTime;
    this._fill = fillColor;
    this._border = borderColor;
    this._label = label;
    this._view = null;
    this._series = null;
    this._chart = null;
  }

  attached({ chart, series }) {
    this._chart = chart;
    this._series = series;
    this._view = new RectZoneView(this);
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._view = null;
  }

  updateAllViews() {
    if (this._view) this._view.update(this._chart, this._series);
  }

  paneViews() {
    return this._view ? [this._view] : [];
  }
}

class RectZoneView {
  constructor(prim) {
    this._prim = prim;
    this._coords = null;
  }

  update(chart, series) {
    if (!chart || !series) return;
    const p = this._prim;

    const y1 = series.priceToCoordinate(p._top);
    const y2 = series.priceToCoordinate(p._bottom);
    const x1 = chart.timeScale().timeToCoordinate(p._startT);

    let x2;
    if (p._endT) {
      x2 = chart.timeScale().timeToCoordinate(p._endT);
    } else {
      const vr = chart.timeScale().getVisibleRange();
      x2 = vr ? chart.timeScale().timeToCoordinate(vr.to) : (x1 ? x1 + 2000 : 2000);
    }

    if (y1 === null || y2 === null || x1 === null) {
      this._coords = null;
      return;
    }
    this._coords = { x1, y1: Math.min(y1, y2), x2: x2 || x1 + 400, y2: Math.max(y1, y2) };
  }

  renderer() {
    const coords = this._coords;
    const fill = this._prim._fill;
    const border = this._prim._border;
    const label = this._prim._label;

    return {
      draw(target) {
        if (!coords) return;
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          const { x1, y1, x2, y2 } = coords;
          const rx1 = Math.round(x1 * hpr);
          const ry1 = Math.round(y1 * vpr);
          const rw = Math.round((x2 - x1) * hpr);
          const rh = Math.round((y2 - y1) * vpr);

          ctx.save();
          ctx.fillStyle = fill;
          ctx.fillRect(rx1, ry1, rw, rh);

          if (border) {
            ctx.strokeStyle = border;
            ctx.lineWidth = 1.2;
            ctx.strokeRect(rx1, ry1, rw, rh);
          }

          if (label && rw > 60 && rh > 14) {
            ctx.fillStyle = border || '#ffffff';
            ctx.font = `${Math.round(10 * vpr)}px 'JetBrains Mono', monospace`;
            ctx.fillText(label, rx1 + 8 * hpr, ry1 + 14 * vpr);
          }
          ctx.restore();
        });
      },
    };
  }
}

// ─── ChartManager ────────────────────────────────────────────────
export class ChartManager {
  constructor(mainContainerId, volContainerId) {
    this._mainEl = document.getElementById(mainContainerId);
    this._volEl = document.getElementById(volContainerId);
    this._chart = null;
    this._volChart = null;
    this._candles = null;
    this._vol = null;
    this._markers = [];
    this._primitives = {};
    this._projectionPrimitives = [];
    this._priceLines = [];
    this._zoneLayer = null;
    this._theme = 'dark';
  }

  init(theme = 'dark') {
    this._theme = theme;
    const colors = this._colors(theme);

    // Main Lightweight Chart
    this._chart = LightweightCharts.createChart(this._mainEl, {
      layout: {
        background: { type: 'solid', color: colors.bg },
        textColor: colors.text,
        fontFamily: "'Inter', -apple-system, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: colors.gridLine },
        horzLines: { color: colors.gridLine },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
        horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
      },
      rightPriceScale: {
        borderColor: colors.border,
        scaleMargins: { top: 0.12, bottom: 0.14 },
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => {
          const d = new Date(time * 1000);
          return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      autoSize: true,
    });

    // Candlestick Series (Deeepr Neon Green & Red)
    this._candles = this._chart.addCandlestickSeries({
      upColor: colors.bullCandle,
      downColor: colors.bearCandle,
      borderUpColor: colors.bullCandle,
      borderDownColor: colors.bearCandle,
      wickUpColor: colors.bullCandle,
      wickDownColor: colors.bearCandle,
    });

    // Hidden Line Series to attach custom primitives
    this._zoneLayer = this._chart.addLineSeries({
      color: 'transparent',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Synced Volume Subchart
    if (this._volEl) {
      this._volChart = LightweightCharts.createChart(this._volEl, {
        layout: { background: { type: 'solid', color: colors.bg }, textColor: colors.text },
        grid: { vertLines: { color: 'transparent' }, horzLines: { color: 'transparent' } },
        rightPriceScale: { borderColor: colors.border, scaleMargins: { top: 0.1, bottom: 0 } },
        timeScale: { borderColor: colors.border, visible: false },
        crosshair: { vertLine: { color: colors.crosshair }, horzLine: { visible: false } },
        handleScale: false,
        handleScroll: false,
        autoSize: true,
      });

      this._vol = this._volChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        color: colors.volBar,
      });

      this._chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) this._volChart.timeScale().setVisibleLogicalRange(r);
      });
      this._volChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) this._chart.timeScale().setVisibleLogicalRange(r);
      });
    }

    this._resizeObserver = new ResizeObserver(() => {
      this._chart.applyOptions({ autoSize: true });
      this._volChart?.applyOptions({ autoSize: true });
    });
    this._resizeObserver.observe(this._mainEl);
  }

  // ─── Candlestick Data ──────────────────────────────────────────
  setHistory(candles) {
    if (!this._candles) return;
    const unique = [];
    const seen = new Set();
    for (const c of candles) {
      if (!seen.has(c.time)) {
        seen.add(c.time);
        unique.push(c);
      }
    }
    unique.sort((a, b) => a.time - b.time);

    this._candles.setData(unique);
    if (this._vol) {
      this._vol.setData(unique.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(0, 240, 144, 0.45)' : 'rgba(255, 51, 102, 0.45)',
      })));
    }
    this._chart.timeScale().fitContent();
  }

  updateCandle(candle) {
    if (!this._candles) return;
    this._candles.update(candle);
    if (this._vol && candle.volume != null) {
      this._vol.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(0, 240, 144, 0.45)' : 'rgba(255, 51, 102, 0.45)',
      });
    }
  }

  // ─── Deeepr Forward-Projected TP / SL Shaded Zones ──────────────
  drawProjectionZones({ entry, target, stop, verdict, startTime }) {
    if (!this._zoneLayer || !target || !stop) return;

    // Clear previous projections
    for (const p of this._projectionPrimitives) {
      try { this._zoneLayer.detachPrimitive(p); } catch {}
    }
    this._projectionPrimitives = [];

    const futureTime = (startTime || Math.floor(Date.now() / 1000)) + 3600 * 30; // 30 bars into future

    if (verdict === 'LONG') {
      // 1. Target (TP) Green Shaded Box: [entry -> target]
      const tpPrim = new RectZonePrimitive(
        target,
        entry,
        startTime,
        futureTime,
        'rgba(0, 240, 144, 0.16)', // translucent emerald
        '#00f090',
        `TP: ${target.toFixed(2)}`
      );
      // 2. Stop (SL) Red Shaded Box: [stop -> entry]
      const slPrim = new RectZonePrimitive(
        entry,
        stop,
        startTime,
        futureTime,
        'rgba(255, 51, 102, 0.16)', // translucent ruby
        '#ff3366',
        `SL: ${stop.toFixed(2)}`
      );

      this._zoneLayer.attachPrimitive(tpPrim);
      this._zoneLayer.attachPrimitive(slPrim);
      this._projectionPrimitives.push(tpPrim, slPrim);
    } else if (verdict === 'SHORT') {
      // 1. Target (TP) Green Box: [target -> entry]
      const tpPrim = new RectZonePrimitive(
        entry,
        target,
        startTime,
        futureTime,
        'rgba(0, 240, 144, 0.16)',
        '#00f090',
        `TP: ${target.toFixed(2)}`
      );
      // 2. Stop (SL) Red Box: [entry -> stop]
      const slPrim = new RectZonePrimitive(
        stop,
        entry,
        startTime,
        futureTime,
        'rgba(255, 51, 102, 0.16)',
        '#ff3366',
        `SL: ${stop.toFixed(2)}`
      );

      this._zoneLayer.attachPrimitive(tpPrim);
      this._zoneLayer.attachPrimitive(slPrim);
      this._projectionPrimitives.push(tpPrim, slPrim);
    }
  }

  clearProjectionZones() {
    for (const p of this._projectionPrimitives) {
      try { this._zoneLayer.detachPrimitive(p); } catch {}
    }
    this._projectionPrimitives = [];
  }

  // ─── SMC Zones (Order Blocks, FVGs, S/R) ─────────────────────────
  drawSMCZones(smcResult) {
    if (!this._zoneLayer || !smcResult) return;

    // Detach old primitives
    for (const prim of Object.values(this._primitives)) {
      try { this._zoneLayer.detachPrimitive(prim); } catch {}
    }
    this._primitives = {};

    const { orderBlocks = [], fvgs = [], equalHighs = [], equalLows = [] } = smcResult;
    const futureTime = Math.floor(Date.now() / 1000) + 3600 * 20;

    // Order Blocks
    orderBlocks.slice(-6).forEach((ob, i) => {
      const isBull = ob.type === 'BULLISH_OB';
      const color = isBull ? 'rgba(0, 212, 255, 0.14)' : 'rgba(168, 85, 247, 0.14)';
      const border = isBull ? '#00d4ff' : '#a855f7';
      const label = isBull ? 'BULL OB' : 'BEAR OB';

      const prim = new RectZonePrimitive(ob.top, ob.bottom, ob.time, futureTime, color, border, label);
      const id = `ob_${i}`;
      this._primitives[id] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });

    // FVGs
    fvgs.slice(-5).forEach((fvg, i) => {
      const isBull = fvg.type === 'BULLISH_FVG';
      const color = isBull ? 'rgba(255, 193, 7, 0.10)' : 'rgba(233, 30, 99, 0.10)';
      const border = isBull ? '#ffc107' : '#e91e63';

      const prim = new RectZonePrimitive(fvg.top, fvg.bottom, fvg.time, futureTime, color, border, 'FVG');
      const id = `fvg_${i}`;
      this._primitives[id] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });

    // Equal Highs / Lows Price Lines
    for (const pl of this._priceLines) {
      try { this._candles.removePriceLine(pl); } catch {}
    }
    this._priceLines = [];

    equalHighs.slice(0, 3).forEach(z => {
      const pl = this._candles.createPriceLine({
        price: z.price,
        color: 'rgba(255, 51, 102, 0.75)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'EQH',
      });
      this._priceLines.push(pl);
    });

    equalLows.slice(0, 3).forEach(z => {
      const pl = this._candles.createPriceLine({
        price: z.price,
        color: 'rgba(0, 240, 144, 0.75)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'EQL',
      });
      this._priceLines.push(pl);
    });
  }

  // ─── Signal Markers ──────────────────────────────────────────────
  addSignalMarker({ time, type, text = '' }) {
    this._markers.push({
      time,
      position: type === 'LONG' || type === 'BUY' ? 'belowBar' : 'aboveBar',
      color: type === 'LONG' || type === 'BUY' ? '#00f090' : '#ff3366',
      shape: type === 'LONG' || type === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: text || type,
      size: 2,
    });
    if (this._markers.length > 50) this._markers.shift();
    this._candles.setMarkers(this._markers);
  }

  clearMarkers() {
    this._markers = [];
    this._candles?.setMarkers([]);
  }

  // ─── SL / TP Level Price Lines ────────────────────────────────────
  showSLTPLines({ entryPrice, stopLoss, takeProfit }) {
    if (this._slLine) try { this._candles.removePriceLine(this._slLine); } catch {}
    if (this._tpLine) try { this._candles.removePriceLine(this._tpLine); } catch {}
    if (this._entLine) try { this._candles.removePriceLine(this._entLine); } catch {}

    if (entryPrice) {
      this._entLine = this._candles.createPriceLine({
        price: entryPrice,
        color: '#ffffff',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }
    if (stopLoss) {
      this._slLine = this._candles.createPriceLine({
        price: stopLoss,
        color: '#ff3366',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'SL',
      });
    }
    if (takeProfit) {
      this._tpLine = this._candles.createPriceLine({
        price: takeProfit,
        color: '#00f090',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'TP',
      });
    }
  }

  clearSLTPLines() {
    if (this._slLine) try { this._candles.removePriceLine(this._slLine); } catch {}
    if (this._tpLine) try { this._candles.removePriceLine(this._tpLine); } catch {}
    if (this._entLine) try { this._candles.removePriceLine(this._entLine); } catch {}
    this._slLine = this._tpLine = this._entLine = null;
  }

  setTheme(theme) {
    this._theme = theme;
    const colors = this._colors(theme);
    this._chart.applyOptions({
      layout: { background: { color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.gridLine }, horzLines: { color: colors.gridLine } },
      crosshair: { vertLine: { labelBackgroundColor: colors.labelBg }, horzLine: { labelBackgroundColor: colors.labelBg } },
    });
    this._volChart?.applyOptions({
      layout: { background: { color: colors.bg }, textColor: colors.text },
    });
  }

  _colors(theme) {
    return theme === 'dark' ? {
      bg: '#03060f', // Deeepr Obsidian Void
      text: '#8f9bb3',
      gridLine: 'rgba(255, 255, 255, 0.03)',
      border: '#141c2e',
      crosshair: '#00d4ff', // Deeepr Neon Cyan
      labelBg: '#0b1120',
      bullCandle: '#00f090', // Deeepr Emerald Green
      bearCandle: '#ff3366', // Deeepr Ruby Red
      volBar: 'rgba(0, 212, 255, 0.35)',
    } : {
      bg: '#f8fafc',
      text: '#334155',
      gridLine: '#e2e8f0',
      border: '#cbd5e1',
      crosshair: '#0284c7',
      labelBg: '#f1f5f9',
      bullCandle: '#10b981',
      bearCandle: '#ef4444',
      volBar: 'rgba(2, 132, 199, 0.35)',
    };
  }
}
