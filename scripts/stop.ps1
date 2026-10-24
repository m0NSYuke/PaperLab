$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$recordPath = Join-Path $projectRoot '.runtime\server.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Host 'No script-owned server recorded.'; return }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$service = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if ($service) {
    # PowerShell 7 may deserialize an ISO timestamp into DateTime; compare instants.
    $recordedStartUtc = ([datetime]$record.started).ToUniversalTime()
    if ($service.Path -ne $record.executable -or $service.StartTime.ToUniversalTime().Ticks -ne $recordedStartUtc.Ticks) {
        throw 'Process identity changed; refusing to stop an unrelated process.'
    }
    taskkill /PID $record.pid /T /F
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop server.' }
}
Remove-Item -LiteralPath $recordPath
Write-Host 'PaperLab stopped. All paper data remains on disk.'
