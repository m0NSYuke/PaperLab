param([string]$Registry = 'https://registry.npmjs.org')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force '.runtime','tmp' | Out-Null
$env:UV_CACHE_DIR = Join-Path $projectRoot '.runtime\uv-cache'
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
$uvPath = if ($uvCommand) { $uvCommand.Source } else { Join-Path $projectRoot '.tools\bin\uv.exe' }
if (-not (Test-Path -LiteralPath $uvPath)) {
    Write-Host 'Installing project-local uv...'
    python -m pip install --target .tools uv
    if ($LASTEXITCODE -ne 0) { throw 'Could not install uv. Check Python and network access.' }
}
& $uvPath sync --project backend --locked
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed.' }
Push-Location frontend
try {
    npm ci --registry=$Registry --cache .npm-cache --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependencies failed. Retry with -Registry https://registry.npmmirror.com if needed.' }
    npm run prepare:pdf
    if ($LASTEXITCODE -ne 0) { throw 'PDF resources failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host 'PaperLab is ready. Run .\scripts\start.ps1'
