-- LogDataTrack: initial schema

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id            BIGSERIAL PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  note          TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  duration_min  INTEGER NOT NULL CHECK (duration_min BETWEEN 0 AND 1440),
  intensity     SMALLINT NOT NULL DEFAULT 3 CHECK (intensity BETWEEN 1 AND 5),
  mood          SMALLINT CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
  tags          TEXT[] NOT NULL DEFAULT '{}',
  source        TEXT NOT NULL DEFAULT 'web',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_started_at_idx ON activities (started_at DESC);
CREATE INDEX IF NOT EXISTS activities_category_started_idx ON activities (category_id, started_at DESC);
CREATE INDEX IF NOT EXISTS activities_tags_idx ON activities USING GIN (tags);

-- A running stopwatch. The partial unique index allows at most one active timer.
CREATE TABLE IF NOT EXISTS timers (
  id           BIGSERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  tags         TEXT[] NOT NULL DEFAULT '{}',
  intensity    SMALLINT NOT NULL DEFAULT 3 CHECK (intensity BETWEEN 1 AND 5),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at   TIMESTAMPTZ,
  activity_id  BIGINT REFERENCES activities(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS timers_single_active_idx
  ON timers ((stopped_at IS NULL)) WHERE stopped_at IS NULL;

-- Saved generative artworks: enough parameters to re-render the piece, plus a thumbnail.
CREATE TABLE IF NOT EXISTS artworks (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  seed        BIGINT NOT NULL,
  range_key   TEXT NOT NULL,
  params      JSONB NOT NULL,
  thumbnail   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artworks_created_at_idx ON artworks (created_at DESC);

-- Default palette, sampled from the reference artwork.
INSERT INTO categories (slug, name, color, sort_order) VALUES
  ('work',     'Work',     '#3B7BE0', 10),
  ('learning', 'Learning', '#A9A3E3', 20),
  ('exercise', 'Exercise', '#B9D43C', 30),
  ('creative', 'Creative', '#F2E860', 40),
  ('social',   'Social',   '#3FA07C', 50),
  ('rest',     'Rest',     '#A6DBEA', 60),
  ('admin',    'Admin',    '#7F86C9', 70),
  ('other',    'Other',    '#9A948F', 80)
ON CONFLICT (slug) DO NOTHING;
