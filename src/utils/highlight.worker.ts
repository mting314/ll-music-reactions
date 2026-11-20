/**
 * Web Worker that runs `detectHighlightStart` off the main thread so decoding
 * and analyzing a long timeline never drops frames.
 */
import { detectHighlightStart } from './highlight';

export interface HighlightWorkerRequest {
  id: number;
  samples: Float32Array;
  sampleRate: number;
  leadIn: number;
}

export interface HighlightWorkerResponse {
  id: number;
  suggestedStart: number;
}

const workerScope = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<HighlightWorkerRequest>) => void) | null;
  postMessage: (msg: HighlightWorkerResponse) => void;
};

workerScope.onmessage = (ev: MessageEvent<HighlightWorkerRequest>) => {
  const { id, samples, sampleRate, leadIn } = ev.data;
  const suggestedStart = detectHighlightStart(samples, sampleRate, { leadIn });
  workerScope.postMessage({ id, suggestedStart });
};
