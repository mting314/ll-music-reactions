import { expect, test, describe } from "bun:test";
import {
  toFirestoreValue,
  toFirestoreFields,
  fromFirestoreValue,
  fromFirestoreFields,
} from "./firestore";

describe("toFirestoreValue", () => {
  test("encodes primitives", () => {
    expect(toFirestoreValue(null)).toEqual({ nullValue: null });
    expect(toFirestoreValue(true)).toEqual({ booleanValue: true });
    expect(toFirestoreValue(42)).toEqual({ integerValue: "42" });
    expect(toFirestoreValue(3.5)).toEqual({ doubleValue: 3.5 });
    expect(toFirestoreValue("hi")).toEqual({ stringValue: "hi" });
  });

  test("encodes arrays and nested objects", () => {
    expect(toFirestoreValue([1, "a"])).toEqual({
      arrayValue: { values: [{ integerValue: "1" }, { stringValue: "a" }] },
    });
    expect(toFirestoreValue({ x: 1 })).toEqual({
      mapValue: { fields: { x: { integerValue: "1" } } },
    });
  });

  test("toFirestoreFields drops undefined", () => {
    expect(toFirestoreFields({ a: 1, b: undefined })).toEqual({
      a: { integerValue: "1" },
    });
  });
});

describe("round-trip", () => {
  const cases: unknown[] = [
    { id: "song-1", name: "僕らのLIVE", seriesIds: [1, 2], releasedOn: "2013-01-23" },
    {
      id: "disc-1",
      versions: [
        { id: "v1", name: null, imageUrl: "https://x/y.jpg" },
        { id: "v2", name: "Limited", imageUrl: "https://x/z.jpg" },
      ],
      artistVariants: [{ id: "a1" }, { id: "a2" }],
    },
    { id: "p1", date: "2024-07-01", seriesIds: ["1"], hasSetlist: true, score: 4.5 },
    { nested: { a: { b: { c: [1, 2, { d: "deep" }] } } } },
  ];

  for (const [i, obj] of cases.entries()) {
    test(`object ${i} survives encode -> decode`, () => {
      const encoded = toFirestoreFields(obj as object);
      const decoded = fromFirestoreFields(encoded);
      expect(decoded).toEqual(obj as Record<string, unknown>);
    });
  }

  test("array value round-trips", () => {
    const v = [1, "two", true, null, { k: "v" }];
    expect(fromFirestoreValue(toFirestoreValue(v))).toEqual(v);
  });
});
