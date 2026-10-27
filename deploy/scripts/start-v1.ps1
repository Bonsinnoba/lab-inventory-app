$ErrorActionPreference = 'Stop'
$compose = Join-Path $PSScriptRoot '../docker-compose.v1.yml'
if (-not (Test-Path (Join-Path $PSScriptRoot '../.env.v1'))) {
    throw 'V1 configuration is missing. Restore its protected configuration backup; do not generate new credentials for an existing database.'
}
& docker compose -f $compose up -d --no-build
if ($LASTEXITCODE -ne 0) { throw 'V1 server startup failed. Check Docker Desktop.' }
& docker compose -f $compose ps
