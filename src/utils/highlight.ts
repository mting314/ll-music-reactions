/**
 * Client-side automatic song highlight (chorus / hook) detector.
 *
 * Pure TypeScript with zero external dependencies so it can run inside a Web
 * Worker on the mono PCM buffer already decoded by Web Audio API, or directly
 * in Bun unit tests.
 *
 * Algorithm overview (tuned for J-pop / Love Live! song structure):
 *  1. Decimate mono PCM to ~11 kHz and run a 1024-pt Hann-windowed radix-2 FFT
 *     at 4 Hz (0.25s hop) to extract 12-bin chromagrams + vocal-band RMS
 *     (300 Hz – 3.5 kHz) + full-band RMS.
 *  2. Build a repeating-segment score via a chroma lag matrix (same principle
 *     as pychorus): choruses repeat 2–3× with matching harmony, separating the
 *     sabi from loud intros, bridges, or guitar solos.
 *  3. Combine repetition, 4s-window vocal energy, and a gentle structural
 *     prior; walk to the leading edge of the winning chorus plateau so playback
 *     starts at the drop rather than mid-chorus.
 *  4. Snap within ±0.6s (20ms hop) to the nearest sharp energy onset so the
 *     clip hits cleanly on a beat/vocal entry.
 */

export interface HighlightOptions {
  /** Known leading silence offset in seconds (from `detectLeadIn`). */
  leadIn?: number;
  /** Minimum playable tail to keep after the returned timestamp (seconds). */
  minTailSec?: number;
}

const TARGET_SR = 11025;
const FFT_SIZE = 1024;
const HOP_SEC = 0.25;
const NUM_CHROMA = 12;

/** In-place iterative Cooley-Tukey radix-2 FFT (length must be a power of 2). */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + half]! * curRe - im[i + j + half]! * curIm;
        const vIm = re[i + j + half]! * curIm + im[i + j + half]! * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Downsample mono PCM by integer boxcar averaging toward TARGET_SR. */
function decimate(
  samples: Float32Array,
  sampleRate: number,
): { pcm: Float32Array; sr: number } {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_SR));
  if (factor === 1) return { pcm: samples, sr: sampleRate };
  const outLen = Math.floor(samples.length / factor);
  const pcm = new Float32Array(outLen);
  const inv = 1 / factor;
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += samples[base + k]!;
    pcm[i] = sum * inv;
  }
  return { pcm, sr: sampleRate / factor };
}

/** Normalize an array over [lo, hi] (inclusive) into [0, 1]. */
function normalizeRange(arr: Float32Array, lo: number, hi: number): Float32Array {
  const out = new Float32Array(arr.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const v = arr[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (span <= 1e-9) return out;
  for (let i = lo; i <= hi; i++) {
    out[i] = (arr[i]! - min) / span;
  }
  return out;
}

/**
 * Snap a coarse timestamp (seconds) to the strongest sharp energy onset in a
 * local window so playback starts cleanly on a downbeat or vocal phrase entry
 * rather than slightly late into a syllable.
 */
function snapToLocalOnset(
  samples: Float32Array,
  sampleRate: number,
  approxSec: number,
  minSec: number,
  maxSec: number,
): number {
  const windowBefore = 0.7;
  const windowAfter = 0.5;
  const startSec = Math.max(minSec, approxSec - windowBefore);
  const endSec = Math.min(maxSec, approxSec + windowAfter);
  if (endSec - startSec < 0.1) return approxSec;

  const hopSamples = Math.max(1, Math.floor(0.02 * sampleRate)); // 20ms steps
  const winSamples = Math.max(1, Math.floor(0.04 * sampleRate)); // 40ms RMS
  const startIdx = Math.floor(startSec * sampleRate);
  const endIdx = Math.min(samples.length - winSamples, Math.floor(endSec * sampleRate));
  const numSteps = Math.floor((endIdx - startIdx) / hopSamples);
  if (numSteps < 4) return approxSec;

  const rms = new Float32Array(numSteps);
  for (let s = 0; s < numSteps; s++) {
    const off = startIdx + s * hopSamples;
    let sumSq = 0;
    for (let j = 0; j < winSamples; j++) {
      const v = samples[off + j]!;
      sumSq += v * v;
    }
    rms[s] = Math.sqrt(sumSq / winSamples);
  }

  // Look for the sharpest positive RMS jump (half-wave rectified energy flux),
  // slightly preferring onsets close to approxSec.
  let bestScore = -1;
  let bestSec = approxSec;
  for (let s = 2; s < numSteps; s++) {
    const prevAvg = 0.5 * (rms[s - 1]! + rms[s - 2]!);
    const jump = rms[s]! - prevAvg;
    if (jump <= 0) continue;
    const candSec = (startIdx + s * hopSamples) / sampleRate;
    const dist = Math.abs(candSec - approxSec);
    // Gentle Gaussian preference for staying close to approxSec
    const prox = Math.exp(-0.5 * (dist / 0.45) ** 2);
    const score = jump * prox;
    if (score > bestScore) {
      bestScore = score;
      bestSec = candSec;
    }
  }

  return Math.min(maxSec, Math.max(minSec, bestSec));
}

/**
 * Detect a single default start timestamp (in absolute file seconds) targeting
 * the main chorus / hook of a song.
 *
 * Always returns a finite value rounded to the millisecond, clamped within
 * `[leadIn, max(leadIn, duration - minTailSec)]`.
 */
export function detectHighlightStart(
  samples: Float32Array,
  sampleRate: number,
  { leadIn = 0, minTailSec = 4 }: HighlightOptions = {},
): number {
  if (!sampleRate || samples.length === 0) return 0;

  const duration = samples.length / sampleRate;
  const safeLead = Math.max(0, Math.min(leadIn, duration));
  const maxStart = Math.max(safeLead, duration - minTailSec);
  const audibleDur = duration - safeLead;

  // Very short audio (jingles, sound effects, < 8s): start at music onset.
  if (audibleDur < 8) {
    return Math.round(safeLead * 1000) / 1000;
  }

  // 1. Decimate & compute 4 Hz chromagram + vocal-band energy
  const { pcm, sr } = decimate(samples, sampleRate);
  const hop = Math.max(1, Math.round(HOP_SEC * sr));
  const numFrames = Math.floor((pcm.length - FFT_SIZE) / hop) + 1;
  if (numFrames < 16) {
    return Math.round(safeLead * 1000) / 1000;
  }

  // Precompute Hann window & FFT bin → chroma / vocal-band lookup
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  const halfN = FFT_SIZE >> 1;
  const binChroma = new Int8Array(halfN).fill(-1);
  const vocalLoBin = Math.max(1, Math.ceil((300 * FFT_SIZE) / sr));
  const vocalHiBin = Math.min(halfN - 1, Math.floor((3500 * FFT_SIZE) / sr));

  for (let k = 1; k < halfN; k++) {
    const freq = (k * sr) / FFT_SIZE;
    if (freq >= 65 && freq <= 2100) {
      const midi = Math.round(12 * Math.log2(freq / 440)) + 69;
      binChroma[k] = ((midi % 12) + 12) % 12;
    }
  }

  const chromaRaw = new Float32Array(numFrames * NUM_CHROMA);
  const vocalEnergy = new Float32Array(numFrames);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  let maxVocal = 0;
  for (let f = 0; f < numFrames; f++) {
    const base = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = pcm[base + i]! * hann[i]!;
      im[i] = 0;
    }
    fftInPlace(re, im);

    const cOff = f * NUM_CHROMA;
    let vSum = 0;
    for (let k = 1; k < halfN; k++) {
      const magSq = re[k]! * re[k]! + im[k]! * im[k]!;
      const mag = Math.sqrt(magSq);
      const pc = binChroma[k]!;
      if (pc >= 0) {
        // Magnitude (rather than squared power) keeps synth/vocal harmonies
        // balanced against loud drums/bass in dense J-pop mixes.
        chromaRaw[cOff + pc] = chromaRaw[cOff + pc]! + mag;
      }
      if (k >= vocalLoBin && k <= vocalHiBin) {
        vSum += magSq;
      }
    }
    const vRms = Math.sqrt(vSum);
    vocalEnergy[f] = vRms;
    if (vRms > maxVocal) maxVocal = vRms;
  }

  // Silent file guard
  if (maxVocal < 1e-6) {
    return Math.round(safeLead * 1000) / 1000;
  }

  // Smooth chroma over 1.0s (4 frames) & L2-normalize each frame
  const chroma = new Float32Array(numFrames * NUM_CHROMA);
  const smoothHalf = 2;
  for (let f = 0; f < numFrames; f++) {
    const fLo = Math.max(0, f - smoothHalf);
    const fHi = Math.min(numFrames - 1, f + smoothHalf);
    const dst = f * NUM_CHROMA;
    let normSq = 0;
    for (let p = 0; p < NUM_CHROMA; p++) {
      let s = 0;
      for (let g = fLo; g <= fHi; g++) s += chromaRaw[g * NUM_CHROMA + p]!;
      chroma[dst + p] = s;
      normSq += s * s;
    }
    if (normSq > 1e-10) {
      const invNorm = 1 / Math.sqrt(normSq);
      for (let p = 0; p < NUM_CHROMA; p++) chroma[dst + p] = chroma[dst + p]! * invNorm;
    }
  }

  // Forward 4s window mean vocal energy (matches ~3.6s reaction clip length)
  const clipFrames = Math.max(4, Math.round(4.0 / HOP_SEC)); // 16 frames
  const vocalWin = new Float32Array(numFrames);
  const prefixV = new Float64Array(numFrames + 1);
  for (let f = 0; f < numFrames; f++) prefixV[f + 1] = prefixV[f]! + vocalEnergy[f]!;
  for (let f = 0; f < numFrames; f++) {
    const end = Math.min(numFrames, f + clipFrames);
    vocalWin[f] = (prefixV[end]! - prefixV[f]!) / (end - f);
  }

  // Candidate frame search bounds: [loFrame, hiFrame]
  const leadFrame = Math.min(numFrames - 1, Math.floor(safeLead / HOP_SEC));
  // Avoid final 10s fade-out on full songs, or minTailSec on short tracks
  const tailAvoidSec = audibleDur >= 45 ? Math.max(minTailSec, 10) : minTailSec;
  const loFrame = Math.min(numFrames - 1, leadFrame);
  const hiFrame = Math.max(
    loFrame,
    Math.min(numFrames - 1, Math.floor((duration - tailAvoidSec) / HOP_SEC)),
  );

  // 2. Chroma Self-Similarity Lag Matrix (chorus repetition)
  // Evaluate repeating segments of length `segFrames` (~14s) separated by at
  // least `minLag` (~25s). Use prefix sums along each diagonal `lag` for O(N^2)
  // with tiny constant factor (~0.5M flops for a 4-min track → < 5ms).
  const repScore = new Float32Array(numFrames);
  const segFrames = Math.round(14 / HOP_SEC); // 56 frames = 14s
  const minLag = Math.round(25 / HOP_SEC); // 100 frames = 25s
  let maxRep = 0;

  if (audibleDur >= 55 && numFrames > minLag + segFrames) {
    const diagDot = new Float32Array(numFrames);
    const diagPrefix = new Float32Array(numFrames + 1);

    for (let lag = minLag; lag <= numFrames - segFrames; lag++) {
      const limit = numFrames - lag;
      diagPrefix[0] = 0;
      for (let t = 0; t < limit; t++) {
        const a = t * NUM_CHROMA;
        const b = (t + lag) * NUM_CHROMA;
        let dot = 0;
        for (let p = 0; p < NUM_CHROMA; p++) {
          dot += chroma[a + p]! * chroma[b + p]!;
        }
        diagDot[t] = dot;
        diagPrefix[t + 1] = diagPrefix[t]! + dot;
      }

      const maxStartT = limit - segFrames;
      const invSeg = 1 / segFrames;
      for (let t = loFrame; t <= maxStartT; t++) {
        const sim = (diagPrefix[t + segFrames]! - diagPrefix[t]!) * invSeg;
        // Credit both the first occurrence (t) and its repeat (t + lag)
        if (sim > repScore[t]!) repScore[t] = sim;
        const t2 = t + lag;
        if (t2 <= hiFrame && sim > repScore[t2]!) repScore[t2] = sim;
      }
    }

    for (let t = loFrame; t <= hiFrame; t++) {
      if (repScore[t]! > maxRep) maxRep = repScore[t]!;
    }
  }

  // 3. Combine repetition, vocal energy, energy-jump bonus, and structural prior
  const normRep = normalizeRange(repScore, loFrame, hiFrame);
  const normVoc = normalizeRange(vocalWin, loFrame, hiFrame);

  // Energy rise at frame t: compares 4s after t vs 4s before t (positive right
  // at the pre-chorus → chorus drop, helping pinpoint the chorus START).
  const energyJump = new Float32Array(numFrames);
  const preFrames = Math.round(4.0 / HOP_SEC);
  for (let t = loFrame; t <= hiFrame; t++) {
    const preLo = Math.max(loFrame, t - preFrames);
    const preMean =
      t > preLo ? (prefixV[t]! - prefixV[preLo]!) / (t - preLo) : vocalWin[t]!;
    energyJump[t] = Math.max(0, vocalWin[t]! - preMean);
  }
  const normJump = normalizeRange(energyJump, loFrame, hiFrame);

  // Use chorus-repetition weighting when a clear repeating section exists;
  // otherwise (short/TV-size tracks with only one chorus) lean on vocal energy.
  const hasStrongRepeat = maxRep >= 0.72;
  const combined = new Float32Array(numFrames);

  let bestFrame = loFrame;
  let bestScore = -Infinity;

  for (let t = loFrame; t <= hiFrame; t++) {
    const sec = t * HOP_SEC;
    const relPos = (sec - safeLead) / audibleDur;

    // Gentle structural prior: J-pop main choruses typically land between 15%
    // and 78% of the song. Slightly favor the 1st/2nd chorus over the very
    // first 10s (to avoid quiet sabi-iri teasers or instrument intros).
    let prior = 0.4;
    if (relPos >= 0.16 && relPos <= 0.78) {
      prior = 1.0;
    } else if (relPos >= 0.08 && relPos < 0.16) {
      prior = 0.65;
    }

    const score = hasStrongRepeat
      ? 0.50 * normRep[t]! +
        0.30 * normVoc[t]! +
        0.10 * normJump[t]! +
        0.10 * prior
      : 0.65 * normVoc[t]! + 0.20 * normJump[t]! + 0.15 * prior;

    combined[t] = score;
    if (score > bestScore) {
      bestScore = score;
      bestFrame = t;
    }
  }

  // Walk backward to the leading edge of the winning chorus plateau (up to 12s)
  // so we start right when the chorus enters rather than 4–6s into it.
  let chosenFrame = bestFrame;
  if (hasStrongRepeat) {
    const plateauThresh = bestScore * 0.88;
    const repFloor = repScore[bestFrame]! * 0.90;
    const vocFloor = vocalWin[bestFrame]! * 0.78;
    const maxWalk = Math.round(12 / HOP_SEC);
    for (let step = 1; step <= maxWalk; step++) {
      const prev = bestFrame - step;
      if (prev < loFrame) break;
      if (
        combined[prev]! >= plateauThresh &&
        repScore[prev]! >= repFloor &&
        vocalWin[prev]! >= vocFloor
      ) {
        chosenFrame = prev;
      } else {
        break;
      }
    }
  }

  const approxSec = Math.min(maxStart, Math.max(safeLead, chosenFrame * HOP_SEC));

  // 4. Snap to nearest crisp local energy onset
  const snapped = snapToLocalOnset(samples, sampleRate, approxSec, safeLead, maxStart);
  return Math.round(snapped * 1000) / 1000;
}
