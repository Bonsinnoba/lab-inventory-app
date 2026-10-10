-- Preserve all settings and jobs. Every writer participates in version checks,
-- including legacy HTTP clients until they are upgraded.
ALTER TABLE media_download_settings ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION bump_download_settings_version() RETURNS trigger AS $$
BEGIN
  NEW.sync_version := OLD.sync_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS media_download_settings_version ON media_download_settings;
CREATE TRIGGER media_download_settings_version BEFORE UPDATE ON media_download_settings
FOR EACH ROW EXECUTE FUNCTION bump_download_settings_version();
