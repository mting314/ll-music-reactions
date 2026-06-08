import { expect, test, describe } from "bun:test";
import { chunkUtf8 } from "./load-firestore";

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("chunkUtf8", () => {
  test("rejoins to the original string", () => {
    const s = "a".repeat(1000) + "日本語テスト" + "z".repeat(1000);
    expect(chunkUtf8(s, 64).join("")).toBe(s);
  });

  test("every chunk is within the byte limit", () => {
    const s = ("僕らのLIVE 君とのLIFE — Bokura ").repeat(500);
    const max = 300;
    for (const c of chunkUtf8(s, max)) expect(bytes(c)).toBeLessThanOrEqual(max);
  });

  test("never splits a multi-byte character", () => {
    // 日 is 3 UTF-8 bytes; with a tiny limit each chunk must stay valid.
    const s = "日".repeat(50);
    const chunks = chunkUtf8(s, 4); // 1 char (3 bytes) per chunk
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      expect([...c].every((ch) => ch === "日")).toBe(true);
    }
    expect(chunks.join("")).toBe(s);
  });

  test("handles a large JSON-like string in a few chunks", () => {
    const big = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: "曲" + i })) });
    const chunks = chunkUtf8(big, 50_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(big);
    for (const c of chunks) expect(bytes(c)).toBeLessThanOrEqual(50_000);
  });
});
