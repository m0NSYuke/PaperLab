param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force 'tmp' | Out-Null
Push-Location backend
try {
    .\.venv\Scripts\python.exe -X utf8 -m pytest -q --basetemp=../tmp/pytest-check
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
} finally { Pop-Location }
Push-Location frontend
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
if ($Browser) {
    .\backend\.venv\Scripts\python.exe -X utf8 scripts\prepare_e2e.py
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare isolated test workspace.' }
    $env:PAPERLAB_ROOT = Join-Path $projectRoot 'tmp\e2e-workspace'
    # Browser tests use the offline dictionary but never load the GPU translation model.
    $env:PAPERLAB_MT_MODEL = Join-Path $projectRoot 'tmp\e2e-workspace\no-model.gguf'
    $service = Start-Process -FilePath (Join-Path $projectRoot 'backend\.venv\Scripts\python.exe') -ArgumentList '-X','utf8','-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8001','--app-dir','backend' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    try {
        Start-Sleep -Seconds 2
        Push-Location frontend
        try { npm run test:e2e; if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed.' } } finally { Pop-Location }
    } finally {
        if (-not $service.HasExited) { taskkill /PID $service.Id /T /F | Out-Null }
        Remove-Item Env:PAPERLAB_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:PAPERLAB_MT_MODEL -ErrorAction SilentlyContinue
    }
}
