import { test, expect, describe } from "bun:test";
import { toPublishFiles } from "./publish-data";
import type { Dataset } from "./build-dataset";

const dataset: Dataset = {
  songs: [{ id: "1" }],
  artists: [{ id: "a" }],
  discographies: [{ id: "d" }],
  seriesInfo: [{ id: "s" }],
  seriesNames: { S: "Series" },
  performances: [{ id: "p" }],
  setlists: { p: { foo: 1 } },
  generatedAt: "2026-06-10T00:00:00Z",
};

describe("toPublishFiles", () => {
  test("emits exactly the per-entity files the frontend fetches", () => {
    const files = toPublishFiles(dataset, { songs: 1 });
    expect(Object.keys(files).sort()).toEqual(
      [
        "artists.json",
        "build.json",
        "discographies.json",
        "performances.json",
        "seriesInfo.json",
        "seriesNames.json",
        "setlists.json",
        "songs.json",
      ].sort(),
    );
  });

  test("build.json carries generatedAt + counts; entity files carry their arrays/maps", () => {
    const files = toPublishFiles(dataset, { songs: 1, artists: 1 });
    expect(files["build.json"]).toEqual({
      generatedAt: "2026-06-10T00:00:00Z",
      counts: { songs: 1, artists: 1 },
    });
    expect(files["songs.json"]).toEqual([{ id: "1" }]);
    expect(files["seriesNames.json"]).toEqual({ S: "Series" });
    expect(files["setlists.json"]).toEqual({ p: { foo: 1 } });
  });
});
