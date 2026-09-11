-- Add optional profile fields without changing existing account credentials.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users (lower(email))
  WHERE email IS NOT NULL;
