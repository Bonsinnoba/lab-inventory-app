$ErrorActionPreference = "Stop"

# LabOS clean local-test reset.
# Run from the repository root or this script's deploy directory.
$DeployDir = Split-Path -Parent $PSScriptRoot
Set-Location $DeployDir

if (-not (Test-Path ".env.production")) {
    throw "deploy/.env.production is missing. Copy deploy/.env.production.example and configure it first."
}

Write-Host "Stopping LabOS Compose services and removing their volumes..." -ForegroundColor Yellow
docker compose --env-file .env.production down -v --remove-orphans

Write-Host "Removing any stale containers using the LabOS project name..." -ForegroundColor Yellow
$containers = docker ps -a --filter "label=com.docker.compose.project=labos" --format "{{.ID}}"
if ($containers) {
    docker rm -f $containers
}

Write-Host "Removing the named LabOS data volumes if they still exist..." -ForegroundColor Yellow
foreach ($volume in @("labos_postgres", "labos_storage")) {
    $exists = docker volume ls --format "{{.Name}}" | Where-Object { $_ -eq $volume }
    if ($exists) {
        docker volume rm $volume
    }
}

Write-Host "LabOS Docker state is clean." -ForegroundColor Green
Write-Host ""
Write-Host "Next: docker compose --env-file .env.production up -d --build"