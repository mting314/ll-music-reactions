// Pure ffmpeg argument-building logic for the export server.
// Kept free of I/O so it can be unit-tested without running ffmpeg.

export interface ExportEntry {
  clipPath: string;
  albumArtUrl: string | null;
  songAudioUrl: string | null;
  songStartTime: number;
  songName: string;
  clipName: string;
  // Clip length in ms; summed across entries to estimate ffmpeg progress.
  // Optional so older payloads still work (progress just stays indeterminate).
  durationMs?: number;
}

export interface ExportRequest {
  entries: ExportEntry[];
  resolution: "720p" | "480p";
  overlayPosition: "top-right" | "bottom-right" | "top-left" | "bottom-left";
}

export type OverlayPosition = ExportRequest["overlayPosition"];

// Which input stream index maps to each piece of an entry. artIdx/audioIdx are
// null when that asset was unavailable (failed download, or none specified).
export interface InputMap {
  clipIdx: number;
  artIdx: number | null;
  audioIdx: number | null;
}

const MARGIN = 20;

// Uniform audio format applied to every stream so concat segments line up.
const AUDIO_FORMAT =
  "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";

// Square (1:1) canvas matching the near-square reaction clips (~944-1072 x 1152),
// with both dimensions divisible by 16 for H.264. Using a 16:9 padded canvas
// previously left wide black pillarboxes and placed the album art outside the
// video in the black bars.
export function resolutionScale(resolution: ExportRequest["resolution"]): string {
  return resolution === "720p" ? "720:720" : "480:480";
}

export function overlaySize(resolution: ExportRequest["resolution"]): number {
  return resolution === "720p" ? 180 : 120;
}

export function overlayCoords(
  position: OverlayPosition,
  size: number,
  margin: number = MARGIN,
): { x: string; y: string } {
  switch (position) {
    case "top-right":
      return { x: `W-${size}-${margin}`, y: String(margin) };
    case "bottom-right":
      return { x: `W-${size}-${margin}`, y: `H-${size}-${margin}` };
    case "top-left":
      return { x: String(margin), y: String(margin) };
    case "bottom-left":
      return { x: String(margin), y: `H-${size}-${margin}` };
  }
}

// Builds the -filter_complex string from the resolved input maps.
export function buildFilterComplex(
  req: ExportRequest,
  inputMap: InputMap[],
): string {
  const scale = resolutionScale(req.resolution);
  const size = overlaySize(req.resolution);
  const { x: overlayX, y: overlayY } = overlayCoords(req.overlayPosition, size);

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < req.entries.length; i++) {
    const map = inputMap[i]!;
    const entry = req.entries[i]!;

    // Scale to cover the target frame and center-crop so every clip fills the
    // canvas without black bars and the album-art corner stays rock-steady
    // across cuts. setsar=1 normalizes pixel aspect ratio for concat.
    filterParts.push(
      `[${map.clipIdx}:v]scale=${scale}:force_original_aspect_ratio=increase,crop=${scale},setsar=1[scaled${i}]`,
    );

    if (map.artIdx !== null) {
      filterParts.push(
        `[${map.artIdx}:v]scale=${size}:${size}[artscaled${i}]`,
      );
      filterParts.push(
        `[scaled${i}][artscaled${i}]overlay=${overlayX}:${overlayY}[v${i}]`,
      );
    } else {
      filterParts.push(`[scaled${i}]copy[v${i}]`);
    }

    // Normalize every audio stream to one format before concat. ffmpeg's
    // concat filter requires identical sample format / rate / channel layout
    // across segments; without this, stricter ffmpeg builds (8.x) fail with
    // "received no packets" when clips differ.
    if (map.audioIdx !== null) {
      const startT = entry.songStartTime;
      // Leave headroom past the clip's duration so amix=duration=shortest cuts
      // cleanly at the clip's exact length rather than truncating audio early
      // on clips longer than 3s.
      const trimSec = Math.max(
        5,
        Math.ceil((entry.durationMs ?? 3600) / 1000) + 1,
      );
      filterParts.push(`[${map.clipIdx}:a]${AUDIO_FORMAT}[clipa${i}]`);
      filterParts.push(
        `[${map.audioIdx}:a]atrim=${startT}:${startT + trimSec},asetpts=PTS-STARTPTS,${AUDIO_FORMAT}[songtrim${i}]`,
      );
      filterParts.push(
        `[clipa${i}][songtrim${i}]amix=inputs=2:duration=shortest,${AUDIO_FORMAT}[a${i}]`,
      );
    } else {
      filterParts.push(`[${map.clipIdx}:a]${AUDIO_FORMAT}[a${i}]`);
    }
    concatInputs.push(`[v${i}][a${i}]`);
  }

  filterParts.push(
    `${concatInputs.join("")}concat=n=${req.entries.length}:v=1:a=1[outv][outa]`,
  );

  return filterParts.join(";");
}

// Assembles the full ffmpeg argv given resolved input file args and filter.
export function buildFfmpegArgs(
  inputArgs: string[],
  filterStr: string,
  outputPath: string,
): string[] {
  return [
    "ffmpeg",
    "-y",
    // Machine-readable progress to stdout (fd 1); suppress the chatty stats
    // lines on stderr so it stays useful for error diagnostics.
    "-progress",
    "pipe:1",
    "-nostats",
    ...inputArgs,
    "-filter_complex",
    filterStr,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

// `ffmpeg -progress pipe:1` emits blocks of key=value lines, e.g.
//   out_time_us=1234567
//   progress=continue
// Returns the elapsed output time in milliseconds for a line, else null.
export function parseProgressMs(line: string): number | null {
  // out_time_us is microseconds and is the reliable field across versions.
  const us = line.match(/^out_time_us=(\d+)/);
  if (us) return Number(us[1]) / 1000;
  // out_time_ms is mislabelled (microseconds) in some builds; treat the same.
  const ms = line.match(/^out_time_ms=(\d+)/);
  if (ms) return Number(ms[1]) / 1000;
  return null;
}

// Clamp a fraction (current/total) to an integer 0..99 percent. We never
// report 100 from progress lines — completion is signalled by the process exit.
export function progressPercent(currentMs: number, totalMs: number): number | null {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  return Math.max(0, Math.min(99, Math.round((currentMs / totalMs) * 100)));
}
