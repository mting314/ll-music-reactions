import { test, expect, describe } from 'bun:test';
import type { Server } from 'bun';
import { fetchDataset } from './fetchDataset';

const VALID = {
  songs: [{ id: '1' }, { id: '2' }],
  artists: [],
  discographies: [],
  seriesInfo: [],
  seriesNames: {},
  performances: [],
  setlists: {},
  build: { generatedAt: '2026-06-09T00:00:00Z' },
};

function serve(handler: (req: Request) => Response | Promise<Response>): Server {
  return Bun.serve({ port: 0, fetch: handler });
}

describe('fetchDataset — happy path', () => {
  test('returns a coerced Dataset on a valid 200', async () => {
    const s = serve(() => Response.json(VALID));
    try {
      const d = await fetchDataset(`http://localhost:${s.port}`);
      expect(d.songs).toHaveLength(2);
      expect(d.build?.generatedAt).toBe('2026-06-09T00:00:00Z');
    } finally {
      s.stop(true);
    }
  });

  test('fetches the exact URL it is given (API endpoint or static file)', async () => {
    let path = '';
    const s = serve((req) => {
      path = new URL(req.url).pathname;
      return Response.json(VALID);
    });
    try {
      await fetchDataset(`http://localhost:${s.port}/dataset.json`);
      expect(path).toBe('/dataset.json');
    } finally {
      s.stop(true);
    }
  });
});

describe('fetchDataset — API failure paths', () => {
  test('throws on HTTP 500', async () => {
    const s = serve(() => new Response('x', { status: 500 }));
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /returned 500/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws on HTTP 404', async () => {
    const s = serve(() => new Response('x', { status: 404 }));
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /returned 404/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws on a 200 with an empty songs array', async () => {
    const s = serve(() => Response.json({ ...VALID, songs: [] }));
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /empty or invalid/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws on a 200 with no songs field (garbage body)', async () => {
    const s = serve(() => Response.json({ error: 'boom' }));
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /empty or invalid/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws when songs is the wrong type', async () => {
    const s = serve(() => Response.json({ songs: 'nope' }));
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow(
        /empty or invalid/,
      );
    } finally {
      s.stop(true);
    }
  });

  test('throws on a malformed (non-JSON) body', async () => {
    const s = serve(
      () =>
        new Response('<html>not json</html>', {
          headers: { 'content-type': 'text/html' },
        }),
    );
    try {
      await expect(fetchDataset(`http://localhost:${s.port}`)).rejects.toThrow();
    } finally {
      s.stop(true);
    }
  });

  test('throws on a network failure (connection refused)', async () => {
    const s = serve(() => Response.json(VALID));
    const port = s.port;
    s.stop(true); // close the server so the port refuses connections
    await expect(fetchDataset(`http://localhost:${port}`)).rejects.toThrow();
  });

  test('throws a timeout error when the API hangs past timeoutMs', async () => {
    const s = serve(async () => {
      await Bun.sleep(1000);
      return Response.json(VALID);
    });
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
    const s = serve(async () => {
      await Bun.sleep(1000);
      return Response.json(VALID);
    });
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
    const s = serve(() => Response.json(VALID));
    try {
      await expect(
        fetchDataset(`http://localhost:${s.port}`, {
          signal: AbortSignal.abort(),
        }),
      ).rejects.toThrow();
    } finally {
      s.stop(true);
    }
  });
});
