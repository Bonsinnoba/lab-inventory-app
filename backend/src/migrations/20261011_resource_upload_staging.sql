CREATE TABLE IF NOT EXISTS resource_upload_staging (
  user_id UUID NOT NULL REFERENCES users(id),
  change_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  size_bytes BIGINT NOT NULL CHECK(size_bytes >= 0),
  sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,change_id)
);
