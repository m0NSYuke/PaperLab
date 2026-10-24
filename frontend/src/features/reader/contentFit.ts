import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";

/** Horizontal extent of the printed content, as fractions of the page width. */
export type ContentBox = { left: number; right: number; pageWidth: number };

const SAMPLE_WIDTH = 300, // px; enough to find margins, cheap to render
  INK = 235, // a channel below this counts as ink
  // A little paper stays visible on each side so the page still reads as a page.
  gutter = (width: number) => Math.max(20, width * 0.045),
  MAX_CONTENT = 1100; // css px; wider single-pane views center the column instead

/**
 * Finds the printed area by rendering a few body pages small and scanning
 * for ink. Page 1 is skipped when possible: arXiv stamps its left margin.
 */
export async function measureContent(doc: PDFDocumentProxy): Promise<ContentBox | null> {
  const pages = doc.numPages > 1 ? range(2, Math.min(doc.numPages, 5)) : [1];
  let left = 1,
    right = 0,
    pageWidth = 0;
  for (const n of pages) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    if (!pageWidth) pageWidth = base.width;
    const viewport = page.getViewport({ scale: SAMPLE_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const ink = new Uint16Array(width);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 0 && Math.min(data[i], data[i + 1], data[i + 2]) < INK) ink[x]++;
      }
    // Ignore specks: a column needs a couple of inked pixels.
    const first = ink.findIndex((c) => c > 1),
      last = width - 1 - [...ink].reverse().findIndex((c) => c > 1);
    if (first < 0) continue;
    left = Math.min(left, first / width);
    right = Math.max(right, (last + 1) / width);
    page.cleanup();
  }
  // Nothing found, or the content already fills the page: plain fit-width.
  if (right <= left || right - left > 0.92) return null;
  return { left, right, pageWidth };
}

/** Scales the content (not the page) to the pane width and scrolls to it. */
export function fitContent(viewer: PDFViewer, container: HTMLElement, box: ContentBox, min: number, max: number) {
  const cssPerPoint = 96 / 72;
  const width = Math.min(MAX_CONTENT, container.clientWidth - 2 * gutter(container.clientWidth));
  viewer.currentScale = Math.min(max, Math.max(min, width / ((box.right - box.left) * box.pageWidth * cssPerPoint)));
  alignContent(viewer, container, box);
}

/** Scrolls sideways so the content column sits centered in the pane. */
export function alignContent(viewer: PDFViewer, container: HTMLElement, box: ContentBox) {
  const page = viewer.getPageView(viewer.currentPageNumber - 1)?.div as HTMLElement | undefined;
  if (!page) return;
  const offset = page.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft;
  const margin = (container.clientWidth - (box.right - box.left) * page.clientWidth) / 2;
  container.scrollLeft = Math.max(0, offset + box.left * page.clientWidth - margin);
}

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
