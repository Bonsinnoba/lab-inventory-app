[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DesktopData,
    [Parameter(Mandatory)][string]$Destination,
    [string]$ApiContainer = 'labos-labos-api-1',
    [string]$DatabaseContainer = 'labos-db-1',
    [ValidateSet('labos_storage', 'labos_v1_storage')][string]$ExpectedStorageVolume = 'labos_storage',
    [string]$ServerConfig,
    [switch]$Capture,
    [switch]$WritesQuiesced
)
# Default is read-only planning. Never closes apps, stops services, restores or
# deletes data. Call only from the owner account; the output contains private data.
$ErrorActionPreference = 'Stop'
function Docker-Checked([string[]]$Arguments) {
    $result = & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($Arguments[0])" }
    return $result
}
$source = (Resolve-Path -LiteralPath $DesktopData).Path
if (-not (Test-Path -LiteralPath (Join-Path $source 'labos-local.db') -PathType Leaf)) { throw 'Desktop database missing' }
$target = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $target) { throw 'Choose a new, unused backup destination' }
if ($target.StartsWith($source.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must not be inside live desktop data' }
$api = (Docker-Checked @('inspect',$ApiContainer) | ConvertFrom-Json)[0]
$db = (Docker-Checked @('inspect',$DatabaseContainer) | ConvertFrom-Json)[0]
if (-not $db.State.Running) { throw 'Existing PostgreSQL must be running for pg_dump' }
$storage = @($api.Mounts | Where-Object Destination -eq '/app/storage')
if ($storage.Count -ne 1 -or $storage[0].Name -ne $ExpectedStorageVolume) { throw 'Unexpected storage mount; review manually' }
$desktopProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(lab-inventory|labos|lab inventory|labos v1)(\.exe)?$' })
if (-not $Capture) {
    [pscustomobject]@{Mode='PLAN ONLY';DesktopData=$source;Destination=$target;ApiRunning=$api.State.Running;DesktopProcesses=$desktopProcesses.Count;StorageVolume=$storage[0].Name;Requires='Saved/closed desktop; stopped API; all other writers quiesced; private destination'}
    return
}
if (-not $WritesQuiesced -or $api.State.Running -or $desktopProcesses.Count -gt 0) { throw 'Capture requires explicit quiescence, stopped API and closed desktop' }
# Reject reparse points rather than silently crossing into another data tree.
if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse-point desktop root unsupported' }
$entries = @(Get-ChildItem -LiteralPath $source -Recurse -Force)
if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Reparse points in desktop data require manual review' }
New-Item -ItemType Directory -Path $target | Out-Null
$desktopTarget = Join-Path $target 'desktop-data'
$storageTarget = Join-Path $target 'server-storage'
New-Item -ItemType Directory -Path $desktopTarget,$storageTarget | Out-Null
if ($ServerConfig) {
    $configSource = (Resolve-Path -LiteralPath $ServerConfig).Path
    $configTarget = Join-Path $target 'protected-config'
    New-Item -ItemType Directory -Path $configTarget | Out-Null
    Copy-Item -LiteralPath $configSource -Destination (Join-Path $configTarget 'server.env')
}
# Include WAL/SHM and authored files, not just the main database file.
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $desktopTarget -Recurse -Force
$stage = '/tmp/labos-pilot-'+[Guid]::NewGuid().ToString('N')+'.dump'
# Binary dump stays binary through docker cp, avoiding PowerShell redirection.
Docker-Checked @('exec',$DatabaseContainer,'sh','-c','pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1"','backup',$stage) | Out-Null
Docker-Checked @('exec',$DatabaseContainer,'pg_restore','--list',$stage) | Out-Null
Docker-Checked @('cp',"${DatabaseContainer}:$stage",(Join-Path $target 'postgres.dump')) | Out-Null
Docker-Checked @('cp',"${ApiContainer}:/app/storage/.",$storageTarget) | Out-Null
$files = @(Get-ChildItem -LiteralPath $target -Recurse -File -Force | ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($target.Length+1);bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
$manifest = [ordered]@{
    format=1;createdUtc=[DateTime]::UtcNow.ToString('o');status='CAPTURED_NOT_RESTORE_VERIFIED'
    desktopSource=$source;apiImage=$api.Image;databaseImage=$db.Image
    storageVolume=$storage[0].Name;postgresStagingFile=$stage;files=$files
    serverConfigIncluded=[bool]$ServerConfig
    exclusions=@('Additional secrets/OS-bound keys require separate recovery review','Restore verification not performed','External originals not managed by LabOS')
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding UTF8
Write-Output "Captured (not restore verified): $target"
Write-Output "PostgreSQL staging dump retained in container: $stage"
Write-Output 'Treat this backup as confidential. Services remain in their original stopped/running state.'
