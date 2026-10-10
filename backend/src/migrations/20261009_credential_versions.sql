-- Additive migration; old signed JWTs remain version-zero credentials until
-- their account's next password change/reset or disable operation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 0
    CHECK (credential_version >= 0);

CREATE OR REPLACE FUNCTION labos_credential_version() RETURNS trigger AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR (OLD.is_active AND NOT NEW.is_active) THEN
    NEW.credential_version := OLD.credential_version + 1;
  ELSE
    NEW.credential_version := GREATEST(OLD.credential_version, NEW.credential_version);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS labos_credential_version ON users;
CREATE TRIGGER labos_credential_version BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION labos_credential_version();
