ALTER TABLE user_daily_use_preferences ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION labos_daily_use_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.sync_version := OLD.sync_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- All notification producers, including future ones, honor the account's
-- delivery preference. Historical notifications and media columns are retained.
CREATE OR REPLACE FUNCTION labos_notification_delivery_gate() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND is_active)
     OR EXISTS (SELECT 1 FROM user_daily_use_preferences WHERE user_id=NEW.user_id AND NOT notifications_enabled)
  THEN RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS notifications_delivery_gate ON notifications;
CREATE TRIGGER notifications_delivery_gate BEFORE INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION labos_notification_delivery_gate();
