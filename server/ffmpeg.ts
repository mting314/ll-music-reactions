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
// labelPath is an optional UTF-8 text file drawn right below the album art.
export interface InputMap {
  clipIdx: number;
  artIdx: number | null;
  audioIdx: number | null;
  labelPath?: string | null;
}

export interface FilterOptions {
  /** Path to a TTF/OTF/TTC font with CJK glyphs for song-name drawtext. */
  fontFile?: string | null;
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

function labelMetrics(resolution: ExportRequest["resolution"]) {
  return resolution === "720p"
    ? { fontSize: 16, gap: 6, boxBorder: 5, lineSpacing: 3, reserveBottom: 46 }
    : { fontSize: 11, gap: 4, boxBorder: 3, lineSpacing: 2, reserveBottom: 32 };
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
 * Wrap a song title onto at most 2 compact lines sized to sit neatly beneath
 * the square album art, breaking on whitespace when available and truncating
 * with an ellipsis if even 2 lines exceed the visual width budget.
 */
export function formatSongLabel(
  songName: string,
  maxLineWidth: number = 18,
): string {
  const clean = songName.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (visualWidth(clean) <= maxLineWidth) return clean;

  const chars = Array.from(clean);
  // Find the split index for line 1 within maxLineWidth, preferring a space.
  let w = 0;
  let splitIdx = 0;
  let lastSpace = -1;
  for (let i = 0; i < chars.length; i++) {
    const cw = charWidth(chars[i]!);
    if (w + cw > maxLineWidth) break;
    w += cw;
    splitIdx = i + 1;
    if (chars[i] === " ") lastSpace = i;
  }

  let line1: string;
  let rest: string;
  if (lastSpace > 0 && lastSpace >= Math.floor(splitIdx * 0.45)) {
    line1 = chars.slice(0, lastSpace).join("").trim();
    rest = chars.slice(lastSpace + 1).join("").trim();
  } else {
    line1 = chars.slice(0, Math.max(1, splitIdx)).join("").trim();
    rest = chars.slice(Math.max(1, splitIdx)).join("").trim();
  }

  if (!rest) return line1;
  if (visualWidth(rest) <= maxLineWidth) return `${line1}\n${rest}`;

  // Truncate line 2 with "…" so it never overflows the album-art column.
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
  const line2 = restChars.slice(0, cut).join("").trimEnd() + "…";
  return `${line1}\n${line2}`;
}

/** Escape a file path for FFmpeg filter option values (colons & backslashes). */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function overlayCoords(
  position: OverlayPosition,
  size: number,
  margin: number = MARGIN,
  bottomReserve: number = 0,
): { x: string; y: string } {
  const bottomOffset = size + margin + bottomReserve;
  switch (position) {
    case "top-right":
      return { x: `W-${size}-${margin}`, y: String(margin) };
    case "bottom-right":
      return { x: `W-${size}-${margin}`, y: `H-${bottomOffset}` };
    case "top-left":
      return { x: String(margin), y: String(margin) };
    case "bottom-left":
      return { x: String(margin), y: `H-${bottomOffset}` };
  }
}

// Builds the -filter_complex string from the resolved input maps.
export function buildFilterComplex(
  req: ExportRequest,
  inputMap: InputMap[],
  options: FilterOptions = {},
): string {
  const scale = resolutionScale(req.resolution);
  const size = overlaySize(req.resolution);
  const lm = labelMetrics(req.resolution);

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < req.entries.length; i++) {
    const map = inputMap[i]!;
    const entry = req.entries[i]!;
    const hasLabel = Boolean(map.labelPath);
    const isBottom =
      req.overlayPosition === "bottom-left" ||
      req.overlayPosition === "bottom-right";
    const bottomReserve = hasLabel && isBottom ? lm.reserveBottom : 0;
    const { x: overlayX, y: overlayY } = overlayCoords(
      req.overlayPosition,
      size,
      MARGIN,
      bottomReserve,
    );

    // Scale to cover the target frame and center-crop so every clip fills the
    // canvas without black bars and the album-art corner stays rock-steady
    // across cuts. setsar=1 normalizes pixel aspect ratio for concat.
    filterParts.push(
      `[${map.clipIdx}:v]scale=${scale}:force_original_aspect_ratio=increase,crop=${scale},setsar=1[scaled${i}]`,
    );

    let videoLabel = `scaled${i}`;
    if (map.artIdx !== null) {
      filterParts.push(
        `[${map.artIdx}:v]scale=${size}:${size}[artscaled${i}]`,
      );
      const nextLabel = hasLabel ? `artov${i}` : `v${i}`;
      filterParts.push(
        `[${videoLabel}][artscaled${i}]overlay=${overlayX}:${overlayY}[${nextLabel}]`,
      );
      videoLabel = nextLabel;
    }

    if (hasLabel && map.labelPath) {
      const half = Math.round(size / 2);
      const isRight =
        req.overlayPosition === "top-right" ||
        req.overlayPosition === "bottom-right";
      const centerX = isRight ? `W-${MARGIN + half}` : String(MARGIN + half);
      // Center under the album art while clamping inside the frame edges
      const textX = `min(max(${centerX}-tw/2\\,10)\\,W-tw-10)`;
      const textY = isBottom
        ? `H-${MARGIN + bottomReserve - lm.gap}`
        : String(MARGIN + size + lm.gap);
      const fontArg = options.fontFile
        ? `fontfile=${escapeFilterPath(options.fontFile)}:`
        : "";
      filterParts.push(
        `[${videoLabel}]drawtext=${fontArg}textfile=${escapeFilterPath(map.labelPath)}:fontsize=${lm.fontSize}:fontcolor=white:borderw=2:bordercolor=black@0.85:box=1:boxcolor=black@0.55:boxborderw=${lm.boxBorder}:line_spacing=${lm.lineSpacing}:x=${textX}:y=${textY}[v${i}]`,
      );
    } else if (map.artIdx === null) {
      filterParts.push(`[${videoLabel}]copy[v${i}]`);
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
