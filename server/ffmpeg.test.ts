import { expect, test, describe } from "bun:test";
import {
  buildFfmpegArgs,
  buildFilterComplex,
  overlayCoords,
  overlaySize,
  resolutionScale,
  type ExportRequest,
  type InputMap,
} from "./ffmpeg";

describe("resolutionScale", () => {
  test("720p maps to 1280:720", () => {
    expect(resolutionScale("720p")).toBe("1280:720");
  });
  test("480p maps to 854:480", () => {
    expect(resolutionScale("480p")).toBe("854:480");
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
      y: "H-120-20",
    });
  });
  test("bottom-right pins to both far edges", () => {
    expect(overlayCoords("bottom-right", 180)).toEqual({
      x: "W-180-20",
      y: "H-180-20",
    });
  });
  test("top-left sits at the origin margin", () => {
    expect(overlayCoords("top-left", 120)).toEqual({ x: "20", y: "20" });
  });
});

function entry(overrides: Partial<ExportRequest["entries"][0]> = {}) {
  return {
    clipPath: "clip-01.mp4",
    albumArtUrl: "https://example.com/art.jpg",
    songAudioUrl: "https://example.com/song.ogg",
    songStartTime: 30,
    songName: "Song",
    clipName: "Clip",
    ...overrides,
  };
}

describe("buildFilterComplex", () => {
  test("single entry with art + audio wires overlay, atrim, amix, and concat", () => {
    const req: ExportRequest = {
      entries: [entry()],
      resolution: "720p",
      overlayPosition: "top-right",
    };
    const inputMap: InputMap[] = [{ clipIdx: 0, artIdx: 1, audioIdx: 2 }];
    const filter = buildFilterComplex(req, inputMap);

    expect(filter).toContain(
      "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black[scaled0]",
    );
    expect(filter).toContain("[1:v]scale=180:180[artscaled0]");
    expect(filter).toContain(
      "[scaled0][artscaled0]overlay=W-180-20:20[v0]",
    );
    // songStartTime=30 -> trim 30:33 (3s window)
    expect(filter).toContain(
      "[2:a]atrim=30:33,asetpts=PTS-STARTPTS[songtrim0]",
    );
    expect(filter).toContain(
      "[0:a][songtrim0]amix=inputs=2:duration=shortest[a0]",
    );
    expect(filter).toContain("[v0][a0]concat=n=1:v=1:a=1[outv][outa]");
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
    expect(filter).toContain("scale=854:480");
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
    expect(filter).toContain("[v0][0:a]concat=n=1:v=1:a=1[outv][outa]");
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

    expect(filter).toContain("[3:v]scale=1280:720");
    expect(filter).toContain("[4:v]scale=180:180[artscaled1]");
    expect(filter).toContain("[5:a]atrim=10:13");
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
    expect(args).toContain("-filter_complex");
    expect(args).toContain("[0:v]copy[outv]");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    // -map [outv] and -map [outa] both present
    const mapCount = args.filter((a) => a === "-map").length;
    expect(mapCount).toBe(2);
  });
});
