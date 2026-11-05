// Migration v159: devices registered by the mobile app for push notifications. Additive.
export const PUSH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS push_devices (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    platform    VARCHAR(10) NOT NULL DEFAULT 'android',
    device_name TEXT,
    app_version VARCHAR(20),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id) WHERE active;
`;
