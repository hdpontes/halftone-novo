import { createDotTileCache, renderDots } from "./dots";
import { MAX_RADIUS_FACTOR } from "./constants";
import type { CoverageGrid, DotDescriptor, PreviewMode } from "./types";

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Renders the color layer by keeping only the dot areas from the clean art.
 * This positive mask preserves RGB halftone structure and avoids inverted dot holes.
 */
export function renderColorLayer(cleanArt: HTMLCanvasElement, dots: DotDescriptor[], cellPx: number, angle: number): HTMLCanvasElement {
  const w = cleanArt.width;
  const h = cleanArt.height;
  const mask = makeCanvas(w, h);
  const mctx = mask.getContext("2d")!;
  mctx.fillStyle = "#ffffff";
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  const cache = createDotTileCache(cellPx, cellPx * MAX_RADIUS_FACTOR, angle);
  renderDots(mctx, dots, cache);

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(cleanArt, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
  return canvas;
}

/**
 * Renders the White Underbase layer: opaque white (255,255,255) with alpha
 * carrying the whiteMask coverage. This is independent from the color layer's
 * own alpha/dots — it is generated purely from whiteDots or whiteSolidCoverage.
 */
export function renderWhiteLayer(
  width: number,
  height: number,
  whiteDots: DotDescriptor[] | null,
  whiteSolidCoverage: CoverageGrid | null,
  cellPx: number,
  angle: number
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  if (whiteSolidCoverage) {
    const imgd = ctx.createImageData(width, height);
    const d = imgd.data;
    const grid = whiteSolidCoverage;
    for (let y = 0; y < height; y++) {
      const gy = Math.min(grid.height - 1, Math.floor(y / grid.cellPx));
      for (let x = 0; x < width; x++) {
        const gx = Math.min(grid.width - 1, Math.floor(x / grid.cellPx));
        const cov = grid.data[gy * grid.width + gx];
        const i = (y * width + x) * 4;
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = Math.round(Math.max(0, Math.min(1, cov)) * 255);
      }
    }
    ctx.putImageData(imgd, 0, 0);
    return canvas;
  }
  if (whiteDots && whiteDots.length) {
    ctx.fillStyle = "#ffffff";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const cache = createDotTileCache(cellPx, cellPx * MAX_RADIUS_FACTOR, angle);
    // White dots are additive ink (source-over opaque white), unlike the color
    // layer's punch technique — they represent presence of white ink, not holes.
    renderDots(ctx, whiteDots, cache);
  }
  return canvas;
}

/**
 * Composes color + white layers into a target canvas for previewing.
 * "composite"/"final" simulate real DTF print order: white underbase first, color on top.
 */
export function composeDtfPreview(colorLayer: HTMLCanvasElement, whiteLayer: HTMLCanvasElement, mode: PreviewMode): HTMLCanvasElement {
  const w = colorLayer.width,
    h = colorLayer.height;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (mode === "color") {
    ctx.drawImage(colorLayer, 0, 0);
  } else if (mode === "white") {
    ctx.drawImage(whiteLayer, 0, 0);
  } else {
    ctx.drawImage(whiteLayer, 0, 0);
    ctx.drawImage(colorLayer, 0, 0);
  }
  return canvas;
}
