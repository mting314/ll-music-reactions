import { test, expect, describe } from 'bun:test';
import type { Server } from 'bun';
import { fetchDataset } from './fetchDataset';

const VALID: Record<string, unknown> = {
  songs: [{ id: '1' }, { id: '2' }],
  artists: [],
  discographies: [],
  seriesInfo: [],
  seriesNames: {},
  performances: [],
  setlists: {},
  build: { generatedAt: '2026-06-09T00:00:00Z' },
};

interface StubOpts {
  data?: Record<string, unknown>;
  status?: Record<string, number>; // field -> HTTP status override
  body?: Record<string, string>; // field -> raw (e.g. malformed) body
  delayMs?: number; // delay every response
}

// Serves each Dataset field at /<field>.json, mirroring the data CDN layout.
function serveDataset(opts: StubOpts = {}): Server {
  const data = opts.data ?? VALID;
  return Bun.serve({
    port: 0,
    async fetch(req) {
      if (opts.delayMs) await Bun.sleep(opts.delayMs);
      const field = new URL(req.url).pathname.replace(/^\//, '').replace(/\.json$/, '');
      if (opts.status?.[field]) return new Response('x', { status: opts.status[field] });
      if (opts.body && field in opts.body) {
        return new Response(opts.body[field], {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (field in data) return Response.json(data[field]);
      return new Response('not found', { status: 404 });
    },
  });
}

describe('fetchDataset — happy path', () => {
  test('fetches per-entity files and assembles a Dataset', async () => {
    const s = serveDataset();
    try {
      const d = await fetchDataset(`http://localhost:${s.port}`);
      expect(d.songs).toHaveLength(2);
      expect(d.build?.generatedAt).toBe('2026-06-09T00:00:00Z');
    } finally {
      s.stop(true);
    }
  });

  test('tolerates a trailing slash on the base URL', async () => {
    const s = serveDataset();
    try {
      const d = await fetchDataset(`http://localhost:${s.port}/`);
      expect(d.songs).toHaveLength(2);
    } finally {
      s.stop(true);
    }
  });
});

describe('fetchDataset — failure paths', () => {
  test('throws if any entity file 404s', async () => {
    const s = serveDataset({ status: { artists: 404 } });
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /artists\.json returned 404/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws on a 500 for any entity file', async () => {
    const s = serveDataset({ status: { setlists: 500 } });
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /setlists\.json returned 500/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws when songs is empty', async () => {
    const s = serveDataset({ data: { ...VALID, songs: [] } });
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /empty or invalid songs/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws when songs is the wrong type', async () => {
    const s = serveDataset({ data: { ...VALID, songs: { not: 'an array' } } });
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /empty or invalid songs/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws on a malformed (non-JSON) file body', async () => {
    const s = serveDataset({ body: { songs: '<html>not json</html>' } });
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow();
    } finally {
      s.stop(true);
    }
  });

  test('throws on a network failure (connection refused)', async () => {
    const s = serveDataset();
    const port = s.port;
    s.stop(true);
    await expect(fetchDataset(`http://localhost:${port}`)).rejects.toThrow();
  });

  test('throws a timeout error when the CDN hangs past timeoutMs', async () => {
    const s = serveDataset({ delayMs: 1000 });
    try {
      await expect(
        fetchDataset(`http://localhost:${s.port}`, { timeoutMs: 50 }),
      ).rejects.toThrow(/timed out/);
    } finally {
      s.stop(true);
    }
  });
});

describe('fetchDataset — cancellation', () => {
  test('rejects when the caller aborts mid-flight', async () => {
    const s = serveDataset({ delayMs: 1000 });
    const controller = new AbortController();
    const p = fetchDataset(`http://localhost:${s.port}`, {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    controller.abort();
    try {
      await expect(p).rejects.toThrow();
    } finally {
      s.stop(true);
    }
  });

  test('rejects immediately if the signal is already aborted', async () => {
    const s = serveDataset();
    try {
      await expect(
        fetchDataset(`http://localhost:${s.port}`, { signal: AbortSignal.abort() }),
      ).rejects.toThrow();
    } finally {
      s.stop(true);
    }
  });
});
