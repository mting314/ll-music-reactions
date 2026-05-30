import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

export async function getFFmpeg(
  onProgress?: (progress: number) => void,
): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (loadPromise) {
    await loadPromise;
    return ffmpegInstance!;
  }

  const ffmpeg = new FFmpeg();

  if (onProgress) {
    ffmpeg.on('progress', ({ progress }) => {
      onProgress(Math.min(progress, 1));
    });
  }

  loadPromise = (async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        'application/wasm',
      ),
    });
    ffmpegInstance = ffmpeg;
  })();

  await loadPromise;
  return ffmpeg;
}

interface ExportEntry {
  clipUrl: string;
  albumArtUrl: string | null;
}

export async function exportVideo(
  entries: ExportEntry[],
  overlayPosition: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left',
  resolution: '720p' | '480p',
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const ffmpeg = await getFFmpeg(onProgress);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const clipData = await fetchFile(entry.clipUrl);
    await ffmpeg.writeFile(`clip${i}.mp4`, clipData);

    if (entry.albumArtUrl) {
      const artData = await fetchFile(entry.albumArtUrl);
      await ffmpeg.writeFile(`art${i}.jpg`, artData);
    }
  }

  const scale = resolution === '720p' ? '1280:720' : '854:480';
  const overlaySize = resolution === '720p' ? 120 : 80;
  const margin = 20;

  let overlayX: string;
  let overlayY: string;
  switch (overlayPosition) {
    case 'top-right':
      overlayX = `W-${overlaySize}-${margin}`;
      overlayY = String(margin);
      break;
    case 'bottom-right':
      overlayX = `W-${overlaySize}-${margin}`;
      overlayY = `H-${overlaySize}-${margin}`;
      break;
    case 'top-left':
      overlayX = String(margin);
      overlayY = String(margin);
      break;
    case 'bottom-left':
      overlayX = String(margin);
      overlayY = `H-${overlaySize}-${margin}`;
      break;
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const inputIdx = i * 2;
    const videoLabel = `[${inputIdx}:v]`;
    const audioLabel = `[${inputIdx}:a]`;

    filterParts.push(
      `${videoLabel}scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:-1:-1:color=black[scaled${i}]`,
    );

    if (entry.albumArtUrl) {
      const artInputIdx = inputIdx + 1;
      filterParts.push(
        `[${artInputIdx}:v]scale=${overlaySize}:${overlaySize}[artscaled${i}]`,
      );
      filterParts.push(
        `[scaled${i}][artscaled${i}]overlay=${overlayX}:${overlayY}[v${i}]`,
      );
    } else {
      filterParts.push(`[scaled${i}]copy[v${i}]`);
    }

    concatInputs.push(`[v${i}]${audioLabel}`);
  }

  filterParts.push(
    `${concatInputs.join('')}concat=n=${entries.length}:v=1:a=1[outv][outa]`,
  );

  const inputArgs: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    inputArgs.push('-i', `clip${i}.mp4`);
    if (entry.albumArtUrl) {
      inputArgs.push('-i', `art${i}.jpg`);
    } else {
      inputArgs.push('-f', 'lavfi', '-i', `color=c=black:s=${overlaySize}x${overlaySize}:d=0.1`);
    }
  }

  await ffmpeg.exec([
    ...inputArgs,
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    'output.mp4',
  ]);

  const data = await ffmpeg.readFile('output.mp4');
  const blob = new Blob([data], { type: 'video/mp4' });

  for (let i = 0; i < entries.length; i++) {
    await ffmpeg.deleteFile(`clip${i}.mp4`);
    try {
      await ffmpeg.deleteFile(`art${i}.jpg`);
    } catch {
      // might not exist
    }
  }
  await ffmpeg.deleteFile('output.mp4');

  return blob;
}
