import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildFfmpegArgs,
  buildFilterComplex,
  parseProgressMs,
  progressPercent,
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

// Progress events streamed to the client over SSE.
type ExportEvent =
  | { type: "start"; entries: number; resolution: string }
  | { type: "asset"; index: number; total: number; song: string; artOk: boolean; audioOk: boolean }
  | { type: "ffmpeg_start"; totalMs: number }
  | { type: "ffmpeg_progress"; pct: number | null; outMs: number }
  | { type: "done"; bytes: number; dataB64: string }
  | { type: "error"; message: string };

type Emit = (event: ExportEvent) => void;

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

async function runExport(
  req: ExportRequest,
  requestId: string,
  emit: Emit,
): Promise<string> {
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
    emit({
      type: "asset",
      index: i,
      total: req.entries.length,
      song: entry.songName,
      artOk: artIdx !== null,
      audioOk: audioIdx !== null,
    });

    inputMap.push({ clipIdx, artIdx, audioIdx });
  }

  const filterStr = buildFilterComplex(req, inputMap);
  const ffmpegArgs = buildFfmpegArgs(inputArgs, filterStr, outputPath);

  // Total output duration ≈ sum of clip lengths; used to turn ffmpeg's elapsed
  // out_time into a percentage. 0 when clients don't send durations.
  const totalMs = req.entries.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

  log("INFO", "export.ffmpeg.start", { requestId, totalMs, args: ffmpegArgs.join(" ") });
  emit({ type: "ffmpeg_start", totalMs });
  const startedAt = Date.now();

  const proc = Bun.spawn(ffmpegArgs, { stdout: "pipe", stderr: "pipe" });

  // Read ffmpeg's -progress output from stdout and emit throttled progress.
  const pump = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let lastEmit = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const outMs = parseProgressMs(line);
        if (outMs === null) continue;
        const now = Date.now();
        if (now - lastEmit >= 400) {
          lastEmit = now;
          emit({ type: "ffmpeg_progress", pct: progressPercent(outMs, totalMs), outMs });
        }
      }
    }
  })();

  // Drain stderr for diagnostics; await both before checking exit.
  const stderr = await new Response(proc.stderr).text();
  await pump;
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

// Stream SSE `data:` frames while `run` does the work. Errors mid-stream are
// delivered as an `error` event (the HTTP status is already 200 by then).
function sseResponse(requestId: string, run: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await run(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("ERROR", "export.failed", { requestId, error: message });
        emit({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Request-Id": requestId,
      ...CORS_HEADERS,
    },
  });
}

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

      // Parse before streaming so a bad payload is a normal JSON 400.
      let body: ExportRequest;
      try {
        body = (await req.json()) as ExportRequest;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const startedAt = Date.now();
      log("INFO", "export.start", {
        requestId,
        entries: body.entries.length,
        resolution: body.resolution,
        overlayPosition: body.overlayPosition,
      });

      return sseResponse(requestId, async (emit) => {
        emit({
          type: "start",
          entries: body.entries.length,
          resolution: body.resolution,
        });

        const outputPath = await runExport(body, requestId, emit);
        const data = await Bun.file(outputPath).arrayBuffer();

        // Clean up the temp dir once read.
        rm(join(outputPath, ".."), { recursive: true }).catch(() => {});

        log("INFO", "export.done", {
          requestId,
          totalMs: Date.now() - startedAt,
          bytes: data.byteLength,
        });

        // Deliver the finished MP4 as the final event (base64 inflates ~33%,
        // fine for the <25MB Discord target).
        emit({
          type: "done",
          bytes: data.byteLength,
          dataB64: Buffer.from(data).toString("base64"),
        });
      });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
});

log("INFO", "server.start", { port: server.port });
