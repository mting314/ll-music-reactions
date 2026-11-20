/**
 * Pure geometry, typography, and PCM audio-slicing helpers for client-side
 * MP4 video export. Kept free of DOM/WebCodecs APIs so every piece can be
 * unit-tested under `bun test`.
 */
import type { ExportSettings } from '@/types';

export type OverlayPosition = ExportSettings['overlayPosition'];
export type ExportResolution = ExportSettings['resolution'];

export interface OverlayMetrics {
  canvasSize: number;
  artSize: number;
  margin: number;
  fontSize: number;
  lineHeight: number;
  gap: number;
  boxPadX: number;
  boxPadY: number;
  artRadius: number;
}

export function exportDimensions(resolution: ExportResolution): number {
  return resolution === '720p' ? 720 : 480;
}

export function overlayMetrics(resolution: ExportResolution): OverlayMetrics {
  return resolution === '720p'
    ? {
        canvasSize: 720,
        artSize: 180,
        margin: 20,
        fontSize: 16,
        lineHeight: 20,
        gap: 6,
        boxPadX: 6,
        boxPadY: 4,
        artRadius: 8,
      }
    : {
        canvasSize: 480,
        artSize: 120,
        margin: 14,
        fontSize: 11,
        lineHeight: 14,
        gap: 4,
        boxPadX: 4,
        boxPadY: 3,
        artRadius: 6,
      };
}

/**
 * Compute center-crop source rectangle (`sx, sy, sw, sh`) so any source aspect
 * ratio fills the 1:1 square destination canvas without black bars.
 */
export function computeCoverCrop(
  srcW: number,
  srcH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (srcW <= 0 || srcH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (srcW > srcH) {
    const sw = srcH;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/** Approximate monospace visual width (CJK/fullwidth = 2, ASCII = 1). */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  return code > 0x2e7f ? 2 : 1;
}

function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/**
 * Wrap a song title onto at most 2 balanced lines sized to sit neatly beneath
 * the square album art (180px @ 720p ≈ 11 CJK chars = 22 visual units).
 * Splits near the visual midpoint (preferring spaces) so titles never leave a
 * lone hanging orphan character on line 2, and truncates with "…" if even 2
 * full lines exceed the budget.
 */
export function formatSongLabel(
  songName: string,
  maxLineWidth: number = 22,
): string[] {
  const clean = songName.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  const total = visualWidth(clean);
  if (total <= maxLineWidth) return [clean];

  const chars = Array.from(clean);
  const cumWidth: number[] = [];
  let acc = 0;
  for (const ch of chars) {
    acc += charWidth(ch);
    cumWidth.push(acc);
  }

  const target = total <= maxLineWidth * 2 ? total / 2 : maxLineWidth;

  let bestSpace = -1;
  let bestSpaceDist = Infinity;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== ' ') continue;
    const wBefore = i > 0 ? cumWidth[i - 1]! : 0;
    const wAfter = total - cumWidth[i]!;
    if (wBefore === 0 || wAfter === 0) continue;
    if (wBefore > maxLineWidth) break;
    if (total <= maxLineWidth * 2 && wAfter > maxLineWidth) continue;
    const dist = Math.abs(wBefore - target);
    if (dist < bestSpaceDist) {
      bestSpaceDist = dist;
      bestSpace = i;
    }
  }

  let line1: string;
  let rest: string;
  if (bestSpace !== -1 && bestSpaceDist <= maxLineWidth * 0.35) {
    line1 = chars.slice(0, bestSpace).join('').trim();
    rest = chars.slice(bestSpace + 1).join('').trim();
  } else {
    let splitIdx = 1;
    let bestDist = Infinity;
    for (let i = 0; i < chars.length - 1; i++) {
      const w1 = cumWidth[i]!;
      const w2 = total - w1;
      if (w1 > maxLineWidth) break;
      if (total <= maxLineWidth * 2 && w2 > maxLineWidth) continue;
      const dist = Math.abs(w1 - target);
      if (dist < bestDist) {
        bestDist = dist;
        splitIdx = i + 1;
      }
    }
    line1 = chars.slice(0, splitIdx).join('').trim();
    rest = chars.slice(splitIdx).join('').trim();
  }

  if (!rest) return [line1];
  if (visualWidth(rest) <= maxLineWidth) return [line1, rest];

  let w2 = 0;
  let cut = 0;
  const restChars = Array.from(rest);
  const budget = Math.max(2, maxLineWidth - 2);
  for (let i = 0; i < restChars.length; i++) {
    const cw = charWidth(restChars[i]!);
    if (w2 + cw > budget) break;
    w2 += cw;
    cut = i + 1;
  }
  const line2 = restChars.slice(0, cut).join('').trimEnd() + '…';
  return [line1, line2];
}

export interface OverlayRects {
  artX: number;
  artY: number;
  artSize: number;
  labelCenterX: number;
  labelTopY: number;
}

/**
 * Compute pixel coordinates for the album art and the song-name label right
 * below it. On bottom corners, lifts the album art up by the exact label block
 * height so the song name always sits cleanly inside the frame below the art.
 */
export function computeOverlayRects(
  position: OverlayPosition,
  resolution: ExportResolution,
  labelLineCount: number,
): OverlayRects {
  const m = overlayMetrics(resolution);
  const isRight = position === 'top-right' || position === 'bottom-right';
  const isBottom = position === 'bottom-left' || position === 'bottom-right';

  const labelBlockHeight =
    labelLineCount > 0
      ? m.gap + labelLineCount * m.lineHeight + m.boxPadY * 2
      : 0;

  const artX = isRight ? m.canvasSize - m.artSize - m.margin : m.margin;
  const artY = isBottom
    ? m.canvasSize - m.artSize - m.margin - labelBlockHeight
    : m.margin;

  return {
    artX,
    artY,
    artSize: m.artSize,
    labelCenterX: artX + m.artSize / 2,
    labelTopY: artY + m.artSize + m.gap,
  };
}

/**
 * Slice and linearly resample a decoded song's channels into a fixed-length
 * stereo planar PCM pair `[left, right]` at `targetSampleRate`, with short
 * edge fades to prevent clicks/pops at clip boundaries.
 *
 * Returns silence if `channels` is empty or `startSec` lies past the end.
 */
export function sliceStereoPcm(
  channels: readonly Float32Array[],
  srcSampleRate: number,
  startSec: number,
  durationSec: number,
  targetSampleRate: number,
  fadeSec: number = 0.015,
): [Float32Array, Float32Array] {
  const outSamples = Math.max(0, Math.round(durationSec * targetSampleRate));
  const left = new Float32Array(outSamples);
  const right = new Float32Array(outSamples);

  if (outSamples === 0 || channels.length === 0 || srcSampleRate <= 0) {
    return [left, right];
  }

  const srcL = channels[0]!;
  const srcR = channels.length > 1 ? channels[1]! : srcL;
  const srcLen = srcL.length;
  if (srcLen === 0) return [left, right];

  const safeStart = Math.max(0, startSec);
  const ratio = srcSampleRate / targetSampleRate;
  const startOffset = safeStart * srcSampleRate;

  for (let i = 0; i < outSamples; i++) {
    const pos = startOffset + i * ratio;
    const idx = Math.floor(pos);
    if (idx >= srcLen) break;
    const frac = pos - idx;
    const nextIdx = Math.min(idx + 1, srcLen - 1);
    left[i] = srcL[idx]! * (1 - frac) + srcL[nextIdx]! * frac;
    right[i] = srcR[idx]! * (1 - frac) + srcR[nextIdx]! * frac;
  }

  // Apply short linear fade-in / fade-out at clip boundaries to eliminate pops
  const fadeSamples = Math.min(
    Math.floor(fadeSec * targetSampleRate),
    Math.floor(outSamples / 2),
  );
  for (let i = 0; i < fadeSamples; i++) {
    const g = i / fadeSamples;
    left[i] = left[i]! * g;
    right[i] = right[i]! * g;
    const tail = outSamples - 1 - i;
    left[tail] = left[tail]! * g;
    right[tail] = right[tail]! * g;
  }

  return [left, right];
}
