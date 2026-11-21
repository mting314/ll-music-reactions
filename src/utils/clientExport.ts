/**
 * 100% client-side MP4 video exporter using WebCodecs (VideoEncoder +
 * AudioEncoder), Canvas2D compositing, and mp4-muxer.
 *
 * Requires no server and no COOP/COEP headers (works natively on GitHub Pages).
 * Reuses the browser's cached `wikiAudioUrl` blobs from `audioAnalysis.ts`,
 * fetches album art with `referrerPolicy: 'no-referrer'`, and renders native
 * CJK song-name labels directly below the album art.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { analyzeAudio, decodeBlobUrl } from '@/utils/audioAnalysis';
import {
  computeCoverCrop,
  computeOverlayRects,
  exportDimensions,
  formatSongLabel,
  overlayMetrics,
  sliceStereoPcm,
  type ExportResolution,
  type OverlayPosition,
} from '@/utils/videoLayout';

export interface ClientExportEntry {
  clipUrl: string;
  durationMs: number;
  albumArtUrl: string | null;
  songAudioUrl: string | null;
  songStartTime: number;
  songName: string;
}

export interface ClientExportOptions {
  entries: ClientExportEntry[];
  resolution: ExportResolution;
  overlayPosition: OverlayPosition;
  onAssetProgress?: (index: number, total: number) => void;
  onEncodeProgress?: (pct: number) => void;
  onFinalizing?: () => void;
}

const FPS = 30;
const FRAME_DURATION_US = 1_000_000 / FPS;
const AUDIO_CHUNK_FRAMES = 1024;
const LABEL_FONT_FAMILY =
  '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", system-ui, sans-serif';

async function negotiateVideoConfig(
  size: number,
  bitrate: number,
): Promise<VideoEncoderConfig> {
  // Prefer H.264 High -> Main -> Baseline (all widely playable on Discord/Safari/QuickTime)
  const codecs = ['avc1.64001f', 'avc1.4d001f', 'avc1.42001f'];
  for (const codec of codecs) {
    const cfg: VideoEncoderConfig = {
      codec,
      width: size,
      height: size,
      bitrate,
      framerate: FPS,
      avc: { format: 'avc' },
    };
    const sup = await VideoEncoder.isConfigSupported(cfg);
    if (sup.supported) return sup.config ?? cfg;
  }
  throw new Error(
    'This browser does not support H.264 WebCodecs video encoding.',
  );
}

async function negotiateAudioConfig(): Promise<{
  config: AudioEncoderConfig;
  muxerCodec: 'aac' | 'opus';
  sampleRate: number;
}> {
  const candidates: Array<{
    config: AudioEncoderConfig;
    muxerCodec: 'aac' | 'opus';
    sampleRate: number;
  }> = [
    {
      config: {
        codec: 'mp4a.40.2',
        numberOfChannels: 2,
        sampleRate: 44100,
        bitrate: 128_000,
      },
      muxerCodec: 'aac',
      sampleRate: 44100,
    },
    {
      config: {
        codec: 'opus',
        numberOfChannels: 2,
        sampleRate: 48000,
        bitrate: 128_000,
      },
      muxerCodec: 'opus',
      sampleRate: 48000,
    },
  ];
  for (const c of candidates) {
    const sup = await AudioEncoder.isConfigSupported(c.config);
    if (sup.supported) {
      return {
        config: sup.config ?? c.config,
        muxerCodec: c.muxerCodec,
        sampleRate: c.sampleRate,
      };
    }
  }
  throw new Error(
    'This browser does not support AAC or Opus WebCodecs audio encoding.',
  );
}

async function fetchAlbumBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const resp = await fetch(url, {
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.onloadeddata = () => resolve(video);
    video.onerror = () =>
      reject(new Error(`Failed to load reaction clip: ${url}`));
    video.src = url;
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const clamped = Math.max(
    0,
    Math.min(timeSec, Math.max(0, (video.duration || 0) - 0.005)),
  );
  if (Math.abs(video.currentTime - clamped) < 0.001 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video frame seek failed during export'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = clamped;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  art: ImageBitmap | null,
  labelLines: string[],
  position: OverlayPosition,
  resolution: ExportResolution,
): void {
  const m = overlayMetrics(resolution);
  const rects = computeOverlayRects(position, resolution, labelLines.length);

  if (art) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    drawRoundedRectPath(
      ctx,
      rects.artX,
      rects.artY,
      rects.artSize,
      rects.artSize,
      m.artRadius,
    );
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRectPath(
      ctx,
      rects.artX,
      rects.artY,
      rects.artSize,
      rects.artSize,
      m.artRadius,
    );
    ctx.clip();
    const artCrop = computeCoverCrop(art.width, art.height);
    ctx.drawImage(
      art,
      artCrop.sx,
      artCrop.sy,
      artCrop.sw,
      artCrop.sh,
      rects.artX,
      rects.artY,
      rects.artSize,
      rects.artSize,
    );
    ctx.restore();

    ctx.save();
    drawRoundedRectPath(
      ctx,
      rects.artX,
      rects.artY,
      rects.artSize,
      rects.artSize,
      m.artRadius,
    );
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  if (labelLines.length > 0) {
    ctx.save();
    ctx.font = `700 ${m.fontSize}px ${LABEL_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let maxTextW = 0;
    for (const line of labelLines) {
      const w = ctx.measureText(line).width;
      if (w > maxTextW) maxTextW = w;
    }

    const boxW = Math.min(m.canvasSize - 16, maxTextW + m.boxPadX * 2);
    const boxH = labelLines.length * m.lineHeight + m.boxPadY * 2;
    const rawBoxX = rects.labelCenterX - boxW / 2;
    const boxX = Math.max(8, Math.min(rawBoxX, m.canvasSize - boxW - 8));
    const boxY = rects.labelTopY;

    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.fill();

    const textCenterX = boxX + boxW / 2;
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineJoin = 'round';
    for (let i = 0; i < labelLines.length; i++) {
      const y = boxY + m.boxPadY + m.lineHeight * (i + 0.5);
      ctx.strokeText(labelLines[i]!, textCenterX, y, boxW - m.boxPadX * 2);
      ctx.fillText(labelLines[i]!, textCenterX, y, boxW - m.boxPadX * 2);
    }
    ctx.restore();
  }
}

function waitTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 4));
}

/**
 * Stitch reaction clips, album-art overlays, song-name labels, and trimmed song
 * audio into a fast-start MP4 Blob completely inside the user's browser.
 */
export async function exportVideoClientSide({
  entries,
  resolution,
  overlayPosition,
  onAssetProgress,
  onEncodeProgress,
  onFinalizing,
}: ClientExportOptions): Promise<Blob> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof AudioEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined' ||
    typeof AudioData === 'undefined'
  ) {
    throw new Error(
      'Your browser does not support WebCodecs video export. Please use Chrome, Edge, Safari 16.4+, or Firefox 130+.',
    );
  }

  const size = exportDimensions(resolution);
  const videoBitrate = resolution === '720p' ? 2_500_000 : 1_200_000;

  const videoConfig = await negotiateVideoConfig(size, videoBitrate);
  const audioSpec = await negotiateAudioConfig();

  // 1. Pre-load & deduplicate album art bitmaps and decoded song AudioBuffers
  const artCache = new Map<string, ImageBitmap | null>();
  const audioCache = new Map<string, AudioBuffer | null>();
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.albumArtUrl && !artCache.has(entry.albumArtUrl)) {
        artCache.set(
          entry.albumArtUrl,
          await fetchAlbumBitmap(entry.albumArtUrl),
        );
      }
      if (entry.songAudioUrl && !audioCache.has(entry.songAudioUrl)) {
        const analysis = await analyzeAudio(entry.songAudioUrl);
        const buf = analysis.blobUrl
          ? await decodeBlobUrl(analysis.blobUrl)
          : null;
        audioCache.set(entry.songAudioUrl, buf);
      }
      onAssetProgress?.(i + 1, entries.length);
    }

    // 2. Set up MP4 muxer + WebCodecs encoders
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      fastStart: 'in-memory',
      video: {
        codec: 'avc',
        width: size,
        height: size,
        frameRate: FPS,
      },
      audio: {
        codec: audioSpec.muxerCodec,
        numberOfChannels: 2,
        sampleRate: audioSpec.sampleRate,
      },
    });

    let encoderError: Error | null = null;

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
    videoEncoder.configure(videoConfig);

    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
    audioEncoder.configure(audioSpec.config);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D canvas context');

    // Estimate total frames across all entries for determinate progress
    const entryFrames = entries.map((e) =>
      Math.max(1, Math.round(((e.durationMs || 3600) / 1000) * FPS)),
    );
    const totalFrames = entryFrames.reduce((a, b) => a + b, 0);

    let globalFrame = 0;
    let globalAudioSamples = 0;
    let lastPct = -1;

    // 3. Composite & encode each clip's video frames + synced audio slice
    for (let i = 0; i < entries.length; i++) {
      if (encoderError) throw encoderError;

      const entry = entries[i]!;
      const frameCount = entryFrames[i]!;
      const clipDurationSec = frameCount / FPS;
      const art = entry.albumArtUrl
        ? (artCache.get(entry.albumArtUrl) ?? null)
        : null;
      const labelLines = formatSongLabel(entry.songName);

      const video = await loadVideoElement(entry.clipUrl);
      const videoCrop = computeCoverCrop(video.videoWidth, video.videoHeight);

      try {
        for (let f = 0; f < frameCount; f++) {
          if (encoderError) throw encoderError;

          await seekVideo(video, f / FPS);

          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(
            video,
            videoCrop.sx,
            videoCrop.sy,
            videoCrop.sw,
            videoCrop.sh,
            0,
            0,
            size,
            size,
          );
          drawOverlay(ctx, art, labelLines, overlayPosition, resolution);

          while (videoEncoder.encodeQueueSize > 8) {
            await waitTick();
          }

          const frame = new VideoFrame(canvas, {
            timestamp: Math.round(globalFrame * FRAME_DURATION_US),
            duration: Math.round(FRAME_DURATION_US),
          });
          videoEncoder.encode(frame, {
            keyFrame: f === 0 || globalFrame % (FPS * 2) === 0,
          });
          frame.close();

          globalFrame++;
          const pct = Math.min(99, Math.round((globalFrame / totalFrames) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            onEncodeProgress?.(pct);
          }
        }
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }

      // Encode this entry's synced stereo PCM slice into AudioEncoder
      const audioBuf = entry.songAudioUrl
        ? (audioCache.get(entry.songAudioUrl) ?? null)
        : null;
      const channels: Float32Array[] = [];
      if (audioBuf) {
        for (let ch = 0; ch < Math.min(2, audioBuf.numberOfChannels); ch++) {
          channels.push(audioBuf.getChannelData(ch));
        }
      }
      const [left, right] = sliceStereoPcm(
        channels,
        audioBuf?.sampleRate ?? audioSpec.sampleRate,
        entry.songStartTime,
        clipDurationSec,
        audioSpec.sampleRate,
      );

      for (let offset = 0; offset < left.length; offset += AUDIO_CHUNK_FRAMES) {
        if (encoderError) throw encoderError;
        const count = Math.min(AUDIO_CHUNK_FRAMES, left.length - offset);
        const planar = new Float32Array(count * 2);
        planar.set(left.subarray(offset, offset + count), 0);
        planar.set(right.subarray(offset, offset + count), count);

        while (audioEncoder.encodeQueueSize > 16) {
          await waitTick();
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: audioSpec.sampleRate,
          numberOfFrames: count,
          numberOfChannels: 2,
          timestamp: Math.round(
            (globalAudioSamples / audioSpec.sampleRate) * 1_000_000,
          ),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
        globalAudioSamples += count;
      }
    }

    onFinalizing?.();
    await videoEncoder.flush();
    await audioEncoder.flush();
    if (encoderError) throw encoderError;

    muxer.finalize();

    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    for (const bmp of artCache.values()) {
      bmp?.close();
    }
  }
}
