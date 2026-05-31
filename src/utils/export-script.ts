import type { ExportSettings } from '@/types';

interface ExportEntry {
  clipPath: string;
  albumArtUrl: string | null;
  songAudioUrl: string | null;
  songStartTime: number;
  songName: string;
  clipName: string;
}

export function generateExportScript(
  entries: ExportEntry[],
  settings: ExportSettings,
): string {
  const scale = settings.resolution === '720p' ? '1280:720' : '854:480';
  const overlaySize = settings.resolution === '720p' ? 180 : 120;
  const margin = 20;

  let overlayX: string;
  let overlayY: string;
  switch (settings.overlayPosition) {
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

  const lines: string[] = [
    '#!/bin/bash',
    '# LL Music Reactions - Export Script',
    `# Generated: ${new Date().toISOString()}`,
    `# Entries: ${entries.length}`,
    '',
    'set -e',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'WORK_DIR=$(mktemp -d)',
    'OUTPUT="$SCRIPT_DIR/ll-music-reactions-$(date +%Y%m%d_%H%M%S).mp4"',
    '',
    'echo "Working directory: $WORK_DIR"',
    'echo ""',
    '',
    '# Download album art and song audio',
  ];

  const inputArgs: string[] = [];
  let inputIdx = 0;
  const inputMap: { clipIdx: number; artIdx: number | null; audioIdx: number | null }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    lines.push(`echo "[${i + 1}/${entries.length}] ${entry.songName} + ${entry.clipName}"`);

    inputArgs.push('-i', `"$SCRIPT_DIR/public/clips/${entry.clipPath}"`);
    const clipIdx = inputIdx++;

    let artIdx: number | null = null;
    if (entry.albumArtUrl) {
      const artFile = `$WORK_DIR/art${i}.jpg`;
      lines.push(`curl -sL -o "${artFile}" '${entry.albumArtUrl}'`);
      inputArgs.push('-i', `"${artFile}"`);
      artIdx = inputIdx++;
    }

    let audioIdx: number | null = null;
    if (entry.songAudioUrl) {
      const audioFile = `$WORK_DIR/song${i}.ogg`;
      lines.push(`curl -sL -o "${audioFile}" '${entry.songAudioUrl}'`);
      inputArgs.push('-i', `"${audioFile}"`);
      audioIdx = inputIdx++;
    }

    inputMap.push({ clipIdx, artIdx, audioIdx });
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const map = inputMap[i]!;
    const entry = entries[i]!;

    filterParts.push(
      `[${map.clipIdx}:v]scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:-1:-1:color=black[scaled${i}]`,
    );

    if (map.artIdx !== null) {
      filterParts.push(
        `[${map.artIdx}:v]scale=${overlaySize}:${overlaySize}[artscaled${i}]`,
      );
      filterParts.push(
        `[scaled${i}][artscaled${i}]overlay=${overlayX}:${overlayY}[v${i}]`,
      );
    } else {
      filterParts.push(`[scaled${i}]copy[v${i}]`);
    }

    if (map.audioIdx !== null) {
      const startT = entry.songStartTime;
      filterParts.push(
        `[${map.audioIdx}:a]atrim=${startT}:${startT + 3},asetpts=PTS-STARTPTS[songtrim${i}]`,
      );
      filterParts.push(
        `[${map.clipIdx}:a][songtrim${i}]amix=inputs=2:duration=shortest[a${i}]`,
      );
      concatInputs.push(`[v${i}][a${i}]`);
    } else {
      concatInputs.push(`[v${i}][${map.clipIdx}:a]`);
    }
  }

  filterParts.push(
    `${concatInputs.join('')}concat=n=${entries.length}:v=1:a=1[outv][outa]`,
  );

  const filterStr = filterParts.join(';\\n');

  lines.push('');
  lines.push('echo ""');
  lines.push('echo "Running ffmpeg..."');
  lines.push('echo ""');
  lines.push('');
  lines.push(`ffmpeg -y \\`);
  for (const arg of inputArgs) {
    lines.push(`  ${arg} \\`);
  }
  lines.push(`  -filter_complex "${filterStr}" \\`);
  lines.push('  -map "[outv]" \\');
  lines.push('  -map "[outa]" \\');
  lines.push('  -c:v libx264 -preset fast -crf 23 \\');
  lines.push('  -c:a aac -b:a 128k \\');
  lines.push('  -movflags +faststart \\');
  lines.push('  "$OUTPUT"');
  lines.push('');
  lines.push('rm -rf "$WORK_DIR"');
  lines.push('echo ""');
  lines.push('echo "Done! Output: $OUTPUT"');
  lines.push('open "$OUTPUT" 2>/dev/null || true');

  return lines.join('\n');
}
