$ErrorActionPreference = 'Stop'
# Run with npm and the Windows Rust toolchain on PATH. Never builds the API.
$names = @('VITE_API_BASE_URL', 'LABOS_NATIVE_API_BASE')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $env:VITE_API_BASE_URL = 'http://localhost:4010/api'
    $env:LABOS_NATIVE_API_BASE = 'http://localhost:4010/api'
    & ./node_modules/.bin/tauri.cmd build --config src-tauri/tauri.v1.conf.json --bundles nsis --ci -- --locked --offline -j 1
    if ($LASTEXITCODE -ne 0) { throw 'V1 installer build failed.' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    Pop-Location
}
