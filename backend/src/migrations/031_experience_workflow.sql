-- LabOS v2.5: experience/workflow layer
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION labos_notification_pref_touch() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS user_notification_preferences_updated_at ON user_notification_preferences;
CREATE TRIGGER user_notification_preferences_updated_at BEFORE UPDATE ON user_notification_preferences
FOR EACH ROW EXECUTE FUNCTION labos_notification_pref_touch();
