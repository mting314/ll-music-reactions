import { expect, test, describe } from 'bun:test';
import { detectHighlightStart } from './highlight';

const SR = 44100;

/** Synthesize a harmonic chord burst (fundamental + 2 overtones) into a buffer. */
function addChord(
  buf: Float32Array,
  sr: number,
  startSec: number,
  durSec: number,
  freqs: number[],
  amp: number,
) {
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(buf.length, Math.floor((startSec + durSec) * sr));
  const scale = amp / Math.max(1, freqs.length);
  for (let i = s0; i < s1; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of freqs) {
      v +=
        Math.sin(2 * Math.PI * f * t) +
        0.5 * Math.sin(2 * Math.PI * 2 * f * t);
    }
    buf[i] = buf[i]! + v * scale;
  }
}

describe('detectHighlightStart', () => {
  test('handles empty input and zero sample rate safely', () => {
    expect(detectHighlightStart(new Float32Array(0), SR)).toBe(0);
    expect(detectHighlightStart(new Float32Array(1000), 0)).toBe(0);
  });

  test('returns leadIn for silent or very short clips', () => {
    const silent = new Float32Array(SR * 30);
    expect(detectHighlightStart(silent, SR, { leadIn: 1.2 })).toBe(1.2);

    const shortBuf = new Float32Array(SR * 5);
    addChord(shortBuf, SR, 0.5, 4.0, [440, 554.37, 659.25], 0.5);
    expect(detectHighlightStart(shortBuf, SR, { leadIn: 0.5 })).toBe(0.5);
  });

  test('picks repeating chorus over an equally loud non-repeating intro', () => {
    // 130s synthetic song:
    //  - 0..2s: silent lead-in
    //  - 2..16s: loud non-repeating intro (F# / C# / G# dissonant cluster)
    //  - 16..48s: quieter verse (A minor)
    //  - 48..68s: Chorus 1 — 4-bar chord progression (C -> G -> Am -> F, 5s each)
    //  - 68..96s: quieter verse 2 (D minor)
    //  - 96..116s: Chorus 2 — exact same progression (C -> G -> Am -> F)
    //  - 116..130s: fade outro
    const dur = 130;
    const buf = new Float32Array(SR * dur);

    // Loud non-repeating intro (higher amplitude than chorus!)
    addChord(buf, SR, 2, 14, [370, 554.37, 830.6], 0.9);

    // Quiet verse 1
    addChord(buf, SR, 16, 32, [440, 523.25, 659.25], 0.25);

    // Repeating Chorus progression (C - G - Am - F, vocal range 523..1046 Hz)
    const addChorus = (start: number) => {
      addChord(buf, SR, start + 0, 5, [523.25, 659.25, 783.99], 0.7);
      addChord(buf, SR, start + 5, 5, [392.0, 493.88, 587.33], 0.7);
      addChord(buf, SR, start + 10, 5, [440.0, 523.25, 659.25], 0.7);
      addChord(buf, SR, start + 15, 5, [349.23, 440.0, 523.25], 0.7);
    };
    addChorus(48);

    // Quiet verse 2
    addChord(buf, SR, 68, 28, [293.66, 349.23, 440.0], 0.25);

    // Chorus 2
    addChorus(96);

    // Soft outro
    addChord(buf, SR, 116, 12, [523.25, 659.25], 0.15);

    const picked = detectHighlightStart(buf, SR, { leadIn: 2 });
    // Should land near the start of Chorus 1 (~48s) or Chorus 2 (~96s), NOT the intro (2..16s)
    const nearChorus1 = Math.abs(picked - 48) <= 3.0;
    const nearChorus2 = Math.abs(picked - 96) <= 3.0;
    expect(nearChorus1 || nearChorus2).toBe(true);
  });

  test('falls back cleanly to peak vocal energy on short (~35s) TV-size tracks', () => {
    const buf = new Float32Array(SR * 35);
    addChord(buf, SR, 0, 15, [220, 330], 0.15);
    // Energetic chorus enters at 16s
    addChord(buf, SR, 16, 14, [523.25, 659.25, 783.99, 1046.5], 0.8);
    addChord(buf, SR, 30, 5, [220], 0.1);

    const picked = detectHighlightStart(buf, SR, { leadIn: 0 });
    expect(picked).toBeGreaterThanOrEqual(15);
    expect(picked).toBeLessThanOrEqual(26);
  });

  test('clamps output to leave at least minTailSec before track end', () => {
    const buf = new Float32Array(SR * 20);
    // Only loud right at the very end (17..20s)
    addChord(buf, SR, 17, 3, [523.25, 659.25, 783.99], 0.9);
    const picked = detectHighlightStart(buf, SR, { leadIn: 0, minTailSec: 4 });
    expect(picked).toBeLessThanOrEqual(16);
  });
});
