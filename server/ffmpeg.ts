// Pure ffmpeg argument-building logic for the export server.
// Kept free of I/O so it can be unit-tested without running ffmpeg.

export interface ExportEntry {
  clipPath: string;
  albumArtUrl: string | null;
  songAudioUrl: string | null;
  songStartTime: number;
  songName: string;
  clipName: string;
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

export function resolutionScale(resolution: ExportRequest["resolution"]): string {
  return resolution === "720p" ? "1280:720" : "854:480";
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

    filterParts.push(
      `[${map.clipIdx}:v]scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:-1:-1:color=black[scaled${i}]`,
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
    ...inputArgs,
    "-filter_complex",
    filterStr,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
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
