import { test, expect, describe } from "bun:test";
import { toPublishPayload } from "./publish-hosting";
import type { Dataset } from "./build-dataset";

const dataset: Dataset = {
  songs: [{ id: "1" }],
  artists: [{ id: "a" }],
  discographies: [],
  seriesInfo: [],
  seriesNames: { S: "Series" },
  performances: [],
  setlists: { p: { foo: 1 } },
  generatedAt: "2026-06-09T00:00:00Z",
};

describe("toPublishPayload", () => {
  test("produces the frontend dataset shape with a build block", () => {
    const counts = { songs: 1, artists: 1 };
    const p = toPublishPayload(dataset, counts);

    expect(p.songs).toHaveLength(1);
    expect(p.seriesNames).toEqual({ S: "Series" });
    expect(p.setlists).toEqual({ p: { foo: 1 } });
    expect(p.build).toEqual({ generatedAt: "2026-06-09T00:00:00Z", counts });
  });

  test("folds generatedAt under build (no top-level generatedAt)", () => {
    const p = toPublishPayload(dataset, {});
    expect((p as Record<string, unknown>).generatedAt).toBeUndefined();
    expect(p.build.generatedAt).toBe("2026-06-09T00:00:00Z");
  });

  test("carries every entity field the frontend reads", () => {
    const p = toPublishPayload(dataset, {});
    for (const key of [
      "songs",
      "artists",
      "discographies",
      "seriesInfo",
      "seriesNames",
      "performances",
      "setlists",
      "build",
    ]) {
      expect(p).toHaveProperty(key);
    }
  });
});
