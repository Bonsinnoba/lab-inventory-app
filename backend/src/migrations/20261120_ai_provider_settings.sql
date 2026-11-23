-- Server administration only. Never included in client synchronization.
CREATE TABLE IF NOT EXISTS assistant_provider_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
