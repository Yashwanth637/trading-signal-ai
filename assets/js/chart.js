/**
 * chart.js — TradingView Lightweight Charts v4 wrapper
 *
 * Handles:
 *  - Chart initialization (main + volume pane)
 *  - Candle + volume series rendering
 *  - SMC zone overlays (OB boxes, FVG boxes, S/R zones, equal H/L lines)
 *  - Buy/Sell signal arrow markers
 *  - Chart theme switching
 *  - Time-scale sync between main and volume chart
 */

// ─── Zone Rectangle Primitive ────────────────────────────────────
/**
 * A lightweight ISeriesPrimitive for drawing rectangular zones
 * (Order Blocks, FVGs, S/R zones) directly on the canvas.
 */
class RectZonePrimitive {
  constructor(top, bottom, startTime, endTime, fillColor, borderColor) {
    this._top    = top;
    this._bottom = bottom;
    this._startT = startTime;
    this._endT   = endTime;
    this._fill   = fillColor;
    this._border = borderColor;
    this._view   = null;
    this._series = null;
    this._chart  = null;
  }

  attached({ chart, series }) {
    this._chart  = chart;
    this._series = series;
    this._view   = new RectZoneView(this);
  }

  detached() { this._chart = null; this._series = null; this._view = null; }

  updateAllViews() {
    if (this._view) this._view.update(this._chart, this._series);
  }

  paneViews() { return this._view ? [this._view] : []; }

  update({ top, bottom, startTime, endTime }) {
    if (top    !== undefined) this._top    = top;
    if (bottom !== undefined) this._bottom = bottom;
    if (startTime !== undefined) this._startT = startTime;
    if (endTime   !== undefined) this._endT   = endTime;
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

    // If endTime provided use it; else extend to chart right edge
    let x2;
    if (p._endT) {
      x2 = chart.timeScale().timeToCoordinate(p._endT);
    } else {
      // Extend zone to visible right edge
      const vr = chart.timeScale().getVisibleRange();
      x2 = vr ? chart.timeScale().timeToCoordinate(vr.to) : x1 + 5000;
    }

    if (y1 === null || y2 === null || x1 === null) {
      this._coords = null;
      return;
    }
    this._coords = { x1, y1: Math.min(y1, y2), x2, y2: Math.max(y1, y2) };
  }

  renderer() {
    const coords = this._coords;
    const fill   = this._prim._fill;
    const border = this._prim._border;

    return {
      draw(target) {
        if (!coords) return;
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          const { x1, y1, x2, y2 } = coords;
          const rx1 = Math.round(x1 * hpr);
          const ry1 = Math.round(y1 * vpr);
          const rw  = Math.round((x2 - x1) * hpr);
          const rh  = Math.round((y2 - y1) * vpr);
          ctx.save();
          ctx.fillStyle = fill;
          ctx.fillRect(rx1, ry1, rw, rh);
          if (border) {
            ctx.strokeStyle = border;
            ctx.lineWidth   = 1;
            ctx.strokeRect(rx1, ry1, rw, rh);
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
    this._mainEl    = document.getElementById(mainContainerId);
    this._volEl     = document.getElementById(volContainerId);
    this._chart     = null;
    this._volChart  = null;
    this._candles   = null;
    this._vol       = null;
    this._markers   = [];
    this._primitives = {}; // id → primitive instance
    this._zoneLayer  = null; // series used to attach zone primitives
    this._theme      = 'dark';
  }

  // ─── Initialization ───────────────────────────────────────────

  init(theme = 'dark') {
    this._theme = theme;
    const colors = this._colors(theme);

    // Main chart
    this._chart = LightweightCharts.createChart(this._mainEl, {
      layout: {
        background: { type: 'solid', color: colors.bg },
        textColor: colors.text,
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: 12,
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
        scaleMargins: { top: 0.1, bottom: 0.15 },
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => {
          const d = new Date(time * 1000);
          return `${d.getUTCMonth()+1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
        },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      autoSize: true,
    });

    // Candlestick series
    this._candles = this._chart.addCandlestickSeries({
      upColor:          colors.bullCandle,
      downColor:        colors.bearCandle,
      borderUpColor:    colors.bullCandle,
      borderDownColor:  colors.bearCandle,
      wickUpColor:      colors.bullCandle,
      wickDownColor:    colors.bearCandle,
    });

    // Invisible line series used as host for zone primitives
    this._zoneLayer = this._chart.addLineSeries({
      color:         'transparent',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Volume chart
    if (this._volEl) {
      this._volChart = LightweightCharts.createChart(this._volEl, {
        layout: { background: { type: 'solid', color: colors.bg }, textColor: colors.text },
        grid:   { vertLines: { color: 'transparent' }, horzLines: { color: 'transparent' } },
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

      // Sync time scales
      this._chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) this._volChart.timeScale().setVisibleLogicalRange(range);
      });
      this._volChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) this._chart.timeScale().setVisibleLogicalRange(range);
      });
    }

    // Responsive resize observer
    this._resizeObserver = new ResizeObserver(() => this._chart.applyOptions({ autoSize: true }));
    this._resizeObserver.observe(this._mainEl);
  }

  // ─── Data Loading ─────────────────────────────────────────────

  setHistory(candles) {
    if (!this._candles) return;
    // Remove duplicate times and sort
    const unique = [];
    const seen   = new Set();
    for (const c of candles) {
      if (!seen.has(c.time)) { seen.add(c.time); unique.push(c); }
    }
    unique.sort((a, b) => a.time - b.time);

    this._candles.setData(unique);
    if (this._vol) {
      this._vol.setData(unique.map(c => ({
        time:  c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      })));
    }
    this._chart.timeScale().fitContent();
  }

  updateCandle(candle) {
    if (!this._candles) return;
    this._candles.update(candle);
    if (this._vol && candle.volume != null) {
      this._vol.update({
        time:  candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      });
    }
  }

  // ─── Signal Markers ───────────────────────────────────────────

  addSignalMarker({ time, type, text = '' }) {
    this._markers.push({
      time,
      position:  type === 'BUY' ? 'belowBar' : 'aboveBar',
      color:     type === 'BUY' ? '#26a69a'  : '#ef5350',
      shape:     type === 'BUY' ? 'arrowUp'  : 'arrowDown',
      text:      text || type,
      size:      2,
    });
    // Keep last 50 markers
    if (this._markers.length > 50) this._markers.shift();
    this._candles.setMarkers(this._markers);
  }

  clearMarkers() {
    this._markers = [];
    this._candles?.setMarkers([]);
  }

  // ─── Zone Overlays ────────────────────────────────────────────

  /**
   * Draw all SMC zones from an SMCResult.
   * Clears previous zones before drawing.
   */
  drawSMCZones(smcResult) {
    if (!this._zoneLayer) return;

    // Detach old primitives
    for (const prim of Object.values(this._primitives)) {
      try { this._zoneLayer.detachPrimitive(prim); } catch {}
    }
    this._primitives = {};

    const {
      orderBlocks, fvgs, srZones, equalHighs, equalLows,
      swingHighs, swingLows,
    } = smcResult;

    const canvasEnd = this._futureTime(50); // extend zones 50 bars into future

    // Order Blocks
    orderBlocks.forEach((ob, i) => {
      const color  = ob.type === 'BULLISH_OB'
        ? 'rgba(38,166,154,0.18)'
        : 'rgba(239,83,80,0.18)';
      const border = ob.type === 'BULLISH_OB' ? '#26a69a' : '#ef5350';
      const prim   = new RectZonePrimitive(ob.top, ob.bottom, ob.time, canvasEnd, color, border);
      const id     = `ob_${i}`;
      this._primitives[id] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });

    // Fair Value Gaps
    fvgs.forEach((fvg, i) => {
      const color  = fvg.type === 'BULLISH_FVG'
        ? 'rgba(255,193,7,0.12)'
        : 'rgba(156,39,176,0.12)';
      const border = fvg.type === 'BULLISH_FVG' ? '#ffc107' : '#9c27b0';
      const prim   = new RectZonePrimitive(fvg.top, fvg.bottom, fvg.time, canvasEnd, color, border);
      const id     = `fvg_${i}`;
      this._primitives[id] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });

    // S/R Zones (top 6)
    srZones.slice(0, 6).forEach((zone, i) => {
      const alpha  = Math.min(0.15, zone.strength * 0.025);
      const color  = zone.type === 'RESISTANCE'
        ? `rgba(239,83,80,${alpha})`
        : `rgba(38,166,154,${alpha})`;
      const border = zone.type === 'RESISTANCE' ? 'rgba(239,83,80,0.4)' : 'rgba(38,166,154,0.4)';
      const prim   = new RectZonePrimitive(zone.top, zone.bottom, zone.times[0], canvasEnd, color, border);
      const id     = `sr_${i}`;
      this._primitives[id] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });

    // Equal High lines (dashed price lines)
    this._priceLinesCache = this._priceLinesCache || [];
    for (const pl of this._priceLinesCache) {
      try { this._candles.removePriceLine(pl); } catch {}
    }
    this._priceLinesCache = [];

    equalHighs.slice(0, 5).forEach(z => {
      const pl = this._candles.createPriceLine({
        price: z.price,
        color: 'rgba(239,83,80,0.7)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'EQH',
      });
      this._priceLinesCache.push(pl);
    });

    equalLows.slice(0, 5).forEach(z => {
      const pl = this._candles.createPriceLine({
        price: z.price,
        color: 'rgba(38,166,154,0.7)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'EQL',
      });
      this._priceLinesCache.push(pl);
    });
  }

  // ─── SL / TP Lines ───────────────────────────────────────────

  showSLTPLines({ stopLoss, takeProfit, entryPrice }) {
    if (this._slLine) try { this._candles.removePriceLine(this._slLine); } catch {}
    if (this._tpLine) try { this._candles.removePriceLine(this._tpLine); } catch {}
    if (this._entLine) try { this._candles.removePriceLine(this._entLine); } catch {}

    if (entryPrice) this._entLine = this._candles.createPriceLine({
      price: entryPrice, color: '#ffffff', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'Entry',
    });
    if (stopLoss) this._slLine = this._candles.createPriceLine({
      price: stopLoss, color: '#ef5350', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'SL',
    });
    if (takeProfit) this._tpLine = this._candles.createPriceLine({
      price: takeProfit, color: '#26a69a', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'TP',
    });
  }

  clearSLTPLines() {
    if (this._slLine)  try { this._candles.removePriceLine(this._slLine);  } catch {}
    if (this._tpLine)  try { this._candles.removePriceLine(this._tpLine);  } catch {}
    if (this._entLine) try { this._candles.removePriceLine(this._entLine); } catch {}
    this._slLine = this._tpLine = this._entLine = null;
  }

  // ─── Theme Switching ──────────────────────────────────────────

  setTheme(theme) {
    this._theme = theme;
    const colors = this._colors(theme);
    this._chart.applyOptions({
      layout: { background: { color: colors.bg }, textColor: colors.text },
      grid:   { vertLines: { color: colors.gridLine }, horzLines: { color: colors.gridLine } },
      crosshair: { vertLine: { labelBackgroundColor: colors.labelBg }, horzLine: { labelBackgroundColor: colors.labelBg } },
    });
    this._volChart?.applyOptions({
      layout: { background: { color: colors.bg }, textColor: colors.text },
    });
  }

  // ─── Utilities ────────────────────────────────────────────────

  _futureTime(bars = 50) {
    // Estimate future time based on last visible range
    const vr = this._chart?.timeScale().getVisibleRange();
    if (vr) return vr.to + bars * 3600; // rough offset
    return Math.floor(Date.now() / 1000) + bars * 3600;
  }

  fitContent() {
    this._chart?.timeScale().fitContent();
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this._chart?.remove();
    this._volChart?.remove();
  }

  _colors(theme) {
    return theme === 'dark' ? {
      bg:         '#0f1117',
      text:       '#d1d4dc',
      gridLine:   '#1e2232',
      border:     '#2a2d3a',
      crosshair:  '#485c7b',
      labelBg:    '#1e2232',
      bullCandle: '#26a69a',
      bearCandle: '#ef5350',
      volBar:     'rgba(100,120,180,0.4)',
    } : {
      bg:         '#ffffff',
      text:       '#1a1a2e',
      gridLine:   '#f0f3fa',
      border:     '#d0d4e0',
      crosshair:  '#9098a3',
      labelBg:    '#f0f3fa',
      bullCandle: '#0d9488',
      bearCandle: '#dc2626',
      volBar:     'rgba(60,100,180,0.3)',
    };
  }
}
