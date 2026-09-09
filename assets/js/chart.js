/**
 * chart.js — TradersZone.ai Lightweight Charts v4 Wrapper
 *
 * Implements:
 *   - Yashwanth's Pine Script v6 S/R Horizon Boxes (connected to candle bodies, not wicks)
 *   - Resistance: Cyan (#00bcd4) / Support: Yellow (#ffeb3b) with Anti-Stacking & Breach Freeze
 *   - Visible BUY (green arrow) and SELL (red arrow) markers across historical & live candles
 *   - Instant zero-lag Light/Dark theme switching
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
            ctx.lineWidth = 1.2;
            ctx.strokeRect(rx1, ry1, rw, rh);
          }

          if (label && rw > 45 && rh > 10) {
            ctx.fillStyle = border || '#ffffff';
            ctx.font = `bold ${Math.round(10 * vpr)}px 'JetBrains Mono', monospace`;
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
    this._buoyancyOverlay = document.getElementById('chart-buoyancy-overlay');
    this._chart = null;
    this._volChart = null;
    this._candles = null;
    this._vol = null;
    this._markers = [];
    this._primitives = {};
    this._zonePrimitives = [];
    this._projectionPrimitives = [];
    this._priceLines = [];
    this._zoneLayer = null;
    this._theme = 'dark';
  }

  init(theme = 'dark') {
    this._theme = theme;
    const colors = this._colors(theme);

    // Main Candlestick Chart
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

  // ─── PINE SCRIPT v6 S/R HORIZON BOXES ─────────────────────────────
  drawHorizonBoxes(horizonZones) {
    if (!this._zoneLayer || !horizonZones) return;

    // Clear old zone primitives
    for (const p of this._zonePrimitives) {
      try { this._zoneLayer.detachPrimitive(p); } catch {}
    }
    this._zonePrimitives = [];

    // Filter to latest active and recently breached zones
    const activeZones = horizonZones.slice(-14);

    activeZones.forEach(z => {
      const isRes = z.isResistance;
      // Exact Pine Script Colors
      // Resistance: Cyan #00bcd4 / Support: Yellow #ffeb3b
      const fill = isRes ? 'rgba(0, 188, 212, 0.14)' : 'rgba(255, 235, 59, 0.14)';
      const border = isRes ? '#00bcd4' : '#ffeb3b';
      const label = isRes ? (z.isBreached ? 'RES [Breached]' : 'RESISTANCE') : (z.isBreached ? 'SUP [Breached]' : 'SUPPORT');

      const prim = new RectZonePrimitive(
        z.top,
        z.bottom,
        z.originTime,
        z.endTime,
        fill,
        border,
        label
      );

      this._zoneLayer.attachPrimitive(prim);
      this._zonePrimitives.push(prim);
    });
  }

  // ─── BUY & SELL SIGNAL MARKERS ───────────────────────────────────
  setAllMarkers(markers) {
    this._markers = markers.map(m => ({
      time: m.time,
      position: m.type === 'BUY' ? 'belowBar' : 'aboveBar',
      color: m.type === 'BUY' ? '#00f090' : '#ff3366',
      shape: m.type === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: m.type === 'BUY' ? 'BUY ▲' : 'SELL ▼',
      size: 2,
    }));
    this._candles?.setMarkers(this._markers);
  }

  addSignalMarker({ time, type, text = '' }) {
    const existing = this._markers.find(m => m.time === time);
    if (existing) return;

    this._markers.push({
      time,
      position: type === 'BUY' ? 'belowBar' : 'aboveBar',
      color: type === 'BUY' ? '#00f090' : '#ff3366',
      shape: type === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: text || (type === 'BUY' ? 'BUY ▲' : 'SELL ▼'),
      size: 2,
    });
    if (this._markers.length > 50) this._markers.shift();
    this._candles?.setMarkers(this._markers);
  }

  clearMarkers() {
    this._markers = [];
    this._candles?.setMarkers([]);
  }

  // ─── FORWARD-PROJECTED TARGET & STOP BOXES ───────────────────────
  drawProjectionZones({ entry, target, stop, verdict, startTime }) {
    if (!this._zoneLayer || !target || !stop) return;
    this.clearProjectionZones();

    const futureTime = (startTime || Math.floor(Date.now() / 1000)) + 3600 * 20;

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

    this._renderBuoyancyLevelCards({ entry, target, stop, verdict });
  }

  _renderBuoyancyLevelCards({ entry, target, stop, verdict }) {
    if (!this._buoyancyOverlay || !this._candles) return;
    this._buoyancyOverlay.innerHTML = '';

    const yTP = this._candles.priceToCoordinate(target) || 70;
    const ySL = this._candles.priceToCoordinate(stop) || 240;
    const yEntry = this._candles.priceToCoordinate(entry) || 150;
    const targetPct = entry ? +(((Math.abs(target - entry)) / entry) * 100).toFixed(2) : 0;

    this._buoyancyOverlay.innerHTML = `
      <div class="chip-pct" style="top: ${Math.max(10, yTP - 26)}px; right: clamp(15px, 12vw, 90px);">+${targetPct}% Target</div>
      <div class="lvlcard tp-lvlcard" id="card-tp" style="top: ${Math.max(15, yTP - 14)}px; right: clamp(15px, 12vw, 90px);" title="Drag to adjust Take Profit">
        <span class="bdg tp">TP</span>
        <span class="val tp">${target}</span>
        <span class="grip">⋮ ⋮</span>
      </div>
      <div class="entry-tag" style="top: ${Math.max(20, yEntry - 10)}px; right: clamp(15px, 12vw, 90px);">Entry: ${entry}</div>
      <div class="lvlcard sl-lvlcard" id="card-sl" style="top: ${Math.max(25, ySL - 14)}px; right: clamp(15px, 12vw, 90px);" title="Drag to adjust Stop Loss">
        <span class="bdg sl">SL</span>
        <span class="val sl">${stop}</span>
        <span class="grip">⋮ ⋮</span>
      </div>
    `;

    this._makeDraggable('card-tp', (newY) => {
      const newPrice = this._candles.coordinateToPrice(newY);
      if (newPrice) {
        const valEl = document.querySelector('#card-tp .val.tp');
        if (valEl) valEl.textContent = newPrice.toFixed(2);
        this.showSLTPLines({ entryPrice: entry, stopLoss: stop, takeProfit: newPrice });
      }
    });

    this._makeDraggable('card-sl', (newY) => {
      const newPrice = this._candles.coordinateToPrice(newY);
      if (newPrice) {
        const valEl = document.querySelector('#card-sl .val.sl');
        if (valEl) valEl.textContent = newPrice.toFixed(2);
        this.showSLTPLines({ entryPrice: entry, stopLoss: newPrice, takeProfit: target });
      }
    });
  }

  _makeDraggable(id, onDrag) {
    const el = document.getElementById(id);
    if (!el) return;

    const startDrag = (startY) => {
      const origTop = el.offsetTop;

      const onMove = (clientY) => {
        const deltaY = clientY - startY;
        const overlayH = this._buoyancyOverlay?.clientHeight || 300;
        const newTop = Math.max(10, Math.min(overlayH - 30, origTop + deltaY));
        el.style.top = `${newTop}px`;
        if (onDrag) onDrag(newTop);
      };

      const onMouseMove = (e) => onMove(e.clientY);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      const onTouchMove = (e) => {
        if (e.touches && e.touches[0]) {
          onMove(e.touches[0].clientY);
        }
      };
      const onTouchEnd = () => {
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onTouchEnd);
    };

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDrag(e.clientY);
    });

    el.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        startDrag(e.touches[0].clientY);
      }
    }, { passive: true });
  }

  clearProjectionZones() {
    for (const p of this._projectionPrimitives) {
      try { this._zoneLayer.detachPrimitive(p); } catch {}
    }
    this._projectionPrimitives = [];
    if (this._buoyancyOverlay) {
      this._buoyancyOverlay.innerHTML = '';
    }
  }

  resize() {
    if (this._chart && this._mainEl) {
      const w = this._mainEl.clientWidth;
      const h = this._mainEl.clientHeight;
      if (w > 0 && h > 0) {
        this._chart.resize(w, h);
      }
    }
    if (this._volChart && this._volEl) {
      const vw = this._volEl.clientWidth;
      const vh = this._volEl.clientHeight;
      if (vw > 0 && vh > 0) {
        this._volChart.resize(vw, vh);
      }
    }
  }

  showSLTPLines({ entryPrice, stopLoss, takeProfit }) {
    this.clearSLTPLines();
    const isDark = this._theme === 'dark';

    if (entryPrice) {
      this._entLine = this._candles.createPriceLine({
        price: entryPrice, color: isDark ? '#ffffff' : '#0f172a',
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

  // ─── INSTANT ZERO-LAG THEME UPDATE ───────────────────────────────
  setTheme(theme) {
    this._theme = theme;
    const colors = this._colors(theme);

    if (this._chart) {
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
    }

    if (this._candles) {
      this._candles.applyOptions({
        upColor: colors.bullCandle,
        downColor: colors.bearCandle,
        borderUpColor: colors.bullCandle,
        borderDownColor: colors.bearCandle,
        wickUpColor: colors.bullCandle,
        wickDownColor: colors.bearCandle,
      });
    }

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
      bg: '#03060f',
      text: '#94a3b8',
      gridLine: 'rgba(255, 255, 255, 0.02)',
      border: '#162238',
      crosshair: '#00d4ff',
      labelBg: '#080d18',
      bullCandle: '#00f090',
      bearCandle: '#ff3366',
      volBar: 'rgba(0, 212, 255, 0.35)',
    } : {
      bg: '#ffffff',
      text: '#334155',
      gridLine: '#edf1f7',
      border: '#d8e0ec',
      crosshair: '#0284c7',
      labelBg: '#f8fafc',
      bullCandle: '#059669',
      bearCandle: '#dc2626',
      volBar: 'rgba(2, 132, 199, 0.35)',
    };
  }
}
