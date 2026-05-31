import { $ } from "bun";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const PORT = 3001;
const PROJECT_ROOT = join(import.meta.dir, "..");

interface ExportEntry {
  clipPath: string;
  albumArtUrl: string | null;
  songAudioUrl: string | null;
  songStartTime: number;
  songName: string;
  clipName: string;
}

interface ExportRequest {
  entries: ExportEntry[];
  resolution: "720p" | "480p";
  overlayPosition: "top-right" | "bottom-right" | "top-left" | "bottom-left";
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    await Bun.write(dest, resp);
    return true;
  } catch {
    return false;
  }
}

async function runExport(req: ExportRequest): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "ll-export-"));
  const outputPath = join(workDir, "output.mp4");

  const scale = req.resolution === "720p" ? "1280:720" : "854:480";
  const overlaySize = req.resolution === "720p" ? 180 : 120;
  const margin = 20;

  let overlayX: string, overlayY: string;
  switch (req.overlayPosition) {
    case "top-right":
      overlayX = `W-${overlaySize}-${margin}`;
      overlayY = String(margin);
      break;
    case "bottom-right":
      overlayX = `W-${overlaySize}-${margin}`;
      overlayY = `H-${overlaySize}-${margin}`;
      break;
    case "top-left":
      overlayX = String(margin);
      overlayY = String(margin);
      break;
    case "bottom-left":
      overlayX = String(margin);
      overlayY = `H-${overlaySize}-${margin}`;
      break;
  }

  const inputArgs: string[] = [];
  let inputIdx = 0;
  const inputMap: {
    clipIdx: number;
    artIdx: number | null;
    audioIdx: number | null;
  }[] = [];

  for (let i = 0; i < req.entries.length; i++) {
    const entry = req.entries[i]!;
    console.log(
      `[${i + 1}/${req.entries.length}] ${entry.songName} + ${entry.clipName}`
    );

    const clipFile = join(PROJECT_ROOT, "public", "clips", entry.clipPath);
    inputArgs.push("-i", clipFile);
    const clipIdx = inputIdx++;

    let artIdx: number | null = null;
    if (entry.albumArtUrl) {
      const artFile = join(workDir, `art${i}.jpg`);
      if (await downloadFile(entry.albumArtUrl, artFile)) {
        inputArgs.push("-i", artFile);
        artIdx = inputIdx++;
      }
    }

    let audioIdx: number | null = null;
    if (entry.songAudioUrl) {
      const audioFile = join(workDir, `song${i}.ogg`);
      if (await downloadFile(entry.songAudioUrl, audioFile)) {
        inputArgs.push("-i", audioFile);
        audioIdx = inputIdx++;
      }
    }

    inputMap.push({ clipIdx, artIdx, audioIdx });
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < req.entries.length; i++) {
    const map = inputMap[i]!;
    const entry = req.entries[i]!;

    filterParts.push(
      `[${map.clipIdx}:v]scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:-1:-1:color=black[scaled${i}]`
    );

    if (map.artIdx !== null) {
      filterParts.push(
        `[${map.artIdx}:v]scale=${overlaySize}:${overlaySize}[artscaled${i}]`
      );
      filterParts.push(
        `[scaled${i}][artscaled${i}]overlay=${overlayX}:${overlayY}[v${i}]`
      );
    } else {
      filterParts.push(`[scaled${i}]copy[v${i}]`);
    }

    if (map.audioIdx !== null) {
      const startT = entry.songStartTime;
      filterParts.push(
        `[${map.audioIdx}:a]atrim=${startT}:${startT + 3},asetpts=PTS-STARTPTS[songtrim${i}]`
      );
      filterParts.push(
        `[${map.clipIdx}:a][songtrim${i}]amix=inputs=2:duration=shortest[a${i}]`
      );
      concatInputs.push(`[v${i}][a${i}]`);
    } else {
      concatInputs.push(`[v${i}][${map.clipIdx}:a]`);
    }
  }

  filterParts.push(
    `${concatInputs.join("")}concat=n=${req.entries.length}:v=1:a=1[outv][outa]`
  );

  const filterStr = filterParts.join(";");

  console.log("Running ffmpeg...");
  const ffmpegArgs = [
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

  const proc = Bun.spawn(ffmpegArgs, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    await rm(workDir, { recursive: true }).catch(() => {});
    throw new Error(`ffmpeg failed (exit ${exitCode}): ${stderr.slice(-500)}`);
  }

  console.log("Done!");
  return outputPath;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (req.method === "POST" && new URL(req.url).pathname === "/export") {
      try {
        const body = (await req.json()) as ExportRequest;
        console.log(`\nExport request: ${body.entries.length} entries`);

        const outputPath = await runExport(body);
        const file = Bun.file(outputPath);
        const data = await file.arrayBuffer();

        // Clean up after reading
        const workDir = join(outputPath, "..");
        rm(workDir, { recursive: true }).catch(() => {});

        return new Response(data, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Disposition":
              'attachment; filename="ll-music-reactions.mp4"',
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        console.error("Export failed:", err);
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Export failed",
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Export server running at http://localhost:${server.port}`);
