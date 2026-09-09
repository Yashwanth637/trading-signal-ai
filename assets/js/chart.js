/**
 * chart.js — TradersZone.ai Lightweight Charts v4 Wrapper
 *
 * Full dynamic Light/Dark theme toggling, clean symbol switching,
 * forward-projected shaded TP/SL zones, and SMC structural markers.
 */

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
      x2 = vr ? chart.timeScale().timeToCoordinate(vr.to) : (x1 ? x1 + 1000 : 1000);
    }

    if (y1 === null || y2 === null || x1 === null) {
      this._coords = null;
      return;
    }
    this._coords = { x1, y1: Math.min(y1, y2), x2: x2 || x1 + 300, y2: Math.max(y1, y2) };
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
            ctx.lineWidth = 1;
            ctx.strokeRect(rx1, ry1, rw, rh);
          }

          if (label && rw > 40 && rh > 12) {
            ctx.fillStyle = border || '#ffffff';
            ctx.font = `${Math.round(10 * vpr)}px 'JetBrains Mono', monospace`;
            ctx.fillText(label, rx1 + 6 * hpr, ry1 + 12 * vpr);
          }
          ctx.restore();
        });
      },
    };
  }
}

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

    // Main Chart
    this._chart = LightweightCharts.createChart(this._mainEl, {
      layout: {
        background: { type: 'solid', color: colors.bg },
        textColor: colors.text,
        fontFamily: "'Inter', sans-serif",
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
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    this._candles = this._chart.addCandlestickSeries({
      upColor: colors.bullCandle,
      downColor: colors.bearCandle,
      borderUpColor: colors.bullCandle,
      borderDownColor: colors.bearCandle,
      wickUpColor: colors.bullCandle,
      wickDownColor: colors.bearCandle,
    });

    this._zoneLayer = this._chart.addLineSeries({
      color: 'transparent',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

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

    new ResizeObserver(() => {
      this._chart.applyOptions({ autoSize: true });
      this._volChart?.applyOptions({ autoSize: true });
    }).observe(this._mainEl);
  }

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
        color: c.close >= c.open ? 'rgba(0, 240, 144, 0.4)' : 'rgba(255, 51, 102, 0.4)',
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
        color: candle.close >= candle.open ? 'rgba(0, 240, 144, 0.4)' : 'rgba(255, 51, 102, 0.4)',
      });
    }
  }

  drawProjectionZones({ entry, target, stop, verdict, startTime }) {
    if (!this._zoneLayer || !target || !stop) return;
    this.clearProjectionZones();

    const futureTime = (startTime || Math.floor(Date.now() / 1000)) + 3600 * 25;

    if (verdict === 'BUY' || verdict === 'LONG') {
      const tpPrim = new RectZonePrimitive(target, entry, startTime, futureTime, 'rgba(0, 240, 144, 0.16)', '#00f090', `TP: ${target}`);
      const slPrim = new RectZonePrimitive(entry, stop, startTime, futureTime, 'rgba(255, 51, 102, 0.16)', '#ff3366', `SL: ${stop}`);
      this._zoneLayer.attachPrimitive(tpPrim);
      this._zoneLayer.attachPrimitive(slPrim);
      this._projectionPrimitives.push(tpPrim, slPrim);
    } else if (verdict === 'SELL' || verdict === 'SHORT') {
      const tpPrim = new RectZonePrimitive(entry, target, startTime, futureTime, 'rgba(0, 240, 144, 0.16)', '#00f090', `TP: ${target}`);
      const slPrim = new RectZonePrimitive(stop, entry, startTime, futureTime, 'rgba(255, 51, 102, 0.16)', '#ff3366', `SL: ${stop}`);
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

  drawSMCZones(smcResult) {
    if (!this._zoneLayer || !smcResult) return;
    for (const prim of Object.values(this._primitives)) {
      try { this._zoneLayer.detachPrimitive(prim); } catch {}
    }
    this._primitives = {};

    const { orderBlocks = [], fvgs = [] } = smcResult;
    const futureTime = Math.floor(Date.now() / 1000) + 3600 * 15;

    orderBlocks.slice(-4).forEach((ob, i) => {
      const isBull = ob.type === 'BULLISH_OB';
      const prim = new RectZonePrimitive(ob.top, ob.bottom, ob.time, futureTime, isBull ? 'rgba(0, 212, 255, 0.14)' : 'rgba(168, 85, 247, 0.14)', isBull ? '#00d4ff' : '#a855f7', isBull ? 'OB' : 'OB');
      this._primitives[`ob_${i}`] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });

    fvgs.slice(-4).forEach((fvg, i) => {
      const isBull = fvg.type === 'BULLISH_FVG';
      const prim = new RectZonePrimitive(fvg.top, fvg.bottom, fvg.time, futureTime, isBull ? 'rgba(255, 193, 7, 0.10)' : 'rgba(233, 30, 99, 0.10)', isBull ? '#ffc107' : '#e91e63', 'FVG');
      this._primitives[`fvg_${i}`] = prim;
      this._zoneLayer.attachPrimitive(prim);
    });
  }

  addSignalMarker({ time, type, text = '' }) {
    this._markers.push({
      time,
      position: type === 'BUY' || type === 'LONG' ? 'belowBar' : 'aboveBar',
      color: type === 'BUY' || type === 'LONG' ? '#00f090' : '#ff3366',
      shape: type === 'BUY' || type === 'LONG' ? 'arrowUp' : 'arrowDown',
      text: text || type,
      size: 2,
    });
    if (this._markers.length > 40) this._markers.shift();
    this._candles.setMarkers(this._markers);
  }

  clearMarkers() {
    this._markers = [];
    this._candles?.setMarkers([]);
  }

  showSLTPLines({ entryPrice, stopLoss, takeProfit }) {
    this.clearSLTPLines();
    if (entryPrice) {
      this._entLine = this._candles.createPriceLine({
        price: entryPrice, color: this._theme === 'dark' ? '#ffffff' : '#0f172a',
        lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'Entry',
      });
    }
    if (stopLoss) {
      this._slLine = this._candles.createPriceLine({
        price: stopLoss, color: '#ff3366',
        lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'SL',
      });
    }
    if (takeProfit) {
      this._tpLine = this._candles.createPriceLine({
        price: takeProfit, color: '#00f090',
        lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'TP',
      });
    }
  }

  clearSLTPLines() {
    if (this._slLine) try { this._candles.removePriceLine(this._slLine); } catch {}
    if (this._tpLine) try { this._candles.removePriceLine(this._tpLine); } catch {}
    if (this._entLine) try { this._candles.removePriceLine(this._entLine); } catch {}
    this._slLine = this._tpLine = this._entLine = null;
  }

  // ─── FULL DYNAMIC LIGHT / DARK THEME TOGGLE ──────────────────────
  setTheme(theme) {
    this._theme = theme;
    const colors = this._colors(theme);

    this._chart.applyOptions({
      layout: {
        background: { type: 'solid', color: colors.bg },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.gridLine },
        horzLines: { color: colors.gridLine },
      },
      crosshair: {
        vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
        horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    });

    this._candles.applyOptions({
      upColor: colors.bullCandle,
      downColor: colors.bearCandle,
      borderUpColor: colors.bullCandle,
      borderDownColor: colors.bearCandle,
      wickUpColor: colors.bullCandle,
      wickDownColor: colors.bearCandle,
    });

    if (this._volChart) {
      this._volChart.applyOptions({
        layout: { background: { type: 'solid', color: colors.bg }, textColor: colors.text },
        rightPriceScale: { borderColor: colors.border },
        timeScale: { borderColor: colors.border },
      });
    }
  }

  _colors(theme) {
    return theme === 'dark' ? {
      bg: '#03060f', // TradersZone Obsidian
      text: '#94a3b8',
      gridLine: 'rgba(255, 255, 255, 0.02)',
      border: '#151f33',
      crosshair: '#00d4ff',
      labelBg: '#0a101d',
      bullCandle: '#00f090',
      bearCandle: '#ff3366',
      volBar: 'rgba(0, 212, 255, 0.35)',
    } : {
      bg: '#ffffff', // Clean Pure White Light Mode
      text: '#334155',
      gridLine: '#f1f5f9',
      border: '#e2e8f0',
      crosshair: '#0284c7',
      labelBg: '#f8fafc',
      bullCandle: '#059669',
      bearCandle: '#e11d48',
      volBar: 'rgba(2, 132, 199, 0.35)',
    };
  }
}
