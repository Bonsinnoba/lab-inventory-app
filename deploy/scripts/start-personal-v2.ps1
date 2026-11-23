# Starts only the existing migrated personal V2 containers. Never initializes,
# rebuilds or deletes a database/volume. V1 backups and Preview remain separate.
$ErrorActionPreference='Stop'
$database='labos-personal-v2-db-20261114'
$api='labos-personal-v2-api-20261114'
foreach($name in @($database,$api)){
    & docker inspect $name *> $null
    if($LASTEXITCODE -ne 0){throw "Existing personal V2 container missing: $name. Do not initialize a replacement database."}
}
& docker start $database
if($LASTEXITCODE -ne 0){throw 'Personal V2 PostgreSQL did not start'}
$ready=$false
for($attempt=0;$attempt -lt 30;$attempt++){
    & docker exec $database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null
    if($LASTEXITCODE -eq 0){$ready=$true;break}
    Start-Sleep -Seconds 1
}
if(-not $ready){throw 'Existing PostgreSQL is not ready; files and database were not reset'}
& docker start $api
if($LASTEXITCODE -ne 0){throw 'Personal V2 API did not start'}
for($attempt=0;$attempt -lt 30;$attempt++){
    try{$health=Invoke-RestMethod -Uri 'http://localhost:4010/api/health' -TimeoutSec 3;return $health}catch{Start-Sleep -Seconds 1}
}
throw 'API health did not become ready. Inspect logs; do not delete volumes.'
