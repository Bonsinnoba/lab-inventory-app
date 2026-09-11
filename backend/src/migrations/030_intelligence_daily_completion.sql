-- LabOS v2.4: daily-use preferences and completion controls
CREATE TABLE IF NOT EXISTS user_daily_use_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_pause_music BOOLEAN NOT NULL DEFAULT TRUE,
  music_volume NUMERIC(3,2) NOT NULL DEFAULT 0.65 CHECK (music_volume >= 0 AND music_volume <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION labos_daily_use_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS user_daily_use_preferences_updated_at ON user_daily_use_preferences;
CREATE TRIGGER user_daily_use_preferences_updated_at BEFORE UPDATE ON user_daily_use_preferences FOR EACH ROW EXECUTE FUNCTION labos_daily_use_touch_updated_at();
