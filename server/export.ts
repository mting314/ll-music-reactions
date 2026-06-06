import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildFfmpegArgs,
  buildFilterComplex,
  type ExportRequest,
  type InputMap,
} from "./ffmpeg";

// Cloud Run injects PORT (defaults to 8080); fall back to 3001 for local dev.
const PORT = Number(process.env.PORT ?? 3001);

// Directory holding the bundled reaction clips. In the container the clips are
// copied to /app/clips; locally they live under the repo's public/clips.
const CLIPS_DIR = process.env.CLIPS_DIR ?? join(import.meta.dir, "..", "public", "clips");

type Severity = "INFO" | "WARNING" | "ERROR";

// Emit a single-line JSON record. Cloud Logging parses these into structured
// fields, so you can filter by `severity` or `jsonPayload.requestId` in the
// Logs Explorer. Locally it just prints readable JSON.
function log(severity: Severity, message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
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

async function runExport(req: ExportRequest, requestId: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "ll-export-"));
  const outputPath = join(workDir, "output.mp4");

  const inputArgs: string[] = [];
  let inputIdx = 0;
  const inputMap: InputMap[] = [];

  for (let i = 0; i < req.entries.length; i++) {
    const entry = req.entries[i]!;
    const clipFile = join(CLIPS_DIR, entry.clipPath);
    inputArgs.push("-i", clipFile);
    const clipIdx = inputIdx++;

    let artIdx: number | null = null;
    if (entry.albumArtUrl) {
      const artFile = join(workDir, `art${i}.jpg`);
      if (await downloadFile(entry.albumArtUrl, artFile)) {
        inputArgs.push("-i", artFile);
        artIdx = inputIdx++;
      } else {
        // Silent before: the entry just renders without art. Surface it.
        log("WARNING", "export.asset.download_failed", {
          requestId,
          index: i,
          asset: "albumArt",
          url: entry.albumArtUrl,
          song: entry.songName,
        });
      }
    }

    let audioIdx: number | null = null;
    if (entry.songAudioUrl) {
      const audioFile = join(workDir, `song${i}.ogg`);
      if (await downloadFile(entry.songAudioUrl, audioFile)) {
        inputArgs.push("-i", audioFile);
        audioIdx = inputIdx++;
      } else {
        log("WARNING", "export.asset.download_failed", {
          requestId,
          index: i,
          asset: "songAudio",
          url: entry.songAudioUrl,
          song: entry.songName,
        });
      }
    }

    log("INFO", "export.entry", {
      requestId,
      index: i,
      total: req.entries.length,
      song: entry.songName,
      clip: entry.clipName,
      artResolved: artIdx !== null,
      audioResolved: audioIdx !== null,
    });

    inputMap.push({ clipIdx, artIdx, audioIdx });
  }

  const filterStr = buildFilterComplex(req, inputMap);
  const ffmpegArgs = buildFfmpegArgs(inputArgs, filterStr, outputPath);

  log("INFO", "export.ffmpeg.start", { requestId, args: ffmpegArgs.join(" ") });
  const startedAt = Date.now();

  const proc = Bun.spawn(ffmpegArgs, { stdout: "pipe", stderr: "pipe" });
  // Always drain stderr (ffmpeg is chatty) so we have it for diagnostics and
  // never risk a full-pipe stall.
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const ffmpegMs = Date.now() - startedAt;

  if (exitCode !== 0) {
    await rm(workDir, { recursive: true }).catch(() => {});
    // Full stderr goes to the logs (queryable); the thrown message stays short.
    log("ERROR", "export.ffmpeg.failed", {
      requestId,
      exitCode,
      ffmpegMs,
      stderr,
      args: ffmpegArgs.join(" "),
    });
    throw new Error(
      `ffmpeg failed (exit ${exitCode}) [requestId=${requestId}]: ${stderr.slice(-500)}`,
    );
  }

  log("INFO", "export.ffmpeg.done", { requestId, exitCode, ffmpegMs });
  return outputPath;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
  port: PORT,
  // ffmpeg jobs can run long; lift Bun's default idle timeout to the max.
  idleTimeout: 255,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health check for Cloud Run / readiness probes.
    if (req.method === "GET" && pathname === "/health") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    if (req.method === "POST" && pathname === "/export") {
      const requestId = crypto.randomUUID();
      const startedAt = Date.now();
      try {
        const body = (await req.json()) as ExportRequest;
        log("INFO", "export.start", {
          requestId,
          entries: body.entries.length,
          resolution: body.resolution,
          overlayPosition: body.overlayPosition,
        });

        const outputPath = await runExport(body, requestId);
        const file = Bun.file(outputPath);
        const data = await file.arrayBuffer();

        // Clean up after reading
        const workDir = join(outputPath, "..");
        rm(workDir, { recursive: true }).catch(() => {});

        log("INFO", "export.done", {
          requestId,
          totalMs: Date.now() - startedAt,
          bytes: data.byteLength,
        });

        return new Response(data, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Disposition":
              'attachment; filename="ll-music-reactions.mp4"',
            "X-Request-Id": requestId,
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        log("ERROR", "export.failed", {
          requestId,
          totalMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
        return new Response(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Export failed",
            requestId,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": requestId,
              ...CORS_HEADERS,
            },
          },
        );
      }
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
});

log("INFO", "server.start", { port: server.port });
