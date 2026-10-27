// Creates fresh independent service secrets; never overwrites existing configuration.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const password = randomBytes(32).toString('hex');
const jwt = randomBytes(48).toString('hex');
const content = `NODE_ENV=production
HOST=0.0.0.0
PORT=4000
PGHOST=db
PGPORT=5432
PGDATABASE=labos_v1
PGUSER=labos_v1
PGPASSWORD=${password}
POSTGRES_DB=labos_v1
POSTGRES_USER=labos_v1
POSTGRES_PASSWORD=${password}
JWT_SECRET=${jwt}
JWT_EXPIRES_IN=7d
STORAGE_DIR=/app/storage
PUBLIC_BASE_URL=http://localhost:4010
ALLOWED_ORIGINS=http://tauri.localhost,https://tauri.localhost,tauri://localhost
MAX_UPLOAD_MB=500
MAX_JSON_MB=2
`;
writeFileSync(new URL('../.env.v1', import.meta.url), content, { flag: 'wx', mode: 0o600 });
console.log('Created isolated V1 configuration. Secrets were not printed. Back up this file securely.');
