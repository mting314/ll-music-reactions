-- Schema for the LL Music Reactions data store (Cloud SQL / Postgres).
--
-- Each entity is stored document-style: a stable text id plus the canonical
-- JSON object the frontend already consumes (in a JSONB column). This keeps the
-- pipeline ingestion and the read API trivial while still giving us a real
-- relational DB with indexable JSONB. A `builds` table records each refresh.

CREATE TABLE IF NOT EXISTS songs (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artists (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discographies (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- series-info rows ({ id, name, color }).
CREATE TABLE IF NOT EXISTS series (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- series.json: maps a Japanese series name to its English name.
CREATE TABLE IF NOT EXISTS series_names (
  name          TEXT PRIMARY KEY,
  english_name  TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performances (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- performance-setlists.json: keyed by performance id.
CREATE TABLE IF NOT EXISTS setlists (
  performance_id TEXT PRIMARY KEY,
  data           JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- characters: stored for completeness (not yet consumed by the app).
CREATE TABLE IF NOT EXISTS characters (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per refresh run, newest = current.
CREATE TABLE IF NOT EXISTS builds (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running', -- running | success | failed
  source_ref  TEXT,                            -- scraper repo commit used
  counts      JSONB,                           -- { songs: n, artists: n, ... }
  error       TEXT
);

CREATE INDEX IF NOT EXISTS builds_finished_idx ON builds (finished_at DESC);
