"""Read-only manifest and copied-SQLite verification; never open the live DB."""
import hashlib
import json
import pathlib
import sqlite3
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
scratch = pathlib.Path(sys.argv[2]).resolve(strict=True)
if scratch == root or root in scratch.parents:
    raise SystemExit('SQLite verification copy must be separate from backup')
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

for entry in manifest['files']:
    path = (root / entry['path']).resolve(strict=True)
    if root not in path.parents:
        raise SystemExit('Unsafe manifest path')
    assert path.stat().st_size == entry['bytes'], 'Backup size mismatch'
    assert sha(path).lower() == entry['sha256'].lower(), 'Backup checksum mismatch'
db = scratch / 'labos-local.db'
assert sha(db) == sha(root / 'desktop-data' / 'labos-local.db'), 'SQLite copy differs'
c = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)
assert c.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'SQLite integrity failure'
fk_errors = c.execute('PRAGMA foreign_key_check').fetchall()
tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
outbox = c.execute('SELECT count(*),sum(synced_at IS NULL) FROM sync_outbox').fetchone()
uploads = {'checked': 0, 'missing_or_invalid': 0}
if 'local_resource_uploads' in tables:
    for account, change, size, digest in c.execute("SELECT account_id,change_id,size_bytes,sha256 FROM local_resource_uploads WHERE state='ready'"):
        path = (root / 'desktop-data' / 'resource-files' / account / change / 'content').resolve()
        assert root in path.parents, 'Unsafe authored file reference'
        uploads['checked'] += 1
        if not path.is_file() or path.stat().st_size != size or (digest and sha(path).lower() != digest.lower()):
            uploads['missing_or_invalid'] += 1
copies = {'checked': 0, 'missing_or_invalid': 0}
if 'local_resource_copies' in tables:
    for account, resource, digest, size in c.execute("SELECT account_id,resource_id,sha256,size_bytes FROM local_resource_copies WHERE state='ready'"):
        path = (root / 'desktop-data' / 'resource-copies' / account / resource / (digest + '.content')).resolve()
        assert root in path.parents, 'Unsafe replicated file reference'
        copies['checked'] += 1
        if not path.is_file() or path.stat().st_size != size or sha(path).lower() != digest.lower():
            copies['missing_or_invalid'] += 1
c.close()
result = {'manifest_files_verified':len(manifest['files']), 'manifest_bytes':sum(e['bytes'] for e in manifest['files']),
          'sqlite_integrity':'ok','sqlite_foreign_key_violations':len(fk_errors),
          'outbox_total':outbox[0],'outbox_pending':outbox[1] or 0,'ready_authored_files':uploads,'ready_replicated_files':copies,
          'limits':'Not a running app recovery or replacement-PC key test; no server file-reference check yet'}
print(json.dumps(result, indent=2))
if fk_errors or uploads['missing_or_invalid'] or copies['missing_or_invalid']:
    raise SystemExit(1)
