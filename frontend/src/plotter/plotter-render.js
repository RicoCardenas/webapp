import { debounce } from '../lib/events.js';
import { distance2D, formatTick, niceStep } from '../lib/math.js';
import { BODY_LOCK_CLASS, FULLSCREEN_CLASS } from './plotter-config.js';

/**
 * @typedef {ReturnType<typeof import('./plotter-core.js').createPlotterCore>} PlotterCore
 */

/**
 * @param {{
 *  container: HTMLElement,
 *  core: PlotterCore,
 *  onHover?: (data: { x: number, y: number }) => void,
 *  onHoverEnd?: () => void,
 *  onMarker?: (data: { exprId: string, label: string, color: string, x: number, y: number }) => void,
 * }} params
 */
export function createPlotterRenderer(params) {
  const { container, core, onHover, onHoverEnd, onMarker } = params;

  let canvas = /** @type {HTMLCanvasElement|null} */ (container.querySelector('canvas'));
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'plotter-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is required for the plotter');

  let dpi = window.devicePixelRatio || 1;
  let raf = 0;
  let isPanning = false;
  let panMoved = false;
  const panStart = { x: 0, y: 0 };
  let panSnapshot = core.getView();

  // Gestos táctiles
  const pointers = new Map();
  let initialPinchDistance = 0;
  let pinchCenter = { x: 0, y: 0 };

  const hoverState = {
    active: false,
    x: 0,
    y: 0,
    exprId: '',
  };

  const supportsResizeObserver = typeof window !== 'undefined' && typeof window.ResizeObserver === 'function';
  const resizeObserver = supportsResizeObserver
    ? new ResizeObserver(
        debounce(() => {
          fixDpi();
          enforceSquareAspect();
          requestRender();
        }, 50)
      )
    : null;

  if (resizeObserver) {
    resizeObserver.observe(container);
  }

  const handleWindowResize = debounce(() => {
    fixDpi();
    enforceSquareAspect();
    requestRender();
  }, 100);

  window.addEventListener('resize', handleWindowResize);

  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleCanvasMove);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  canvas.addEventListener('click', handleCanvasClick);
  window.addEventListener('mousemove', handleWindowMove);
  window.addEventListener('mouseup', handleMouseUp);

  canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
  canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerCancel);

  fixDpi();
  enforceSquareAspect();
  requestRender();

  function width() {
    return canvas?.clientWidth || 800;
  }

  function height() {
    return canvas?.clientHeight || 500;
  }

  function worldToScreen(x, y) {
    const view = core.getView();
    const w = width() * dpi;
    const h = height() * dpi;
    const sx = (x - view.xmin) * (w / (view.xmax - view.xmin));
    const sy = (view.ymax - y) * (h / (view.ymax - view.ymin));
    return [sx, sy];
  }

  function screenToWorld(sx, sy) {
    const view = core.getView();
    const w = width() * dpi;
    const h = height() * dpi;
    const x = sx / (w / (view.xmax - view.xmin)) + view.xmin;
    const y = view.ymax - sy / (h / (view.ymax - view.ymin));
    return [x, y];
  }

  function requestRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderAll();
    });
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawGridAndAxes() {
    const view = core.getView();
    if (!view.gridOn) return;

    const w = width() * dpi;
    const h = height() * dpi;
    const spanX = view.xmax - view.xmin;
    const spanY = view.ymax - view.ymin;
    const baseStep = niceStep(Math.min(spanX, spanY));
    const stepX = baseStep;
    const stepY = baseStep;

  ctx.save();
  const styles = getComputedStyle(container || document.body);
  const gridLine = (styles.getPropertyValue('--grid-line') || 'rgba(148, 163, 184, 0.2)').trim();
  const gridAxis = (styles.getPropertyValue('--grid-axis') || 'rgba(148, 163, 184, 0.5)').trim();
  const gridText = (styles.getPropertyValue('--grid-text') || 'rgba(148, 163, 184, 0.7)').trim();
    ctx.scale(1, 1);
  ctx.lineWidth = 1 * dpi;
  ctx.strokeStyle = gridLine;

    const drawLines = (axis, step, min, max, drawFn) => {
      let start = Math.ceil(min / step) * step;
      if (!isFinite(start)) start = 0;

      for (let value = start; value <= max; value += step) {
        drawFn(value);
      }
    };

    drawLines('x', stepX, view.xmin, view.xmax, (value) => {
      const [sx] = worldToScreen(value, view.ymin);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
    });

    drawLines('y', stepY, view.ymin, view.ymax, (value) => {
      const [, sy] = worldToScreen(view.xmin, value);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
    });

  ctx.strokeStyle = gridAxis;
    ctx.lineWidth = 1.5 * dpi;

    // eje X
    const [, axisY] = worldToScreen(view.xmin, 0);
    const hasXAxis = axisY >= 0 && axisY <= h;
    if (hasXAxis) {
      ctx.beginPath();
      ctx.moveTo(0, axisY);
      ctx.lineTo(w, axisY);
      ctx.stroke();
    }

    // eje Y
    const [axisX] = worldToScreen(0, view.ymin);
    const hasYAxis = axisX >= 0 && axisX <= w;
    if (hasYAxis) {
      ctx.beginPath();
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, h);
      ctx.stroke();
    }

  ctx.fillStyle = gridText;
  ctx.font = `${12 * dpi}px Inter, system-ui, sans-serif`;

    drawLines('x-labels', stepX, view.xmin, view.xmax, (value) => {
      const [sx] = worldToScreen(value, view.ymin);
      let labelY;
      if (hasXAxis) {
        const offset = axisY < h / 2 ? 10 * dpi : -10 * dpi;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        labelY = axisY + offset;
      } else {
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';
        labelY = h - 18 * dpi;
      }
      ctx.fillText(formatTick(value), sx, labelY);
    });

    drawLines('y-labels', stepY, view.ymin, view.ymax, (value) => {
      const [, sy] = worldToScreen(view.xmin, value);
      let labelX;
      if (hasYAxis) {
        const offset = axisX > w / 2 ? -10 * dpi : 10 * dpi;
        ctx.textBaseline = 'middle';
        ctx.textAlign = axisX > w / 2 ? 'right' : 'left';
        labelX = axisX + offset;
      } else {
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        labelX = 8 * dpi;
      }
      ctx.fillText(formatTick(value), labelX, sy);
    });

    ctx.restore();
  }

  function renderExpressions() {
    const expressions = core.expressions;
    const view = core.getView();
    const w = width() * dpi;
    const ySpan = view.ymax - view.ymin;
    const step = Math.max(0.001, (view.xmax - view.xmin) / (w * 0.75));
    const sampleStep = Math.max(step, 0.002);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2 * dpi;

    const X_LIMIT = view.xmax + 20 * step;
    const Y_LIMIT = ySpan * 6;

    expressions.forEach((expr) => {
      if (!expr.visible) return;

      ctx.beginPath();
      ctx.strokeStyle = expr.color;

      let x1 = view.xmin;
      let y1 = evaluateSafely(expr.compiled, x1);
      let isDrawing = false;

      for (let x = view.xmin + sampleStep; x <= X_LIMIT; x += sampleStep) {
        const y2 = evaluateSafely(expr.compiled, x);
        const [sx1, sy1] = worldToScreen(x1, y1);
        const [sx2, sy2] = worldToScreen(x, y2);

        if (
          y1 == null ||
          y2 == null ||
          !isFinite(sx1) ||
          !isFinite(sx2) ||
          Math.abs(y1) > Y_LIMIT ||
          Math.abs(y2) > Y_LIMIT
        ) {
          if (isDrawing) {
            ctx.stroke();
            ctx.beginPath();
            isDrawing = false;
          }
          x1 = x;
          y1 = y2;
          continue;
        }

        if (!isDrawing) {
          ctx.moveTo(sx1, sy1);
          isDrawing = true;
        }

        ctx.lineTo(sx2, sy2);
        x1 = x;
        y1 = y2;
      }

      if (isDrawing) {
        ctx.stroke();
      }
    });
  }

  function evaluateSafely(compiled, x) {
    try {
      const y = compiled.evaluate({ x });
      return typeof y === 'number' && isFinite(y) ? y : null;
    } catch {
      return null;
    }
  }

  function renderMarkers() {
    const markers = core.markers;
    if (!markers.length) return;

    ctx.save();
    ctx.font = `${12 * dpi}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';

    markers.forEach((marker) => {
      const [sx, sy] = worldToScreen(marker.x, marker.y);
      ctx.beginPath();
      ctx.fillStyle = marker.color;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2 * dpi;
      ctx.arc(sx, sy, 5 * dpi, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5f5';
      ctx.fillText(
        `${marker.label} (${marker.x.toFixed(2)}, ${marker.y.toFixed(2)})`,
        sx + 8 * dpi,
        sy - 6 * dpi
      );
    });
    ctx.restore();
  }

  function renderAll() {
    clearCanvas();
    drawGridAndAxes();
    renderExpressions();
    renderMarkers();
  }

  function fixDpi() {
    dpi = window.devicePixelRatio || 1;
    const w = Math.floor(width() * dpi);
    const h = Math.floor(height() * dpi);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function enforceSquareAspect() {
    const w = width();
    const h = height();
    if (!w || !h) return;

    const view = core.getView();
    const spanX = view.xmax - view.xmin;
    const spanY = view.ymax - view.ymin;
    if (spanX === 0 || spanY === 0) return;

    const canvasAspect = w / h;
    const viewAspect = spanX / spanY;
    if (Math.abs(canvasAspect - viewAspect) < 0.0001) return;

    if (viewAspect > canvasAspect) {
      const midY = (view.ymax + view.ymin) / 2;
      const newSpanY = spanX / canvasAspect;
      const half = newSpanY / 2;
      core.setViewBounds({
        xmin: view.xmin,
        xmax: view.xmax,
        ymin: midY - half,
        ymax: midY + half,
      });
    } else {
      const midX = (view.xmax + view.xmin) / 2;
      const newSpanX = spanY * canvasAspect;
      const half = newSpanX / 2;
      core.setViewBounds({
        xmin: midX - half,
        xmax: midX + half,
        ymin: view.ymin,
        ymax: view.ymax,
      });
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const point = eventToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const factor = event.deltaY > 0 ? 1.1 : 0.9;
    core.zoomAt(point, factor);
    enforceSquareAspect();
    requestRender();
  }

  function handleMouseDown(event) {
    if (event.button !== 0) return;
    isPanning = true;
    panMoved = false;
    panStart.x = event.clientX;
    panStart.y = event.clientY;
    panSnapshot = core.getView();
    canvas.style.cursor = 'grabbing';
  }

  function handleWindowMove(event) {
    if (!isPanning) return;
    event.preventDefault();
    const dxPx = event.clientX - panStart.x;
    const dyPx = event.clientY - panStart.y;
    panMoved = panMoved || Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2;
    const [dx, dy] = screenDeltaToWorld(dxPx, dyPx);
    core.setViewBounds({
      xmin: panSnapshot.xmin - dx,
      xmax: panSnapshot.xmax - dx,
      ymin: panSnapshot.ymin + dy,
      ymax: panSnapshot.ymax + dy,
    });
    enforceSquareAspect();
    requestRender();
  }

  function handleMouseUp() {
    if (!isPanning) return;
    isPanning = false;
    canvas.style.cursor = 'default';
  }

  function handleCanvasMove(event) {
    if (isPanning || pointers.size > 0) return;
    const rect = canvas.getBoundingClientRect();
    const world = eventToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (!world) return;

    const { expressions } = core;
    let closest = null;
    let minDist = Infinity;

    expressions.forEach((expr) => {
      if (!expr.visible) return;
      const y = evaluateSafely(expr.compiled, world.x);
      if (y == null) return;
      const dist = Math.abs(y - world.y);
      if (dist < minDist) {
        minDist = dist;
        closest = { x: world.x, y, expr };
      }
    });

    if (closest) {
      hoverState.active = true;
      hoverState.x = closest.x;
      hoverState.y = closest.y;
      hoverState.exprId = closest.expr.id;
      onHover?.({ x: closest.x, y: closest.y });
    } else if (hoverState.active) {
      hoverState.active = false;
      onHoverEnd?.();
    }
  }

  function handleMouseLeave() {
    if (hoverState.active) {
      hoverState.active = false;
      onHoverEnd?.();
    }
  }

  function handleCanvasClick(event) {
    if (panMoved) return;
    const rect = canvas.getBoundingClientRect();
    const sx = (event.clientX - rect.left) * dpi;
    const sy = (event.clientY - rect.top) * dpi;
    const world = screenToWorld(sx, sy);
    const { expressions } = core;

    let match = null;
    let bestDist = Infinity;

    expressions.forEach((expr) => {
      if (!expr.visible) return;
      const y = evaluateSafely(expr.compiled, world[0]);
      if (y == null || !isFinite(y)) return;
      const screen = worldToScreen(world[0], y);
      const dist = distance2D(screen[0], screen[1], sx, sy);
      if (dist < bestDist) {
        bestDist = dist;
        match = { expr, x: world[0], y };
      }
    });

    const tolerance = 10 * dpi;
    if (!match || bestDist > tolerance) return;

    onMarker?.({
      exprId: match.expr.id,
      label: match.expr.label,
      color: match.expr.color,
      x: match.x,
      y: match.y,
    });
  }

  function eventToWorld(offsetX, offsetY) {
    const sx = offsetX * dpi;
    const sy = offsetY * dpi;
    const [wx, wy] = screenToWorld(sx, sy);
    if (!isFinite(wx) || !isFinite(wy)) return null;
    return { x: wx, y: wy };
  }

  function screenDeltaToWorld(dxPx, dyPx) {
    const view = core.getView();
    const w = width() * dpi;
    const h = height() * dpi;
    const dx = dxPx * dpi * ((view.xmax - view.xmin) / w);
    const dy = dyPx * dpi * ((view.ymax - view.ymin) / h);
    return [dx, dy];
  }

  function handlePointerDown(event) {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    
    if (hoverState.active) {
      hoverState.active = false;
      onHoverEnd?.();
    }
    
    const pointer = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    };
    pointers.set(event.pointerId, pointer);

    if (pointers.size === 1) {
      isPanning = true;
      panMoved = false;
      panStart.x = event.clientX;
      panStart.y = event.clientY;
      panSnapshot = core.getView();
      canvas.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      isPanning = false;
      canvas.style.cursor = 'default';
      const pts = Array.from(pointers.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      pinchCenter = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      panSnapshot = core.getView();
    }
  }

  function handlePointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    
    const pointer = pointers.get(event.pointerId);
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (pointers.size === 1 && isPanning) {
      event.preventDefault();
      const dxPx = event.clientX - panStart.x;
      const dyPx = event.clientY - panStart.y;
      panMoved = panMoved || Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2;
      const [dx, dy] = screenDeltaToWorld(dxPx, dyPx);
      core.setViewBounds({
        xmin: panSnapshot.xmin - dx,
        xmax: panSnapshot.xmax - dx,
        ymin: panSnapshot.ymin + dy,
        ymax: panSnapshot.ymax + dy,
      });
      enforceSquareAspect();
      requestRender();
    } else if (pointers.size === 2) {
      event.preventDefault();
      const pts = Array.from(pointers.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      
      if (initialPinchDistance > 0 && currentDistance > 0 && Math.abs(currentDistance - initialPinchDistance) > 1) {
        const scaleFactor = initialPinchDistance / currentDistance;
        const rect = canvas.getBoundingClientRect();
        const centerWorld = eventToWorld(
          pinchCenter.x - rect.left,
          pinchCenter.y - rect.top
        );
        
        if (centerWorld) {
          core.zoomAt(centerWorld, scaleFactor);
          enforceSquareAspect();
          requestRender();
          initialPinchDistance = currentDistance;
        }
      }
    }
  }

  function handlePointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    
    canvas.releasePointerCapture(event.pointerId);
    pointers.delete(event.pointerId);

    if (pointers.size === 0) {
      isPanning = false;
      canvas.style.cursor = 'default';
    } else if (pointers.size === 1) {
      const remaining = Array.from(pointers.values())[0];
      isPanning = true;
      panMoved = false;
      panStart.x = remaining.x;
      panStart.y = remaining.y;
      panSnapshot = core.getView();
      canvas.style.cursor = 'grabbing';
    }
  }

  function handlePointerCancel(event) {
    if (!pointers.has(event.pointerId)) return;
    canvas.releasePointerCapture(event.pointerId);
    pointers.delete(event.pointerId);
    
    if (pointers.size === 0) {
      isPanning = false;
      canvas.style.cursor = 'default';
    }
  }

  function enterFullscreen() {
    container.classList.add(FULLSCREEN_CLASS);
    document.body.classList.add(BODY_LOCK_CLASS);
    fixDpi();
    enforceSquareAspect();
    requestRender();
    window.addEventListener('keydown', escListener);
  }

  function exitFullscreen() {
    container.classList.remove(FULLSCREEN_CLASS);
    document.body.classList.remove(BODY_LOCK_CLASS);
    fixDpi();
    enforceSquareAspect();
    requestRender();
    window.removeEventListener('keydown', escListener);
  }

  function escListener(event) {
    if (event.key === 'Escape') {
      exitFullscreen();
    }
  }

  return {
    requestRender,
    enforceSquareAspect,
    fixDpi,
    enterFullscreen,
    exitFullscreen,
    getCanvas: () => canvas,
    destroy() {
  resizeObserver?.disconnect();
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleCanvasMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('keydown', escListener);
    },
  };
}
