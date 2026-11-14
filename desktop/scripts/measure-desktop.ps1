param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$TargetProcessId,
    [ValidateRange(1, 7200)][int]$DurationSeconds = 120,
    [ValidateRange(1, 30)][int]$IntervalSeconds = 2,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
# Supplementary resource measurements, not an interaction-latency/soak verdict.
# Observe only the selected process tree; never collect command lines, tokens,
# paths, window/document titles, audio or other applications' resource totals.
$ErrorActionPreference = 'Stop'
$selectedRoot = Get-Process -Id $TargetProcessId
if ($selectedRoot.ProcessName -notin @('LabOS V2 Preview', 'lab-inventory')) {
    throw 'Select the V2 Preview or V2 development desktop process, not V1 or another application.'
}
$rootStarted = $selectedRoot.StartTime.ToUniversalTime()
if (Test-Path -LiteralPath $OutputPath) { throw 'Output exists; choose a new filename to preserve earlier measurements.' }
$journalPath = $OutputPath + '.samples.jsonl'
$journalFile = [System.IO.File]::Open($journalPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
$journal = [System.IO.StreamWriter]::new($journalFile, [System.Text.UTF8Encoding]::new($false))
$journal.AutoFlush = $true
$samples = [System.Collections.Generic.List[object]]::new()
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$ended = 'duration_completed'
try {
    while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $rootNow = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
        if (-not $rootNow -or $rootNow.StartTime.ToUniversalTime() -ne $rootStarted) {
            $ended = 'selected_process_exited'
            break
        }
        $tree = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
        $owned = [System.Collections.Generic.HashSet[int]]::new()
        [void]$owned.Add($TargetProcessId)
        do {
            $added = $false
            foreach ($entry in $tree) {
                if ($owned.Contains([int]$entry.ParentProcessId) -and $owned.Add([int]$entry.ProcessId)) { $added = $true }
            }
        } while ($added)
        $processes = @($owned | ForEach-Object {
            $observed = Get-Process -Id $_ -ErrorAction SilentlyContinue
            if ($observed) {
                [pscustomobject]@{
                    id = $observed.Id
                    started_utc = $observed.StartTime.ToUniversalTime().ToString('o')
                    cpu_seconds = $observed.CPU
                    working_set_bytes = $observed.WorkingSet64
                    private_bytes = $observed.PrivateMemorySize64
                    handles = $observed.HandleCount
                }
            }
        })
        $sample = [pscustomobject]@{
            observed_utc = [DateTime]::UtcNow.ToString('o')
            elapsed_seconds = [math]::Round($clock.Elapsed.TotalSeconds, 3)
            root_responding = $rootNow.Responding
            processes = $processes
        }
        $samples.Add($sample)
        $journal.WriteLine(($sample | ConvertTo-Json -Depth 6 -Compress))
        Start-Sleep -Seconds $IntervalSeconds
    }
} catch {
    $ended = 'measurement_failed'
    throw
} finally {
    $journal.Dispose()
    $report = [ordered]@{
        format = 1
        purpose = 'Selected V2 process-tree resource samples; not proof of UI responsiveness'
        root_process_id = $TargetProcessId
        root_started_utc = $rootStarted.ToString('o')
        logical_processors = [Environment]::ProcessorCount
        ended = $ended
        elapsed_seconds = [math]::Round($clock.Elapsed.TotalSeconds, 3)
        samples = $samples
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($report | ConvertTo-Json -Depth 8))
    $destination = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try { $destination.Write($bytes, 0, $bytes.Length) } finally { $destination.Dispose() }
}
Write-Output "Recorded $($samples.Count) V2 process-tree samples. No application data was changed."
