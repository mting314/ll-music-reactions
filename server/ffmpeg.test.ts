import { expect, test, describe } from "bun:test";
import {
  buildFfmpegArgs,
  buildFilterComplex,
  formatSongLabel,
  overlayCoords,
  overlaySize,
  parseProgressMs,
  progressPercent,
  resolutionScale,
  type ExportRequest,
  type InputMap,
} from "./ffmpeg";

describe("resolutionScale", () => {
  test("720p maps to 720:720 (1:1 square)", () => {
    expect(resolutionScale("720p")).toBe("720:720");
  });
  test("480p maps to 480:480 (1:1 square)", () => {
    expect(resolutionScale("480p")).toBe("480:480");
  });
});

describe("overlaySize", () => {
  test("720p is 180, 480p is 120", () => {
    expect(overlaySize("720p")).toBe(180);
    expect(overlaySize("480p")).toBe(120);
  });
});

describe("overlayCoords", () => {
  test("top-right pins to the right edge at the top margin", () => {
    expect(overlayCoords("top-right", 180)).toEqual({
      x: "W-180-20",
      y: "20",
    });
  });
  test("bottom-left pins to the left edge at the bottom", () => {
    expect(overlayCoords("bottom-left", 120)).toEqual({
      x: "20",
      y: "H-140",
    });
  });
  test("bottom-right pins to both far edges (with optional label reserve)", () => {
    expect(overlayCoords("bottom-right", 180)).toEqual({
      x: "W-180-20",
      y: "H-200",
    });
    expect(overlayCoords("bottom-right", 180, 20, 46)).toEqual({
      x: "W-180-20",
      y: "H-246",
    });
  });
  test("top-left sits at the origin margin", () => {
    expect(overlayCoords("top-left", 120)).toEqual({ x: "20", y: "20" });
  });
});

describe("formatSongLabel", () => {
  test("keeps short and medium English/Japanese titles on one line without orphan wrap", () => {
    expect(formatSongLabel("Snow halation")).toBe("Snow halation");
    expect(formatSongLabel("ユメノトビラ")).toBe("ユメノトビラ");
    expect(formatSongLabel("届かない星だとしても")).toBe("届かない星だとしても");
  });

  test("wraps longer titles evenly around the midpoint (no hanging orphan character)", () => {
    expect(formatSongLabel("SUPER SUMMER SENSATION!!")).toBe(
      "SUPER SUMMER\nSENSATION!!",
    );
    const wrapped = formatSongLabel("君のこころは輝いてるかい？");
    const [l1, l2] = wrapped.split("\n");
    expect(l1).toBe("君のこころは");
    expect(l2).toBe("輝いてるかい？");
  });

  test("truncates very long titles on line 2 with an ellipsis", () => {
    const out = formatSongLabel("Colorful Dreams! Colorful Smiles! (Special Remix)");
    const lines = out.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  test("returns empty string for blank input", () => {
    expect(formatSongLabel("   ")).toBe("");
  });
});

function entry(overrides: Partial<ExportRequest["entries"][0]> = {}) {
  return {
    clipPath: "clip-02.mp4",
    albumArtUrl: "https://example.com/art.jpg",
    songAudioUrl: "https://example.com/song.ogg",
    songStartTime: 30,
    songName: "Song",
    clipName: "Clip",
    ...overrides,
  };
}

describe("buildFilterComplex", () => {
  test("single entry with art + audio wires cover-crop, overlay, atrim, amix, and concat", () => {
    const req: ExportRequest = {
      entries: [entry()],
      resolution: "720p",
      overlayPosition: "top-right",
    };
    const inputMap: InputMap[] = [{ clipIdx: 0, artIdx: 1, audioIdx: 2 }];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).toContain(
      "[0:v]scale=720:720:force_original_aspect_ratio=increase,crop=720:720,setsar=1[scaled0]",
    );
    expect(filter).not.toContain("pad=");
    expect(filter).toContain("[1:v]scale=180:180[artscaled0]");
    expect(filter).toContain(
      "[scaled0][artscaled0]overlay=W-180-20:20[v0]",
    );
    // clip audio normalized to a uniform format before mixing
    expect(filter).toContain(
      "[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[clipa0]",
    );
    // songStartTime=30 -> trim 30:35 (5s headroom >= 3.6s clip), then normalized
    expect(filter).toContain(
      "[2:a]atrim=30:35,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[songtrim0]",
    );
    expect(filter).toContain(
      "[clipa0][songtrim0]amix=inputs=2:duration=shortest,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a0]",
    );
    expect(filter).toContain("[v0][a0]concat=n=1:v=1:a=1[outv][outa]");
  });

  test("draws song-name label right below album art when labelPath is provided", () => {
    const req: ExportRequest = {
      entries: [entry({ songName: "Snow halation" })],
      resolution: "720p",
      overlayPosition: "top-right",
    };
    const inputMap: InputMap[] = [
      { clipIdx: 0, artIdx: 1, audioIdx: 2, labelPath: "/tmp/label0.txt" },
    ];
    const filter = buildFilterComplex(req, inputMap, {
      fontFile: "/usr/share/fonts/NotoSansCJK-Bold.ttc",
    });

    expect(filter).toContain("[scaled0][artscaled0]overlay=W-180-20:20[artov0]");
    expect(filter).toContain(
      "[artov0]drawtext=fontfile=/usr/share/fonts/NotoSansCJK-Bold.ttc:textfile=/tmp/label0.txt:fontsize=16",
    );
    expect(filter).toContain(":y=206[v0]");
  });

  test("lifts bottom-corner album art when labelPath is provided so label fits below it", () => {
    const req: ExportRequest = {
      entries: [entry()],
      resolution: "720p",
      overlayPosition: "bottom-right",
    };
    const inputMap: InputMap[] = [
      { clipIdx: 0, artIdx: 1, audioIdx: null, labelPath: "/tmp/label0.txt" },
    ];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).toContain("[scaled0][artscaled0]overlay=W-180-20:H-246[artov0]");
    expect(filter).toContain(":y=H-60[v0]");
  });

  test("longer clip durationMs expands the atrim headroom past 5s", () => {
    const req: ExportRequest = {
      entries: [entry({ songStartTime: 20, durationMs: 6500 })],
      resolution: "720p",
      overlayPosition: "top-right",
    };
    const inputMap: InputMap[] = [{ clipIdx: 0, artIdx: 1, audioIdx: 2 }];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).toContain("[2:a]atrim=20:28,asetpts=PTS-STARTPTS");
  });

  test("entry without art uses copy passthrough instead of overlay", () => {
    const req: ExportRequest = {
      entries: [entry({ albumArtUrl: null })],
      resolution: "480p",
      overlayPosition: "top-left",
    };
    const inputMap: InputMap[] = [{ clipIdx: 0, artIdx: null, audioIdx: 1 }];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).toContain("[scaled0]copy[v0]");
    expect(filter).not.toContain("overlay=");
    expect(filter).toContain("scale=480:480");
  });

  test("entry without audio concats the clip's own audio stream", () => {
    const req: ExportRequest = {
      entries: [entry({ songAudioUrl: null })],
      resolution: "720p",
      overlayPosition: "top-right",
    };
    const inputMap: InputMap[] = [{ clipIdx: 0, artIdx: 1, audioIdx: null }];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).not.toContain("amix");
    expect(filter).not.toContain("atrim");
    // clip audio still normalized, then fed straight into concat
    expect(filter).toContain(
      "[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a0]",
    );
    expect(filter).toContain("[v0][a0]concat=n=1:v=1:a=1[outv][outa]");
  });

  test("multiple entries increment stream indices and concat with n=count", () => {
    const req: ExportRequest = {
      entries: [
        entry({ clipPath: "clip-01.mp4" }),
        entry({ clipPath: "clip-02.mp4", songStartTime: 10 }),
      ],
      resolution: "720p",
      overlayPosition: "bottom-right",
    };
    const inputMap: InputMap[] = [
      { clipIdx: 0, artIdx: 1, audioIdx: 2 },
      { clipIdx: 3, artIdx: 4, audioIdx: 5 },
    ];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).toContain("[3:v]scale=720:720");
    expect(filter).toContain("[4:v]scale=180:180[artscaled1]");
    expect(filter).toContain("[5:a]atrim=10:15");
    expect(filter).toContain(
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]",
    );
  });
});

describe("buildFfmpegArgs", () => {
  test("assembles full argv with codecs and output path", () => {
    const args = buildFfmpegArgs(
      ["-i", "clip-01.mp4"],
      "[0:v]copy[outv]",
      "/tmp/out.mp4",
    );

    expect(args[0]).toBe("ffmpeg");
    expect(args).toContain("-y");
    // progress reporting to stdout
    expect(args).toContain("-progress");
    expect(args).toContain("pipe:1");
    expect(args).toContain("-nostats");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("[0:v]copy[outv]");
    expect(args).toContain("libx264");
    expect(args).toContain("-pix_fmt");
    expect(args).toContain("yuv420p");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    // -map [outv] and -map [outa] both present
    const mapCount = args.filter((a) => a === "-map").length;
    expect(mapCount).toBe(2);
  });
});

describe("parseProgressMs", () => {
  test("parses out_time_us (microseconds) into ms", () => {
    expect(parseProgressMs("out_time_us=1500000")).toBe(1500);
  });
  test("parses out_time_ms (also microseconds in ffmpeg) into ms", () => {
    expect(parseProgressMs("out_time_ms=2000000")).toBe(2000);
  });
  test("returns null for non-progress lines", () => {
    expect(parseProgressMs("progress=continue")).toBeNull();
    expect(parseProgressMs("frame=42")).toBeNull();
    expect(parseProgressMs("")).toBeNull();
  });
});

describe("progressPercent", () => {
  test("computes a rounded percent", () => {
    expect(progressPercent(1500, 6000)).toBe(25);
  });
  test("caps at 99 (completion comes from process exit, not progress)", () => {
    expect(progressPercent(6000, 6000)).toBe(99);
    expect(progressPercent(9999, 6000)).toBe(99);
  });
  test("returns null when total is unknown or zero", () => {
    expect(progressPercent(1000, 0)).toBeNull();
    expect(progressPercent(1000, NaN)).toBeNull();
  });
});
