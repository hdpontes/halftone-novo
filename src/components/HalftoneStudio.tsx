"use client";

import { useEffect, useRef } from "react";
import "../app/halftone-studio.css";
import {
  DEFAULT_HALFTONE_SETTINGS,
  runHalftoneEngine,
  renderColorLayer,
  renderWhiteLayer,
  composeDtfPreview,
  embedPngDpi,
  type HalftoneAlgorithm,
  type HalftoneSettings,
  type WhiteMode,
} from "../lib/halftone";

type HalftoneProfile = "am_conventional" | "am_ellipse" | "am_rosette" | "fm_stochastic" | "hybrid";

const HALFTONE_PROFILE_LABEL: Record<HalftoneProfile, string> = {
  am_conventional: "AM Convencional",
  am_ellipse: "AM Elíptica",
  am_rosette: "Roseta",
  fm_stochastic: "FM Estocástica",
  hybrid: "Híbrida",
};

/**
 * Halftone Online Pro - client-side halftone studio (upload, remoção de fundo,
 * meio-tom por pontos com ângulo, tamanhos/DPI, zoom/pan e exportação em PNG).
 * Toda a geração de imagem roda no navegador via Canvas 2D.
 */
type ScreenShape = "round" | "diamond" | "square" | "ellipse" | "line" | "rosette";

type HalftonePreset = {
  mode: "dark" | "color" | "light";
  removePower: number;
  bgPower: number;
  colorResidual: number;
  saturation: number;
  contrast: number;
  colorTol: number;
  dpi: number;
  fillFrame: boolean;
  removeHalo: boolean;
  edgeSoftness: number;
};

export default function HalftoneStudio() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const container: HTMLDivElement = rootRef.current;

    const $ = <T extends HTMLElement = HTMLElement>(id: string) => container.querySelector<T>("#" + id)!;
    const viewCanvas = $<HTMLCanvasElement>("viewCanvas");
    const vctx = viewCanvas.getContext("2d", { willReadFrequently: true })!;
    const original = document.createElement("canvas");
    const clean = document.createElement("canvas");
    const result = document.createElement("canvas");
    const displayCrop = document.createElement("canvas");
    const octx = original.getContext("2d", { willReadFrequently: true })!;
    const cctx = clean.getContext("2d", { willReadFrequently: true })!;
    const rctx = result.getContext("2d", { willReadFrequently: true })!;
    const dctx = displayCrop.getContext("2d", { willReadFrequently: true })!;
    [vctx, octx, cctx, rctx, dctx].forEach((c) => {
      c.imageSmoothingEnabled = false;
      c.imageSmoothingQuality = "low";
    });

    let img: HTMLImageElement | null = null;
    let imgName = "arte.png";
    let mode: "dark" | "color" | "light" = "dark";
    let dpi = 300;
    let zoom = 1;
    let showBefore = false;
    let pickingBg = false;
    let manualBgColor = false;
    let previewBg: "checker" | "black" | "white" | "custom" = "checker";
    let aspectRatio = 1;
    let sampledBgColor = { r: 0, g: 0, b: 0 };
    let lockRatio = true;
    let fillFrame = true;
    let removeHalo = false;
    let edgeSoftness = 45;
    let isExporting = false;

    // --- Halftone Engine PRO RGB (AM/FM/Hybrid + White Underbase) ---
    let whiteMode: WhiteMode = "none";
    let whiteDensity = DEFAULT_HALFTONE_SETTINGS.whiteDensity;
    let whiteChoke = DEFAULT_HALFTONE_SETTINGS.whiteChoke;
    let whiteLpi = DEFAULT_HALFTONE_SETTINGS.whiteLpi;
    const whiteAngle = DEFAULT_HALFTONE_SETTINGS.whiteAngle;
    const whiteGamma = DEFAULT_HALFTONE_SETTINGS.whiteGamma;
    let whiteDotShape: ScreenShape = DEFAULT_HALFTONE_SETTINGS.whiteDotShape;
    let whiteAlgorithm: HalftoneAlgorithm = DEFAULT_HALFTONE_SETTINGS.whiteAlgorithm;
    let halftoneAlgorithm: HalftoneAlgorithm = DEFAULT_HALFTONE_SETTINGS.algorithm;
    let screenDotShape: ScreenShape = DEFAULT_HALFTONE_SETTINGS.dotShape;
    let screenLpi = DEFAULT_HALFTONE_SETTINGS.lpi;
    const screenAngle = DEFAULT_HALFTONE_SETTINGS.angle;
    let halftoneProfile: HalftoneProfile = "am_conventional";

    // Celulares têm bem menos memória/limite de dimensão de canvas do que desktop; limitar lado e área evita a página travar/recarregar em A2/A3.
    const isMobileDevice = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const maxSide = isMobileDevice ? 4000 : 9000;
    const maxMobileMegapixels = 11_000_000;

    function unitName(u: string) {
      return u === "cm" ? "cm" : u === "mm" ? "mm" : u === "in" ? "pol" : "px";
    }
    function pxToUnit(px: number, u: string, dpiVal = dpi) {
      if (u === "px") return px;
      if (u === "in") return px / Math.max(1, dpiVal);
      if (u === "cm") return (px / Math.max(1, dpiVal)) * 2.54;
      if (u === "mm") return (px / Math.max(1, dpiVal)) * 25.4;
      return px;
    }
    function unitToPx(v: string | number, u: string, dpiVal = dpi) {
      const n = Number(v) || 1;
      if (u === "px") return n;
      if (u === "in") return n * Math.max(1, dpiVal);
      if (u === "cm") return (n / 2.54) * Math.max(1, dpiVal);
      if (u === "mm") return (n / 25.4) * Math.max(1, dpiVal);
      return n;
    }
    function fmtUnit(v: number, u: string) {
      if (u === "px") return Math.round(v) + " px";
      const n = (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
      return n + " " + unitName(u);
    }
    function currentUnit() {
      return $<HTMLSelectElement>("sizeUnit") ? $<HTMLSelectElement>("sizeUnit").value : "cm";
    }
    function clamp(v: number, a: number, b: number) {
      return Math.max(a, Math.min(b, v));
    }
    function lum(r: number, g: number, b: number) {
      return 0.299 * r + 0.587 * g + 0.114 * b;
    }
    function sat(r: number, g: number, b: number) {
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      return mx ? (mx - mn) / mx : 0;
    }
    function dist(r: number, g: number, b: number, c: { r: number; g: number; b: number }) {
      const dr = r - c.r,
        dg = g - c.g,
        db = b - c.b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }
    function hex(c: { r: number; g: number; b: number }) {
      return (
        "#" +
        [c.r, c.g, c.b]
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()
      );
    }
    function setStatus(t: string) {
      $("status").textContent = t;
    }
    function loading(on: boolean, msg = "Processando...") {
      $("stageLoading").classList.toggle("on", !!on);
      $("stageLoading").querySelector("span")!.textContent = msg;
    }
    function updatePickCursor() {
      $("viewer").classList.toggle("picking", pickingBg);
      $("canvasWrap").classList.toggle("picking", pickingBg);
    }
    function colorResidualBoost() {
      return Number(($("colorResidual") as HTMLInputElement | null)?.value || 0);
    }
    function labels() {
      $("removeVal").textContent = ($("removePower") as HTMLInputElement).value;
      $("bgPowerVal").textContent = ($("bgPower") as HTMLInputElement).value;
      const colorResidualVal = container.querySelector("#colorResidualVal");
      if (colorResidualVal) colorResidualVal.textContent = ($("colorResidual") as HTMLInputElement).value;
      $("satVal").textContent = ($("saturation") as HTMLInputElement).value + "%";
      $("contrastVal").textContent = ($("contrast") as HTMLInputElement).value;
      const colorTolVal = container.querySelector("#colorTolVal");
      if (colorTolVal) colorTolVal.textContent = ($("colorTol") as HTMLInputElement).value;
      const edgeSoftnessVal = container.querySelector("#edgeSoftnessVal");
      if (edgeSoftnessVal) edgeSoftnessVal.textContent = ($("edgeSoftness") as HTMLInputElement).value;
      const bgColorText = container.querySelector("#bgColorText");
      if (bgColorText) bgColorText.textContent = hex(sampledBgColor);
      const bgColorSwatch = container.querySelector<HTMLElement>("#bgColorSwatch");
      if (bgColorSwatch) bgColorSwatch.style.background = hex(sampledBgColor);
      $("zoomVal").textContent = Math.round(zoom * 100) + "%";
      $("zoomBadge").textContent = Math.round(zoom * 100) + "%";
      const wrap = container.querySelector<HTMLElement>("#colorResidualWrap");
      if (wrap) wrap.style.display = mode === "color" ? "block" : "none";
      const whiteDensityEl = container.querySelector("#whiteDensityVal");
      if (whiteDensityEl) whiteDensityEl.textContent = ($("whiteDensity") as HTMLInputElement).value + "%";
      const whiteChokeEl = container.querySelector("#whiteChokeVal");
      if (whiteChokeEl) whiteChokeEl.textContent = ($("whiteChoke") as HTMLInputElement).value + "px";
      const profileInfo = container.querySelector("#profileInfo");
      if (profileInfo) profileInfo.textContent = `${HALFTONE_PROFILE_LABEL[halftoneProfile]} • ${screenLpi} LPI • ${screenDotShape}`;
      updateLpiAvailability();
    }
    // PASSO 4: em FM, o LPI não é utilizado (a densidade micro é controlada pela
    // matemática interna do FM, não por uma grade AM). Não altera a matemática do FM —
    // apenas desabilita/anota visualmente o controle de LPI correspondente.
    function updateLpiAvailability() {
      return;
    }
    function applyHalftoneProfile(profile: HalftoneProfile) {
      halftoneProfile = profile;
      if (profile === "am_ellipse") {
        screenLpi = 50;
        screenDotShape = "ellipse";
        halftoneAlgorithm = "am";
      } else if (profile === "am_rosette") {
        screenLpi = 55;
        screenDotShape = "rosette";
        halftoneAlgorithm = "am";
      } else if (profile === "fm_stochastic") {
        screenLpi = 40;
        screenDotShape = "round";
        halftoneAlgorithm = "fm";
      } else if (profile === "hybrid") {
        screenLpi = 45;
        screenDotShape = "round";
        halftoneAlgorithm = "hybrid";
      } else {
        screenLpi = 45;
        screenDotShape = "round";
        halftoneAlgorithm = "am";
      }
      whiteAlgorithm = halftoneAlgorithm;
      whiteDotShape = screenDotShape;
      whiteLpi = Math.max(20, screenLpi - 2);
      labels();
    }
    function updateExportState() {
      const btn = container.querySelector<HTMLButtonElement>("#saveBtn");
      if (!btn) return;
      btn.disabled = false;
      btn.title = "Gera PNG final em padrão RGB com retícula e 300 DPI.";
      btn.textContent = "Baixar PNG (300 DPI)";
    }
    function targetSize(): [number, number] {
      if (!img) return [0, 0];
      const u = currentUnit();
      const w = Math.max(1, Math.round(unitToPx(($("customWidth") as HTMLInputElement).value, u, dpi)));
      const h = Math.max(1, Math.round(unitToPx(($("customHeight") as HTMLInputElement).value, u, dpi)));
      let cap = Math.min(1, maxSide / Math.max(w, h));
      if (isMobileDevice) {
        const area = w * h * cap * cap;
        if (area > maxMobileMegapixels) cap *= Math.sqrt(maxMobileMegapixels / area);
      }
      return [Math.round(w * cap), Math.round(h * cap)];
    }
    function setCanv(w: number, h: number) {
      [original, clean, result, viewCanvas].forEach((c) => {
        c.width = w;
        c.height = h;
      });
      [vctx, octx, cctx, rctx].forEach((c) => {
        c.imageSmoothingEnabled = false;
        c.imageSmoothingQuality = "low";
      });
    }
    function sampleBorder() {
      const w = original.width,
        h = original.height,
        d = octx.getImageData(0, 0, w, h).data;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      const step = Math.max(1, Math.floor(Math.max(w, h) / 180));
      function add(x: number, y: number) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 10) return;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      for (let x = 0; x < w; x += step) {
        add(x, 0);
        add(x, h - 1);
      }
      for (let y = 0; y < h; y += step) {
        add(0, y);
        add(w - 1, y);
      }
      return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 };
    }
    function quantKey(r: number, g: number, b: number) {
      return `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
    }
    function setBgColor(c: { r: number; g: number; b: number }, manual = false) {
      sampledBgColor = { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
      manualBgColor = manual;
      labels();
    }
    function detectBorderColor(manual = false) {
      if (!original.width || !original.height) {
        setBgColor({ r: 0, g: 0, b: 0 }, manual);
        return sampledBgColor;
      }
      const w = original.width,
        h = original.height,
        d = octx.getImageData(0, 0, w, h).data;
      const step = Math.max(1, Math.floor(Math.max(w, h) / 260));
      const map = new Map<string, { count: number; r: number; g: number; b: number }>();
      function add(x: number, y: number) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 10) return;
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const key = quantKey(r, g, b);
        const item = map.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        item.count++;
        item.r += r;
        item.g += g;
        item.b += b;
        map.set(key, item);
      }
      for (let x = 0; x < w; x += step) {
        add(x, 0);
        add(x, h - 1);
      }
      for (let y = 0; y < h; y += step) {
        add(0, y);
        add(w - 1, y);
      }
      let best: { count: number; r: number; g: number; b: number } | null = null;
      for (const item of map.values()) if (!best || item.count > best.count) best = item;
      if (best) setBgColor({ r: best.r / best.count, g: best.g / best.count, b: best.b / best.count }, manual);
      return sampledBgColor;
    }

    function darkBgCandidate(r: number, g: number, b: number, a: number, power = 0, bg = { r: 0, g: 0, b: 0 }) {
      if (a < 8) return true;
      const L = lum(r, g, b),
        S = sat(r, g, b);
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b),
        chroma = mx - mn;
      const bgDist = dist(r, g, b, bg || { r: 0, g: 0, b: 0 });
      const softCut = 14 + power * 1.12;
      const hardCut = 26 + power * 0.7;
      const distCut = 22 + power * 1.1;
      if (bgDist <= distCut && L <= hardCut + 42) return true;
      if (mx <= softCut + 20 && L <= softCut) return true;
      if (L <= hardCut && (S < 0.96 || chroma < 54)) return true;
      if (power >= 120) {
        const extra = (power - 120) / 80;
        const aggressiveCut = 112 + extra * 64;
        if (L <= aggressiveCut && mx <= aggressiveCut + 34 && S < 0.98) return true;
        if (power >= 175 && L <= 170 && mx <= 205) return true;
      }
      return false;
    }
    function lightBgCandidate(r: number, g: number, b: number, a: number, power = 0, bg = { r: 255, g: 255, b: 255 }) {
      if (a < 8) return true;
      const L = lum(r, g, b),
        S = sat(r, g, b);
      const bgDist = dist(r, g, b, bg || { r: 255, g: 255, b: 255 });
      const cut = 255 - power * 1.05;
      const satLimit = Math.min(0.72, 0.22 + power / 145);
      if (L >= cut && S <= satLimit) return true;
      if (bgDist <= 16 + power * 0.55 && L >= Math.max(165, cut - 30)) return true;
      if (power >= 120) {
        const extra = (power - 120) / 80;
        const aggressiveCut = 205 + extra * 38;
        const aggressiveSat = Math.min(0.88, 0.28 + extra * 0.34);
        if (L >= aggressiveCut && S <= aggressiveSat) return true;
        if (power >= 175 && L >= 184 && S <= 0.92) return true;
      }
      return false;
    }
    function colorBgCandidate(r: number, g: number, b: number, a: number, power = 0, bg = { r: 255, g: 255, b: 255 }) {
      if (a < 8) return true;
      const S = sat(r, g, b),
        L = lum(r, g, b);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual * 0.85;
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const tol = baseTol + effectivePower * 0.35;
      const bgDist = dist(r, g, b, bg || { r: 255, g: 255, b: 255 });
      if (bgDist <= tol) return true;
      if (effectivePower >= 120) {
        const extra = (effectivePower - 120) / 80;
        const aggressiveTol = tol + 18 + extra * 28;
        if (bgDist <= aggressiveTol && (S < 0.96 || L > 30)) return true;
        if (effectivePower >= 175 && bgDist <= aggressiveTol + 18) return true;
      }
      return false;
    }
    function residualBgCandidate(r: number, g: number, b: number, a: number, bg: { r: number; g: number; b: number }, kind: string, power: number) {
      if (kind === "dark") return darkBgCandidate(r, g, b, a, power, bg);
      if (kind === "light") return lightBgCandidate(r, g, b, a, power, bg);
      return colorBgCandidate(r, g, b, a, power, bg);
    }
    function bgMatchPixel(r: number, g: number, b: number, a: number, bg: { r: number; g: number; b: number }, kind: string, power: number, globalPower: number) {
      if (a < 8) return true;
      if (kind === "dark") {
        const p = Math.max(power, globalPower * 0.72);
        return residualBgCandidate(r, g, b, a, bg, kind, p);
      }
      return residualBgCandidate(r, g, b, a, bg, kind, power);
    }
    function bgGlobalMatch(r: number, g: number, b: number, a: number, bg: { r: number; g: number; b: number }, kind: string, globalPower: number) {
      if (a < 8) return true;
      if (globalPower <= 0) return false;
      if (kind === "dark") return residualBgCandidate(r, g, b, a, bg, kind, globalPower);
      if (kind === "light") return residualBgCandidate(r, g, b, a, bg, kind, Math.max(globalPower, globalPower * 0.92));
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const tol = Math.max(0, baseTol - 16) + globalPower * 0.75;
      const bgDist = dist(r, g, b, bg);
      if (bgDist <= tol) return true;
      if (globalPower >= 120) return residualBgCandidate(r, g, b, a, bg, kind, Math.min(200, globalPower + 18));
      return false;
    }
    function createBorderMask() {
      const w = original.width,
        h = original.height;
      const d = octx.getImageData(0, 0, w, h).data;
      const power = Number(($("removePower") as HTMLInputElement).value);
      const globalPower = Number(($("bgPower") as HTMLInputElement).value);
      if (mode === "color" && !manualBgColor) detectBorderColor(false);
      const bg = mode === "color" ? sampledBgColor : sampleBorder();
      const arr = new Uint8Array(w * h),
        q = new Int32Array(w * h);
      let head = 0,
        tail = 0;
      function isBg(x: number, y: number) {
        const i = (y * w + x) * 4;
        return bgMatchPixel(d[i], d[i + 1], d[i + 2], d[i + 3], bg, mode, power, globalPower);
      }
      function push(x: number, y: number) {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const idx = y * w + x;
        if (arr[idx] || !isBg(x, y)) return;
        arr[idx] = 1;
        q[tail++] = idx;
      }
      for (let x = 0; x < w; x++) {
        push(x, 0);
        push(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        push(0, y);
        push(w - 1, y);
      }
      while (head < tail) {
        const idx = q[head++],
          x = idx % w,
          y = (idx / w) | 0;
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
      }
      let cur = arr;
      let expand = mode === "light" ? 3 : 2;
      expand += Math.floor(globalPower / 45);
      expand = Math.min(6, expand);
      for (let e = 0; e < expand; e++) {
        const next = new Uint8Array(cur);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            if (cur[i]) continue;
            if (cur[i - 1] || cur[i + 1] || cur[i - w] || cur[i + w]) next[i] = 1;
          }
        }
        cur = next;
      }
      return { mask: cur, bg, globalPower };
    }
    function removeResidualBgGhosts(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      const w = clean.width,
        h = clean.height,
        d = imgd.data;
      const userPower = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      if (userPower <= 0 && mode !== "dark") return;
      const power = Math.max(34, userPower);
      const src = new Uint8ClampedArray(d);
      const radius = power >= 120 ? 4 : power >= 82 ? 3 : 2;
      const aggressive = power >= 120;

      function isResidualAt(p: number, localPower = power) {
        const a = src[p + 3];
        if (a < 8) return true;
        return residualBgCandidate(src[p], src[p + 1], src[p + 2], a, bg || { r: 0, g: 0, b: 0 }, mode, localPower);
      }
      function hasArtNeighbor(x: number, y: number) {
        let colored = 0,
          bright = 0,
          opaque = 0,
          contrast = 0;
        const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
        for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
          for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4,
              a = src[p + 3];
            if (a < 24) continue;
            opaque++;
            const r = src[p],
              g = src[p + 1],
              b = src[p + 2];
            const L = lum(r, g, b),
              S = sat(r, g, b),
              mx = Math.max(r, g, b);
            const bgDist = dist(r, g, b, bg || { r: 0, g: 0, b: 0 });
            if (mode === "dark") {
              if (L > 128 || mx > 168) bright++;
              if ((S > 0.34 && L > 42) || L > 105) colored++;
            } else if (mode === "light") {
              if (L < 220 || mx < 242) bright++;
              if (S > 0.12 || L < 238) colored++;
              if (bgDist > 28) contrast++;
            } else {
              if (L > 120 || mx > 165) bright++;
              if (S > 0.22 || bgDist > localTol * 0.82) colored++;
              if (bgDist > localTol * 0.7) contrast++;
            }
          }
        }
        if (mode === "dark") return aggressive ? bright >= 2 || colored >= 4 : colored >= 2 || opaque >= 14;
        if (mode === "light") return aggressive ? bright >= 2 || contrast >= 2 || colored >= 3 : contrast >= 1 || colored >= 4 || opaque >= 14;
        return aggressive ? contrast >= 2 || colored >= 4 || bright >= 2 : contrast >= 1 || colored >= 3 || opaque >= 14;
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          if (d[p + 3] < 8) continue;
          if (!isResidualAt(p)) continue;
          if (aggressive || !hasArtNeighbor(x, y)) {
            if (!hasArtNeighbor(x, y) || power >= 165) d[p + 3] = 0;
          }
        }
      }

      const after = new Uint8ClampedArray(d);
      const seen = new Uint8Array(w * h);
      const q = new Int32Array(w * h);
      const maxArea = mode === "dark" ? (aggressive ? 4200 : 900) : mode === "light" ? (aggressive ? 5200 : 1200) : aggressive ? 4600 : 1100;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const start = y * w + x;
          if (seen[start]) continue;
          const p0 = start * 4;
          if (after[p0 + 3] < 8 || !residualBgCandidate(after[p0], after[p0 + 1], after[p0 + 2], after[p0 + 3], bg || { r: 0, g: 0, b: 0 }, mode, power)) {
            seen[start] = 1;
            continue;
          }
          let head = 0,
            tail = 0,
            area = 0,
            touchEdge = false,
            artTouch = 0;
          q[tail++] = start;
          seen[start] = 1;
          while (head < tail) {
            const idx = q[head++],
              xx = idx % w,
              yy = (idx / w) | 0;
            area++;
            if (xx <= 1 || yy <= 1 || xx >= w - 2 || yy >= h - 2) touchEdge = true;
            const pp = idx * 4;
            const rr = after[pp],
              gg = after[pp + 1],
              bb = after[pp + 2];
            const LL = lum(rr, gg, bb),
              SS = sat(rr, gg, bb),
              MM = Math.max(rr, gg, bb);
            const bgDist = dist(rr, gg, bb, bg || { r: 0, g: 0, b: 0 });
            if (mode === "dark") {
              if (LL > 120 || (SS > 0.38 && LL > 54) || MM > 170) artTouch++;
            } else if (mode === "light") {
              if (LL < 225 || SS > 0.12 || bgDist > 28) artTouch++;
            } else {
              const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
              if (SS > 0.24 || bgDist > localTol * 0.78 || LL < 235) artTouch++;
            }
            const ns = [idx - 1, idx + 1, idx - w, idx + w];
            for (const ni of ns) {
              if (ni < 0 || ni >= w * h || seen[ni]) continue;
              const nx = ni % w,
                ny = (ni / w) | 0;
              if (Math.abs(nx - xx) + Math.abs(ny - yy) !== 1) continue;
              const p = ni * 4;
              if (after[p + 3] >= 8 && residualBgCandidate(after[p], after[p + 1], after[p + 2], after[p + 3], bg || { r: 0, g: 0, b: 0 }, mode, power)) {
                seen[ni] = 1;
                q[tail++] = ni;
              }
            }
          }
          const remove = touchEdge || area <= maxArea || (aggressive && artTouch < Math.max(10, area * 0.015));
          if (remove) {
            for (let i = 0; i < tail; i++) {
              const p = q[i] * 4;
              d[p + 3] = 0;
            }
          }
        }
      }
    }

    function cleanupColorEdgeSpill(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      if (mode !== "color") return;
      const w = clean.width,
        h = clean.height,
        d = imgd.data;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const effectivePower = power + extraResidual;
      const softTol = baseTol + Math.max(10, effectivePower * 0.24);
      const hardTol = baseTol + 22 + effectivePower * 0.34;
      const src = new Uint8ClampedArray(d);

      function touchesTransparent(x: number, y: number) {
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4;
            if (src[p + 3] < 8) return true;
          }
        }
        return false;
      }
      function inwardContrast(x: number, y: number, currentDist: number) {
        let best = currentDist;
        let strong = 0;
        let opaque = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
          for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4;
            const a = src[p + 3];
            if (a < 24) continue;
            opaque++;
            const nd = dist(src[p], src[p + 1], src[p + 2], bg || { r: 255, g: 255, b: 255 });
            if (nd > best) best = nd;
            if (nd > currentDist + 14) strong++;
          }
        }
        return { best, strong, opaque };
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          const a = d[p + 3];
          if (a < 8) continue;
          if (!touchesTransparent(x, y)) continue;
          const currentDist = dist(d[p], d[p + 1], d[p + 2], bg || { r: 255, g: 255, b: 255 });
          if (currentDist > hardTol + 28) continue;
          const S = sat(d[p], d[p + 1], d[p + 2]);
          const L = lum(d[p], d[p + 1], d[p + 2]);
          const contrast = inwardContrast(x, y, currentDist);
          const edgeLikelySpill = contrast.opaque >= 2 && contrast.strong >= 1 && contrast.best > currentDist + 12;
          if (!edgeLikelySpill) continue;

          if (currentDist <= softTol || (currentDist <= hardTol && contrast.best > currentDist + 22)) {
            d[p + 3] = 0;
            continue;
          }
          let keep = 0.34;
          if (effectivePower >= 120) keep = 0.12;
          else if (effectivePower >= 80) keep = 0.2;
          if (S < 0.18 || L > 180) keep *= 0.72;
          d[p + 3] = Math.round(a * keep);
        }
      }
    }

    function cleanupColorContaminationGlobal(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      if (mode !== "color") return;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual;
      if (effectivePower < 20) return;
      const d = imgd.data;
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const killTol = baseTol + 18 + effectivePower * 0.58;
      const fadeTol = killTol + 34 + effectivePower * 0.22;
      const hardMode = effectivePower >= 85;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 8) continue;
        const bgDist = dist(d[i], d[i + 1], d[i + 2], bg || { r: 255, g: 255, b: 255 });
        if (bgDist > fadeTol) continue;
        const S = sat(d[i], d[i + 1], d[i + 2]);
        const L = lum(d[i], d[i + 1], d[i + 2]);
        if (bgDist <= killTol) {
          d[i + 3] = 0;
          continue;
        }
        let keep = 0.24;
        if (hardMode) keep = 0.08;
        else if (effectivePower >= 60) keep = 0.08;
        if (S < 0.28 || L > 160) keep *= 0.72;
        d[i + 3] = Math.round(a * keep);
      }
    }

    function decontaminateColorBackground(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      if (mode !== "color") return;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual;
      const tol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const d = imgd.data;
      const fadeTol = tol + 42 + effectivePower * 0.46;
      const hardTol = tol + 18 + effectivePower * 0.36;
      const maxMix = effectivePower >= 110 ? 0.94 : effectivePower >= 70 ? 0.86 : 0.72;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 8) continue;
        const bgDist = dist(d[i], d[i + 1], d[i + 2], bg || { r: 255, g: 255, b: 255 });
        if (bgDist > fadeTol) continue;
        const alphaNorm = a / 255;
        let contam = clamp((fadeTol - bgDist) / Math.max(1, fadeTol - hardTol), 0, 1);
        if (alphaNorm < 1) contam = Math.max(contam, (1 - alphaNorm) * 0.9);
        if (contam <= 0) continue;
        if (bgDist <= hardTol * 0.72) {
          d[i + 3] = 0;
          continue;
        }
        const mix = clamp(contam * maxMix, 0, 0.92);
        const denom = Math.max(0.12, 1 - mix);
        const nr = (d[i] - bg.r * mix) / denom;
        const ng = (d[i + 1] - bg.g * mix) / denom;
        const nb = (d[i + 2] - bg.b * mix) / denom;
        d[i] = clamp(nr, 0, 255);
        d[i + 1] = clamp(ng, 0, 255);
        d[i + 2] = clamp(nb, 0, 255);
        let na = a * (1 - mix * 0.58);
        if (bgDist <= hardTol) na *= 0.55;
        d[i + 3] = clamp(Math.round(na), 0, 255);
      }
    }

    function removeBg() {
      const w = original.width,
        h = original.height;
      cctx.clearRect(0, 0, w, h);
      cctx.drawImage(original, 0, 0);
      const imgd = cctx.getImageData(0, 0, w, h),
        d = imgd.data;
      const info = createBorderMask();
      const bm = info.mask,
        bg = info.bg,
        globalPower = info.globalPower;
      for (let i = 0; i < bm.length; i++) {
        const p = i * 4;
        if (bm[i] || bgGlobalMatch(d[p], d[p + 1], d[p + 2], d[p + 3], bg, mode, globalPower)) d[p + 3] = 0;
      }
      removeResidualBgGhosts(imgd, bg);
      cleanupColorEdgeSpill(imgd, bg);
      cleanupColorContaminationGlobal(imgd, bg);
      decontaminateColorBackground(imgd, bg);
      if (removeHalo) removeBackgroundHalo(imgd, bg);
      softenAlphaEdges(imgd);
      cctx.putImageData(imgd, 0, 0);
    }
    function removeBackgroundHalo(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      const w = imgd.width,
        h = imgd.height,
        d = imgd.data;
      const src = d.slice();
      const tol = 46;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (src[i + 3] === 0) continue;
          let edge = false;
          for (const [dx, dy] of dirs) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || src[(ny * w + nx) * 4 + 3] === 0) {
              edge = true;
              break;
            }
          }
          if (!edge) continue;
          if (src[i + 3] < 235 || dist(src[i], src[i + 1], src[i + 2], bg) < tol) d[i + 3] = 0;
        }
      }
    }
    function softenAlphaEdges(imgd: ImageData) {
      if (edgeSoftness <= 0) return;
      const w = imgd.width,
        h = imgd.height,
        d = imgd.data;
      const strength = clamp(edgeSoftness / 100, 0, 1);
      const radius = strength >= 0.7 ? 2 : 1;
      const passes = strength >= 0.8 ? 2 : 1;
      const edgeMix = 0.22 + strength * 0.52;

      for (let pass = 0; pass < passes; pass++) {
        const src = d.slice();
        for (let y = radius; y < h - radius; y++) {
          for (let x = radius; x < w - radius; x++) {
            const i = (y * w + x) * 4;
            const a = src[i + 3];
            if (a <= 0) continue;

            let touchesTransparent = false;
            let weightedAlpha = 0;
            let weightedCount = 0;
            for (let yy = y - radius; yy <= y + radius; yy++) {
              for (let xx = x - radius; xx <= x + radius; xx++) {
                if (xx === x && yy === y) continue;
                const ni = (yy * w + xx) * 4;
                const na = src[ni + 3];
                if (na < 8) touchesTransparent = true;
                const manhattan = Math.abs(xx - x) + Math.abs(yy - y);
                const weight = manhattan <= 1 ? 1.35 : manhattan === 2 ? 0.8 : 0.55;
                weightedAlpha += na * weight;
                weightedCount += weight;
              }
            }
            if (!touchesTransparent) continue;
            const avg = weightedAlpha / Math.max(1, weightedCount);
            const target = a * (1 - edgeMix) + avg * edgeMix;
            const softened = Math.min(a, Math.round(target));
            d[i + 3] = clamp(softened, 0, 255);
          }
        }
      }
    }
    function adjust(canvas: HTMLCanvasElement) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height),
        d = imgd.data;
      const baseSat = Number(($("saturation") as HTMLInputElement).value) / 100;
      const sb = mode === "color" ? Math.max(1, baseSat * 0.96) : mode === "light" ? baseSat * 1.04 : baseSat;
      const con = Number(($("contrast") as HTMLInputElement).value),
        cf = (259 * (con + 255)) / (255 * (259 - con));
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const gr = (r + g + b) / 3;
        const S = sat(r, g, b);
        const vibrance = mode === "color" && S > 0.55 ? 0.98 : S < 0.5 ? 1.08 : 1.0;
        r = gr + (r - gr) * sb * vibrance;
        g = gr + (g - gr) * sb * vibrance;
        b = gr + (b - gr) * sb * vibrance;
        const cf2 = mode === "color" ? 1 + (cf - 1) * 0.55 : cf;
        r = cf2 * (r - 128) + 128;
        g = cf2 * (g - 128) + 128;
        b = cf2 * (b - 128) + 128;
        d[i] = clamp(r, 0, 255);
        d[i + 1] = clamp(g, 0, 255);
        d[i + 2] = clamp(b, 0, 255);
      }
      ctx.putImageData(imgd, 0, 0);
    }
    function buildHalftoneSettingsFromUI(): HalftoneSettings {
      return {
        ...DEFAULT_HALFTONE_SETTINGS,
        dpi,
        lpi: screenLpi,
        angle: screenAngle,
        algorithm: halftoneAlgorithm,
        dotShape: screenDotShape,
        colorMode: "rgb",
        whiteMode,
        whiteDensity,
        whiteChoke,
        whiteLpi,
        whiteAngle,
        whiteDotShape,
        whiteAlgorithm,
        whiteGamma,
      };
    }
    function halftoneProRgb() {
      const w = clean.width,
        h = clean.height;
      if (!w || !h) return;
      // Saturação/contraste entram antes da geração de pontos para afetar a cobertura RGB final.
      adjust(clean);
      const imgd = cctx.getImageData(0, 0, w, h);
      const settings = buildHalftoneSettingsFromUI();
      const layers = runHalftoneEngine(imgd.data, w, h, settings);
      const colorCellPx = Math.max(1.1, settings.dpi / settings.lpi);
      const colorLayer = renderColorLayer(clean, layers.colorDots, colorCellPx, settings.angle);
      const whiteCellPx = Math.max(1.1, settings.dpi / Math.max(1, settings.whiteLpi));
      const whiteLayer = renderWhiteLayer(w, h, layers.whiteDots, layers.whiteSolidCoverage, whiteCellPx, settings.whiteAngle);
      const preview = composeDtfPreview(colorLayer, whiteLayer, "composite");
      result.width = w;
      result.height = h;
      rctx.clearRect(0, 0, w, h);
      rctx.drawImage(preview, 0, 0);
    }

    function render() {
      const srcFull = showBefore ? original : result;
      $("badge").textContent = showBefore ? "Antes / original" : "Depois / resultado";
      let src: HTMLCanvasElement = srcFull;
      if (!showBefore && fillFrame && srcFull.width && srcFull.height) {
        const bounds = computeContentBounds(srcFull);
        if (bounds && (bounds.x > 0 || bounds.y > 0 || bounds.width !== srcFull.width || bounds.height !== srcFull.height)) {
          displayCrop.width = bounds.width;
          displayCrop.height = bounds.height;
          dctx.clearRect(0, 0, bounds.width, bounds.height);
          dctx.drawImage(srcFull, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
          src = displayCrop;
        }
      }
      viewCanvas.width = src.width;
      viewCanvas.height = src.height;
      vctx.clearRect(0, 0, src.width, src.height);
      vctx.imageSmoothingEnabled = false;
      vctx.drawImage(src, 0, 0);
      applyZoom();
    }
    function applyZoom() {
      labels();
      const wrap = $("canvasWrap");
      const scaledW = Math.max(1, Math.round(viewCanvas.width * zoom));
      const scaledH = Math.max(1, Math.round(viewCanvas.height * zoom));
      wrap.style.width = scaledW + "px";
      wrap.style.height = scaledH + "px";
      wrap.style.marginLeft = "0px";
      wrap.style.marginTop = "0px";
      wrap.style.transform = "none";
      viewCanvas.style.width = scaledW + "px";
      viewCanvas.style.height = scaledH + "px";
    }
    function fit() {
      if (!result.width) return;
      const v = $("viewer");
      const mobile = window.matchMedia("(max-width:920px)").matches;
      const safeSpace = mobile ? 40 : 92;
      const bounds = fillFrame ? computeContentBounds(result) : null;
      const dispW = bounds ? bounds.width : result.width;
      const dispH = bounds ? bounds.height : result.height;
      const z = Math.min((v.clientWidth - safeSpace) / dispW, (v.clientHeight - safeSpace) / dispH, 1);
      zoom = Math.max(0.05, z);
      ($("zoom") as HTMLInputElement).value = String(Math.round(zoom * 100));
      render();
      requestAnimationFrame(() => {
        v.scrollLeft = Math.max(0, (v.scrollWidth - v.clientWidth) / 2);
        v.scrollTop = Math.max(0, (v.scrollHeight - v.clientHeight) / 2);
      });
    }
    async function process() {
      if (!img) return;
      pickingBg = false;
      const pickBgBtn = container.querySelector("#pickBgBtn");
      if (pickBgBtn) pickBgBtn.classList.remove("on");
      updatePickCursor();
      labels();
      loading(true, "Processando...");
      setStatus("Processando halftone...");
      try {
        await new Promise((r) => setTimeout(r, 25));
        const [w, h] = targetSize();
        setCanv(w, h);
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        octx.clearRect(0, 0, w, h);
        octx.drawImage(img, 0, 0, w, h);
        if (mode === "color" && !manualBgColor) detectBorderColor(false);
        removeBg();
        halftoneProRgb();
        showBefore = false;
        render();
        fit();
        $("empty").style.display = "none";
        const u = currentUnit();
        $("sizeInfo").textContent = `Saída: ${fmtUnit(pxToUnit(w, u, dpi), u)} × ${fmtUnit(pxToUnit(h, u, dpi), u)} • ${dpi} DPI • ${HALFTONE_PROFILE_LABEL[halftoneProfile]} • ${screenLpi} LPI`;
        setStatus("Pronto. Sua arte foi processada com sucesso.");
      } catch (err) {
        console.error(err);
        setStatus("Erro ao processar a imagem. Ajuste os controles e tente novamente.");
      } finally {
        loading(false);
      }
    }
    function computeContentBounds(canvas: HTMLCanvasElement) {
      const w = canvas.width,
        h = canvas.height;
      if (!w || !h) return null;
      const boundsCtx = canvas.getContext("2d", { willReadFrequently: true })!;
      const data = boundsCtx.getImageData(0, 0, w, h).data;
      const ALPHA_THRESHOLD = 8;
      let top = -1,
        bottom = -1,
        left = -1,
        right = -1;
      for (let y = 0; y < h && top < 0; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            top = y;
            break;
          }
        }
      }
      if (top < 0) return null;
      for (let y = h - 1; y >= top && bottom < 0; y--) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            bottom = y;
            break;
          }
        }
      }
      for (let x = 0; x < w && left < 0; x++) {
        for (let y = top; y <= bottom; y++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            left = x;
            break;
          }
        }
      }
      for (let x = w - 1; x >= left && right < 0; x--) {
        for (let y = top; y <= bottom; y++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            right = x;
            break;
          }
        }
      }
      return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    }
    function downloadBytes(bytes: Uint8Array, name: string, mimeType: string) {
      const blob = new Blob([bytes.slice().buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
    async function save() {
      if (isExporting) return;
      if (!result.width || !result.height) {
        setStatus("Clique em \"Gerar halftone\" antes de baixar.");
        return;
      }
      isExporting = true;
      const btn = $<HTMLButtonElement>("saveBtn");
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Preparando PNG...";
      setStatus("Gerando PNG final em RGB com retícula (300 DPI)...");
      try {
        const baseName = imgName.replace(/\.(png|jpg|jpeg|webp)$/i, "");
        const blob = await new Promise<Blob>((resolve, reject) => {
          result.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar o PNG."))), "image/png", 1);
        });
        const withDpi = await embedPngDpi(blob, dpi);
        const bytes = new Uint8Array(await withDpi.arrayBuffer());
        downloadBytes(bytes, `${baseName}_halftone_rgb.png`, "image/png");
        setStatus("Download iniciado (PNG RGB com retícula, 300 DPI). Verifique a pasta de downloads.");
      } catch (err) {
        console.error(err);
        setStatus("Erro ao exportar PNG RGB com retícula.");
      } finally {
        isExporting = false;
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
    function mapClickToPixel(e: MouseEvent) {
      const rect = viewCanvas.getBoundingClientRect();
      const x = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * viewCanvas.width), 0, viewCanvas.width - 1),
        y = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * viewCanvas.height), 0, viewCanvas.height - 1);
      const d = octx.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    }
    function setCustomInputsFromPx(wPx: number, hPx: number) {
      const u = currentUnit();
      ($("customWidth") as HTMLInputElement).value = String(u === "px" ? Math.round(wPx) : Number(pxToUnit(wPx, u, dpi).toFixed(2)));
      ($("customHeight") as HTMLInputElement).value = String(u === "px" ? Math.round(hPx) : Number(pxToUnit(hPx, u, dpi).toFixed(2)));
    }
    function getCustomPx(): [number, number] {
      const u = currentUnit();
      return [Math.max(1, unitToPx(($("customWidth") as HTMLInputElement).value, u, dpi)), Math.max(1, unitToPx(($("customHeight") as HTMLInputElement).value, u, dpi))];
    }
    function updateFileMeta() {
      if (!img) return;
      const u = currentUnit();
      $("fileMeta").textContent = `Original: ${fmtUnit(pxToUnit(img.naturalWidth, u, dpi), u)} × ${fmtUnit(pxToUnit(img.naturalHeight, u, dpi), u)}`;
    }
    function syncWidth() {
      if (!img) return;
      if (lockRatio) {
        const w = Math.max(1, parseFloat(($("customWidth") as HTMLInputElement).value) || 1);
        ($("customHeight") as HTMLInputElement).value = currentUnit() === "px" ? String(Math.round(w / Math.max(aspectRatio, 0.0001))) : (w / Math.max(aspectRatio, 0.0001)).toFixed(2);
      }
      updateFileMeta();
      process();
    }
    function syncHeight() {
      if (!img) return;
      if (lockRatio) {
        const h = Math.max(1, parseFloat(($("customHeight") as HTMLInputElement).value) || 1);
        ($("customWidth") as HTMLInputElement).value = currentUnit() === "px" ? String(Math.round(h * Math.max(aspectRatio, 0.0001))) : (h * Math.max(aspectRatio, 0.0001)).toFixed(2);
      }
      updateFileMeta();
      process();
    }
    function changeUnit() {
      if (!img) {
        labels();
        return;
      }
      const [wPx, hPx] = getCustomPx();
      setCustomInputsFromPx(wPx, hPx);
      updateFileMeta();
      labels();
      process();
    }
    function setQuickHeightCm(cm: number) {
      if (!img) return;
      const hPx = unitToPx(cm, "cm", dpi);
      const wPx = lockRatio ? hPx * aspectRatio : getCustomPx()[0];
      setCustomInputsFromPx(wPx, hPx);
      updateFileMeta();
      process();
    }
    function restoreOriginalSize() {
      if (!img) return;
      setCustomInputsFromPx(img.naturalWidth, img.naturalHeight);
      updateFileMeta();
      process();
    }

    function collectPreset(): HalftonePreset {
      return {
        mode,
        removePower: Number(($("removePower") as HTMLInputElement).value),
        bgPower: Number(($("bgPower") as HTMLInputElement).value),
        colorResidual: Number(($("colorResidual") as HTMLInputElement).value),
        saturation: Number(($("saturation") as HTMLInputElement).value),
        contrast: Number(($("contrast") as HTMLInputElement).value),
        colorTol: Number(($("colorTol") as HTMLInputElement).value),
        dpi,
        fillFrame,
        removeHalo,
        edgeSoftness,
      };
    }
    function applyPreset(p: HalftonePreset) {
      mode = p.mode;
      container.querySelectorAll<HTMLButtonElement>(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === p.mode));
      ($("removePower") as HTMLInputElement).value = String(p.removePower);
      ($("bgPower") as HTMLInputElement).value = String(p.bgPower);
      ($("colorResidual") as HTMLInputElement).value = String(p.colorResidual);
      ($("saturation") as HTMLInputElement).value = String(p.saturation);
      ($("contrast") as HTMLInputElement).value = String(p.contrast);
      ($("colorTol") as HTMLInputElement).value = String(p.colorTol);
      const beforePx = img ? getCustomPx() : null;
      container.querySelectorAll<HTMLButtonElement>("#dpiChips .chip").forEach((b) => b.classList.toggle("active", Number(b.dataset.dpi) === p.dpi));
      dpi = p.dpi;
      if (img && beforePx) setCustomInputsFromPx(beforePx[0], beforePx[1]);
      fillFrame = p.fillFrame;
      ($("fillFrame") as HTMLInputElement).checked = p.fillFrame;
      removeHalo = p.removeHalo;
      ($("removeHalo") as HTMLInputElement).checked = p.removeHalo;
      edgeSoftness = Number.isFinite(p.edgeSoftness) ? p.edgeSoftness : 45;
      ($("edgeSoftness") as HTMLInputElement).value = String(edgeSoftness);
      if (mode === "color" && !manualBgColor) detectBorderColor(false);
      updateFileMeta();
      labels();
      process();
    }
    let presetCache: { id: string; name: string; data: HalftonePreset }[] = [];
    async function loadPresets() {
      try {
        const res = await fetch("/api/presets");
        if (!res.ok) return [];
        const json = await res.json();
        return (json.presets || []) as { id: string; name: string; data: HalftonePreset }[];
      } catch {
        return [];
      }
    }
    async function refreshPresetSelect() {
      const select = $<HTMLSelectElement>("presetSelect");
      presetCache = await loadPresets();
      const current = select.value;
      select.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = presetCache.length ? "Selecione um preset" : "Nenhum preset salvo";
      select.appendChild(placeholder);
      presetCache.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      if (presetCache.some((p) => p.name === current)) select.value = current;
    }
    refreshPresetSelect();
    $("savePresetBtn").addEventListener("click", async () => {
      const nameInput = $<HTMLInputElement>("presetName");
      const name = nameInput.value.trim();
      if (!name) {
        setStatus("Digite um nome para salvar o preset.");
        return;
      }
      try {
        const res = await fetch("/api/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, data: collectPreset() }),
        });
        if (!res.ok) throw new Error();
        await refreshPresetSelect();
        ($("presetSelect") as HTMLSelectElement).value = name;
        nameInput.value = "";
        setStatus(`Preset "${name}" salvo.`);
      } catch {
        setStatus("Erro ao salvar o preset.");
      }
    });
    $("applyPresetBtn").addEventListener("click", () => {
      const name = ($("presetSelect") as HTMLSelectElement).value;
      if (!name) {
        setStatus("Selecione um preset para aplicar.");
        return;
      }
      const preset = presetCache.find((p) => p.name === name);
      if (!preset) return;
      applyPreset(preset.data);
      setStatus(`Preset "${name}" aplicado.`);
    });
    $("deletePresetBtn").addEventListener("click", async () => {
      const select = $<HTMLSelectElement>("presetSelect");
      const name = select.value;
      if (!name) {
        setStatus("Selecione um preset para excluir.");
        return;
      }
      const preset = presetCache.find((p) => p.name === name);
      if (!preset) return;
      if (!window.confirm(`Excluir o preset "${name}"?`)) return;
      try {
        const res = await fetch(`/api/presets/${preset.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        await refreshPresetSelect();
        setStatus(`Preset "${name}" excluído.`);
      } catch {
        setStatus("Erro ao excluir o preset.");
      }
    });

    $("customWidth").addEventListener("input", syncWidth);
    $("customHeight").addEventListener("input", syncHeight);
    $("customWidth").addEventListener("change", syncWidth);
    $("customHeight").addEventListener("change", syncHeight);
    $("sizeUnit").addEventListener("change", changeUnit);

    const onFileInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const f = target.files?.[0];
      if (!f) return;
      loading(true, "Carregando imagem...");
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => {
        img = im;
        imgName = f.name;
        manualBgColor = false;
        aspectRatio = im.naturalWidth / Math.max(1, im.naturalHeight);
        $("fileName").textContent = f.name;
        setCustomInputsFromPx(im.naturalWidth, im.naturalHeight);
        updateFileMeta();
        URL.revokeObjectURL(url);
        process();
      };
      im.onerror = () => {
        loading(false);
        setStatus("Erro ao carregar imagem.");
      };
      im.src = url;
    };
    $("fileInput").addEventListener("change", onFileInput);

    container.querySelectorAll<HTMLButtonElement>(".mode").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll(".mode").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        mode = b.dataset.mode as typeof mode;
        if (mode === "color" && !manualBgColor) detectBorderColor(false);
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#quickHeightChips .chip").forEach((b) =>
      b.addEventListener("click", () => setQuickHeightCm(Number(b.dataset.heightCm)))
    );
    $("restoreSizeBtn").addEventListener("click", restoreOriginalSize);
    $("lockRatio").addEventListener("change", () => {
      lockRatio = ($("lockRatio") as HTMLInputElement).checked;
    });
    $("fillFrame").addEventListener("change", () => {
      fillFrame = ($("fillFrame") as HTMLInputElement).checked;
      render();
      fit();
    });
    $("removeHalo").addEventListener("change", () => {
      removeHalo = ($("removeHalo") as HTMLInputElement).checked;
      process();
    });
    $("edgeSoftness").addEventListener("input", () => {
      edgeSoftness = Number(($("edgeSoftness") as HTMLInputElement).value);
      labels();
    });
    $("edgeSoftness").addEventListener("change", () => {
      edgeSoftness = Number(($("edgeSoftness") as HTMLInputElement).value);
      process();
    });
    container.querySelectorAll<HTMLButtonElement>("#dpiChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        const beforePx = img ? getCustomPx() : null;
        container.querySelectorAll("#dpiChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        dpi = Number(b.dataset.dpi);
        if (img && beforePx) setCustomInputsFromPx(beforePx[0], beforePx[1]);
        updateFileMeta();
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#halftoneProfileChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#halftoneProfileChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        applyHalftoneProfile((b.dataset.profile as HalftoneProfile) || "am_conventional");
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#whiteModeChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#whiteModeChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        whiteMode = (b.dataset.white as WhiteMode) || "none";
        $("whiteWrap").style.display = whiteMode === "none" ? "none" : "block";
        process();
      })
    );
    $("whiteDensity").addEventListener("input", () => {
      whiteDensity = Number(($("whiteDensity") as HTMLInputElement).value) / 100;
      labels();
    });
    $("whiteDensity").addEventListener("change", process);
    $("whiteChoke").addEventListener("input", () => {
      whiteChoke = Number(($("whiteChoke") as HTMLInputElement).value);
      labels();
    });
    $("whiteChoke").addEventListener("change", process);
    ["removePower", "bgPower", "colorResidual", "saturation", "contrast", "colorTol"].forEach((id) => {
      const el = container.querySelector<HTMLInputElement>("#" + id);
      if (!el) return;
      el.addEventListener("input", labels);
      el.addEventListener("change", process);
    });
    $("processBtn").addEventListener("click", process);
    $("saveBtn").addEventListener("click", save);
    $("fitBtn").addEventListener("click", fit);
    $("zoom").addEventListener("input", (e) => {
      zoom = Number((e.target as HTMLInputElement).value) / 100;
      applyZoom();
    });

    function zoomAtMouse(e: WheelEvent) {
      if (!result.width) return;
      e.preventDefault();
      const viewer = $("viewer");
      const viewerRect = viewer.getBoundingClientRect();
      const oldZoom = zoom;
      const localX = e.clientX - viewerRect.left;
      const localY = e.clientY - viewerRect.top;
      const contentX = viewer.scrollLeft + localX;
      const contentY = viewer.scrollTop + localY;
      const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = clamp(zoom * delta, 0.05, 3);
      if (Math.abs(nextZoom - zoom) < 0.0001) return;
      const scale = nextZoom / Math.max(oldZoom, 0.0001);
      zoom = nextZoom;
      ($("zoom") as HTMLInputElement).value = String(Math.round(zoom * 100));
      applyZoom();
      requestAnimationFrame(() => {
        viewer.scrollLeft = contentX * scale - localX;
        viewer.scrollTop = contentY * scale - localY;
      });
    }
    $("viewer").addEventListener("wheel", zoomAtMouse, { passive: false });

    let isDraggingPreview = false;
    let dragStartX = 0,
      dragStartY = 0,
      dragScrollLeft = 0,
      dragScrollTop = 0,
      dragMoved = false;

    function canDragPreview(e: PointerEvent) {
      if (!result.width) return false;
      if (e.button !== 0) return false;
      if (pickingBg) return false;
      if ((e.target as HTMLElement).closest("button,input,label,select")) return false;
      return true;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!canDragPreview(e)) return;
      isDraggingPreview = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragScrollLeft = $("viewer").scrollLeft;
      dragScrollTop = $("viewer").scrollTop;
      $("viewer").classList.add("dragging");
      $("viewer").setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingPreview) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
      const viewer = $("viewer");
      viewer.scrollLeft = dragScrollLeft - dx;
      viewer.scrollTop = dragScrollTop - dy;
    };
    const stopPreviewDrag = (e: PointerEvent) => {
      if (!isDraggingPreview) return;
      isDraggingPreview = false;
      $("viewer").classList.remove("dragging");
      try {
        $("viewer").releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    $("viewer").addEventListener("pointerdown", onPointerDown);
    $("viewer").addEventListener("pointermove", onPointerMove);
    $("viewer").addEventListener("pointerup", stopPreviewDrag);
    $("viewer").addEventListener("pointercancel", stopPreviewDrag);
    $("viewer").addEventListener("pointerleave", stopPreviewDrag);

    const beforeBtn = $("beforeBtn");
    const onBeforeDown = () => {
      if (!result.width) return;
      showBefore = true;
      render();
      beforeBtn.classList.add("active");
    };
    const onBeforeUp = () => {
      if (!result.width) return;
      showBefore = false;
      render();
      beforeBtn.classList.remove("active");
    };
    beforeBtn.addEventListener("pointerdown", onBeforeDown);
    ["pointerup", "pointercancel", "mouseleave"].forEach((ev) => beforeBtn.addEventListener(ev, onBeforeUp));

    container.querySelectorAll<HTMLButtonElement>(".bgbtn").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll(".bgbtn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        previewBg = b.dataset.bg as typeof previewBg;
        const w = $("canvasWrap");
        w.classList.remove("bg-black", "bg-white", "bg-custom");
        if (previewBg === "black") w.classList.add("bg-black");
        if (previewBg === "white") w.classList.add("bg-white");
        if (previewBg === "custom") {
          w.classList.add("bg-custom");
          $<HTMLInputElement>("customBg").click();
        }
      })
    );
    $<HTMLInputElement>("customBg").addEventListener("input", (e) => $("canvasWrap").style.setProperty("--custom-bg", (e.target as HTMLInputElement).value));
    $("detectBgBtn").addEventListener("click", () => {
      manualBgColor = false;
      detectBorderColor(false);
      setStatus("Cor da borda detectada: " + hex(sampledBgColor));
      if (mode === "color") process();
    });
    $("pickBgBtn").addEventListener("click", () => {
      pickingBg = !pickingBg;
      $("pickBgBtn").classList.toggle("on", pickingBg);
      updatePickCursor();
      if (pickingBg) {
        setStatus("Conta-gotas ativo: clique na cor do fundo.");
        showBefore = true;
        render();
      } else {
        showBefore = false;
        render();
      }
    });
    const onCanvasClick = (e: MouseEvent) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      if (!img) return;
      if (!pickingBg) return;
      const c = mapClickToPixel(e);
      setBgColor(c, true);
      pickingBg = false;
      $("pickBgBtn").classList.remove("on");
      updatePickCursor();
      setStatus("Cor do fundo selecionada: " + hex(sampledBgColor));
      process();
    };
    viewCanvas.addEventListener("click", onCanvasClick);

    const mobilePreviewJump = container.querySelector("#mobilePreviewJump");
    const onJumpClick = () => {
      $("viewer").scrollIntoView({ behavior: "smooth", block: "center" });
      if (result.width) setTimeout(fit, 260);
    };
    mobilePreviewJump?.addEventListener("click", onJumpClick);

    let resizeTimer = 0;
    function responsiveFit() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (result.width) fit();
      }, 140);
    }
    window.addEventListener("resize", responsiveFit);
    const onOrientation = () => setTimeout(responsiveFit, 220);
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", responsiveFit);

    applyHalftoneProfile("am_conventional");
    labels();
    updateExportState();

    return () => {
      window.removeEventListener("resize", responsiveFit);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", responsiveFit);
    };
  }, []);

  return (
    <div className="hop-root" ref={rootRef}>
      <div className="hop-session-bar" aria-label="Sessão de acesso">
        <span>Acesso <b>liberado</b></span>
        <a href="/api/auth/logout">SAIR</a>
      </div>
      <div className="app">
        <aside id="sidePanel" className="side">
          <div className="brand">
            <div className="logo">
              <img src="/assets/favicon.png" alt="Halftone Studio" />
            </div>
            <div>
              <h1>Halftone Studio</h1>
              <div className="sub">crie halftone pronto para DTF em poucos cliques</div>
            </div>
          </div>
          <label className="drop" htmlFor="fileInput">
            <strong>Selecionar imagem</strong>
            <span>PNG, JPG ou WebP</span>
            <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <div className="filebox">
            <b id="fileName">Nenhuma imagem carregada</b>
            <span id="fileMeta">Carregue uma imagem para começar.</span>
          </div>

          <div className="section">
            <div className="sectionTitle">Presets</div>
            <div className="dica">
              <b>Dica:</b> salve as configurações atuais com um nome e aplique depois em qualquer outra imagem.
            </div>
            <div className="customField">
              <label>Nome do preset</label>
              <input id="presetName" type="text" placeholder="Ex: Camiseta preta 300dpi" />
            </div>
            <button id="savePresetBtn" className="smallBtn" type="button" style={{ width: "100%", marginTop: 8 }}>
              Salvar preset atual
            </button>
            <div className="customField" style={{ marginTop: 10 }}>
              <label>Presets salvos</label>
              <select id="presetSelect" className="unitSelect">
                <option value="">Nenhum preset salvo</option>
              </select>
            </div>
            <div className="protectTop" style={{ marginTop: 8 }}>
              <button id="applyPresetBtn" className="smallBtn" type="button" style={{ flex: 1 }}>
                Aplicar preset
              </button>
              <button id="deletePresetBtn" className="smallBtn warn" type="button" style={{ flex: 1 }}>
                Excluir preset
              </button>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Tipo de fundo</div>
            <div className="modes">
              <button className="mode active" data-mode="dark" title="Use quando o fundo da imagem é preto ou bem escuro.">
                Fundo escuro <span>ideal para artes em fundo preto</span>
              </button>
              <button className="mode" data-mode="color" title="Use quando o fundo tem uma cor forte, como amarelo, azul, vermelho ou verde.">
                Fundo colorido <span>remove a cor do fundo</span>
              </button>
              <button className="mode" data-mode="light" title="Use quando o fundo é branco, cinza claro ou quase branco.">
                Fundo claro <span>remove branco e cinza claro</span>
              </button>
            </div>
            <div className="dica">
              <b>Dica:</b> escolha o fundo mais parecido com a imagem para a limpeza ficar mais precisa.
            </div>
            <label className="checkRow">
              <input id="removeHalo" type="checkbox" />
              Remover halo da cor do fundo
            </label>
            <div className="dica">
              <b>Dica:</b> ativa uma limpeza extra na borda do recorte para tirar aquele contorno fino da cor do fundo que às vezes sobra.
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label>Suavização de borda</label>
              <span className="val" id="edgeSoftnessVal">45</span>
            </div>
            <input id="edgeSoftness" type="range" min={0} max={100} defaultValue={45} step={1} />
            <div className="miniText" style={{ marginTop: 6 }}>
              <b>Dica:</b> aumenta a transição do recorte para reduzir serrilhado. Valores muito altos podem suavizar detalhes muito finos.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Tamanho da arte</div>
            <div className="customSizeBox">
              <div className="unitRow">
                <div className="customField">
                  <label>Unidade</label>
                  <select id="sizeUnit" className="unitSelect" defaultValue="cm">
                    <option value="cm">Centímetros</option>
                    <option value="mm">Milímetros</option>
                    <option value="px">Pixels</option>
                    <option value="in">Polegadas</option>
                  </select>
                </div>
              </div>
              <div className="customSizeRow">
                <div className="customField">
                  <label>Largura</label>
                  <input id="customWidth" type="number" min={1} step={0.1} defaultValue={20} />
                </div>
                <div className="customField">
                  <label>Altura</label>
                  <input id="customHeight" type="number" min={1} step={0.1} defaultValue={20} />
                </div>
              </div>
              <label className="checkRow">
                <input id="lockRatio" type="checkbox" defaultChecked />
                Travar proporção
              </label>
              <div className="miniText">
                <b>Dica:</b> largura e altura já vêm preenchidas com o tamanho do arquivo original. Com a proporção travada, mudar uma medida ajusta a outra automaticamente.
              </div>
              <div className="chips" id="quickHeightChips" style={{ marginTop: 10 }}>
                <button className="chip" data-height-cm="56" title="Define a altura em 56cm e calcula a largura proporcional.">
                  A2 · 56cm
                </button>
                <button className="chip" data-height-cm="40" title="Define a altura em 40cm e calcula a largura proporcional.">
                  A3 · 40cm
                </button>
                <button className="chip" data-height-cm="28" title="Define a altura em 28cm e calcula a largura proporcional.">
                  A4 · 28cm
                </button>
              </div>
              <button id="restoreSizeBtn" className="smallBtn" type="button" style={{ marginTop: 10, width: "100%" }}>
                Restaurar tamanho original
              </button>
              <label className="checkRow" style={{ marginTop: 10 }}>
                <input id="fillFrame" type="checkbox" defaultChecked />
                Preencher o quadro com a arte (sem sobra)
              </label>
              <div className="miniText">
                <b>Dica:</b> corta as bordas transparentes da arte para preencher todo o quadro escolhido, sem sobra de fundo.
              </div>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Motor de halftone</div>
            <div className="dica">
              <b>Halftone PRO RGB.</b> Retícula real AM/FM/Híbrida em padrão RGB, com White Underbase opcional.
            </div>
          </div>

          <div className="section" id="proScreenSection">
            <div className="sectionTitle">Retícula profissional (simples)</div>
            <div className="dica">
              <b>Escolha o tipo de retícula.</b> O motor RGB aplica o padrão escolhido na arte sem separar em CMYK.
            </div>
            <div className="chips" id="halftoneProfileChips">
              <button className="chip active" data-profile="am_conventional">AM Convencional</button>
              <button className="chip" data-profile="am_ellipse">AM Elíptica</button>
              <button className="chip" data-profile="am_rosette">Roseta</button>
              <button className="chip" data-profile="fm_stochastic">FM Estocástica</button>
              <button className="chip" data-profile="hybrid">Híbrida</button>
            </div>
            <div className="miniText" id="profileInfo" style={{ marginTop: 8 }}>
              AM Convencional • 45 LPI • round
            </div>
            <div className="dica" style={{ marginTop: 8 }}>
              <b>Exportação:</b> PNG final RGB com retícula em 300 DPI, pronto para impressão.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Qualidade da imagem</div>
            <div className="dica">
              <b>Dica:</b> 300 DPI já resolve a maioria dos trabalhos DTF. Use 600 ou 1200 para arquivos maiores e mais detalhados.
            </div>
            <div className="chips" id="dpiChips">
              <button className="chip active" data-dpi="300">
                300
              </button>
              <button className="chip" data-dpi="600">
                600
              </button>
              <button className="chip" data-dpi="1200">
                1200
              </button>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">White Underbase</div>
            <div className="dica">
              <b>Dica:</b> gera a camada de tinta branca (base) separada da cor, para impressão DTF sobre tecidos escuros.
            </div>
            <div className="chips" id="whiteModeChips">
              <button className="chip active" data-white="none">
                Nenhum
              </button>
              <button className="chip" data-white="solid">
                Sólido
              </button>
              <button className="chip" data-white="halftone">
                Halftone
              </button>
            </div>
            <div id="whiteWrap" style={{ display: "none", marginTop: 10 }}>
              <div className="row" style={{ marginTop: 10 }}>
                <label>Densidade</label>
                <span className="val" id="whiteDensityVal">100%</span>
              </div>
              <input id="whiteDensity" type="range" min={0} max={100} defaultValue={100} step={1} />
              <div className="row" style={{ marginTop: 10 }}>
                <label>Choke (contração)</label>
                <span className="val" id="whiteChokeVal">2px</span>
              </div>
              <input id="whiteChoke" type="range" min={0} max={20} defaultValue={2} step={0.5} />
              <div className="dica">
                <b>Dica:</b> o branco é um canal independente do alpha/cor. Choke encolhe geometricamente a base branca para evitar halo nas bordas.
              </div>
            </div>
          </div>

          <div className="section">
            <div className="row">
              <label>Limpeza da borda</label>
              <span className="val" id="removeVal">50</span>
            </div>
            <input id="removePower" type="range" min={5} max={110} defaultValue={50} step={1} />
            <div className="dica">
              <b>Dica:</b> limpa a borda externa da imagem. Use mais quando sobrar contorno do fundo.
            </div>
          </div>
          <div className="section">
            <div className="row">
              <label>Limpeza do fundo</label>
              <span className="val" id="bgPowerVal">0</span>
            </div>
            <input id="bgPower" type="range" min={0} max={200} defaultValue={0} step={1} />
            <div className="sub" style={{ marginTop: 6 }}>
              Aumenta a limpeza geral do fundo. Acima de 120 entra em limpeza agressiva para remover sujeira, resíduos e a própria cor do fundo que ainda sobra no resultado.
            </div>
          </div>
          <div className="section" id="colorResidualWrap">
            <div className="row">
              <label>Cor residual do fundo</label>
              <span className="val" id="colorResidualVal">80</span>
            </div>
            <input id="colorResidual" type="range" min={0} max={200} defaultValue={80} step={1} />
            <div className="sub" style={{ marginTop: 6 }}>
              Controle extra do modo Fundo colorido. Aumenta a remoção da cor que ainda sobra na arte depois de tirar o fundo.
            </div>
          </div>
          <div className="section" id="colorSection">
            <div className="sectionTitle">Cor do fundo</div>
            <div className="colorPickBox">
              <div id="bgColorSwatch" className="colorSwatch" />
              <div>
                <b id="bgColorText">#000000</b>
                <div className="miniText">Cor que será removida do fundo</div>
              </div>
            </div>
            <div className="protectTop">
              <button id="detectBgBtn" className="smallBtn hot" title="Detecta automaticamente a cor que está nas bordas da imagem.">
                Detectar cor
              </button>
              <button id="pickBgBtn" className="smallBtn" title="Clique e depois escolha manualmente a cor do fundo na imagem.">
                Escolher cor
              </button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label>Variação da cor</label>
              <span className="val" id="colorTolVal">48</span>
            </div>
            <input id="colorTol" type="range" min={5} max={220} defaultValue={48} step={1} />
            <div className="miniText" style={{ marginTop: 7 }}>
              <b>Dica:</b> use “Detectar cor” para automático ou “Escolher cor” para clicar no fundo manualmente.
            </div>
          </div>

          <div className="section">
            <div className="row">
              <label>Saturação</label>
              <span className="val" id="satVal">132%</span>
            </div>
            <input id="saturation" type="range" min={80} max={220} defaultValue={132} step={2} />
            <div className="dica">
              <b>Dica:</b> aumenta ou reduz a força das cores antes de gerar o halftone.
            </div>
          </div>
          <div className="section">
            <div className="row">
              <label>Contraste</label>
              <span className="val" id="contrastVal">22</span>
            </div>
            <input id="contrast" type="range" min={-40} max={90} defaultValue={22} step={1} />
            <div className="dica">
              <b>Dica:</b> mais contraste deixa áreas claras e escuras mais separadas.
            </div>
          </div>

          <div className="actions">
            <button id="processBtn" className="primary">Gerar halftone</button>
            <button id="saveBtn" className="secondary">Baixar PNG (300 DPI)</button>
          </div>
        </aside>

        <main className="main">
          <div className="mainTop">
            <div>
              <div className="title">Prévia da arte</div>
              <div id="status" className="status">Carregue uma imagem.</div>
              <label className="mobileUpload" htmlFor="fileInput">
                <strong>Selecionar imagem</strong>
                <span>PNG, JPG ou WebP</span>
              </label>
            </div>
            <div className="toolbar">
              <div className="previewBg">
                <button className="bgbtn checker active" data-bg="checker" title="Transparente" />
                <button className="bgbtn black" data-bg="black" title="Preto" />
                <button className="bgbtn white" data-bg="white" title="Branco" />
                <button className="bgbtn custom" data-bg="custom" title="Personalizado" />
                <input id="customBg" type="color" defaultValue="#211136" />
              </div>
              <button id="beforeBtn" className="toolbtn">Ver antes</button>
              <button id="fitBtn" className="toolbtn">Ajustar</button>
              <div className="zoomBox">
                <label>Zoom</label>
                <input id="zoom" type="range" min={5} max={300} defaultValue={100} step={5} />
                <span id="zoomVal" className="val">100%</span>
              </div>
            </div>
          </div>
          <div id="viewer" className="viewer">
            <div className="stage">
              <div id="canvasWrap" className="canvasWrap">
                <div id="badge" className="badge">Depois / resultado</div>
                <canvas id="viewCanvas" />
                <div id="zoomBadge" className="zoomBadge">100%</div>
              </div>
            </div>
            <div id="empty" className="empty">Carregue uma imagem</div>
            <div id="stageLoading" className="stageLoading"><span>Processando...</span></div>
          </div>
          <div className="footer">
            <span id="sizeInfo">Sem imagem</span>
            <span className="hint">Preview = zoom • arraste para navegar • segure Ver antes</span>
          </div>
        </main>
      </div>
      <button id="mobilePreviewJump" className="mobilePreviewJump" type="button" aria-label="Ir para a prévia">
        ◉ Ver prévia
      </button>
    </div>
  );
}
