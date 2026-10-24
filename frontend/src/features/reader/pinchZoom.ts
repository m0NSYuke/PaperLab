import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";

export const MIN_ZOOM = 0.4,
  MAX_ZOOM = 5;

/**
 * Ctrl+wheel, trackpad pinch (Chromium/Firefox send it as ctrl+wheel, Safari
 * as gesture events) and two-finger touch pinch over the PDF scale only the
 * PDF, anchored at the pointer, instead of zooming the whole page. Ctrl +/−/0
 * do the same once the PDF was the last thing clicked.
 */
export function attachPinchZoom(
  container: HTMLElement,
  getViewer: () => PDFViewer | null,
  onManualZoom: () => void,
  fit: () => void,
) {
  // Canvases redraw after the gesture settles; meanwhile pages are CSS-scaled.
  const zoomBy = (factor: number, x: number, y: number) => {
    const viewer = getViewer();
    if (!viewer?.pagesCount) return;
    const current = viewer.currentScale;
    const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
    if (Math.abs(target - current) < 0.005) return;
    onManualZoom();
    viewer.updateScale({ scaleFactor: target / current, origin: [x, y], drawingDelay: 300 });
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    // Pinch deltas are small and smooth; a mouse-wheel notch (~100px) is
    // capped so one notch zooms about 20%.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    zoomBy(Math.exp(-Math.max(-20, Math.min(20, delta)) * 0.01), e.clientX, e.clientY);
  };

  // Safari (macOS trackpad, iPad) reports pinches as cumulative gesture scale.
  type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
  let gestureScale = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gestureScale = 1;
  };
  const onGestureChange = (e: Event) => {
    const g = e as GestureEvent;
    e.preventDefault();
    if (touchPinch) return; // touch events already drive this pinch
    zoomBy(g.scale / gestureScale, g.clientX, g.clientY);
    gestureScale = g.scale;
  };

  let touchPinch: { distance: number } | null = null;
  const measure = (t: TouchList) => {
    const [a, b] = [t[0], t[1]];
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    };
  };
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) touchPinch = { distance: measure(e.touches).distance };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!touchPinch || e.touches.length !== 2) return;
    e.preventDefault();
    const m = measure(e.touches);
    if (!touchPinch.distance || !m.distance) return;
    zoomBy(m.distance / touchPinch.distance, m.x, m.y);
    touchPinch.distance = m.distance;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) touchPinch = null;
  };

  // After clicking into the PDF, Ctrl +/−/0 zoom the PDF too, centered on the pane.
  let pdfFocused = false;
  const onPointerDown = (e: PointerEvent) => {
    pdfFocused = container.contains(e.target as Node);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!pdfFocused || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const r = container.getBoundingClientRect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    if (e.key === "=" || e.key === "+") zoomBy(1.2, x, y);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.2, x, y);
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
  };

  const active = { passive: false } as const;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown);
  container.addEventListener("wheel", onWheel, active);
  container.addEventListener("gesturestart", onGestureStart, active);
  container.addEventListener("gesturechange", onGestureChange, active);
  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, active);
  container.addEventListener("touchend", onTouchEnd);
  container.addEventListener("touchcancel", onTouchEnd);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown);
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("gesturestart", onGestureStart);
    container.removeEventListener("gesturechange", onGestureChange);
    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("touchmove", onTouchMove);
    container.removeEventListener("touchend", onTouchEnd);
    container.removeEventListener("touchcancel", onTouchEnd);
  };
}
