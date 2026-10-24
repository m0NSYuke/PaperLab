param([switch]$NoBrowser, [switch]$Lan)
# -Lan also serves phones/tablets on the same Wi-Fi; they need the access key in the printed link.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$tokenPath = Join-Path $projectRoot '.runtime\lan-token'
function Get-LanToken {
    # Kept across restarts so a phone's saved link keeps working; delete the file to revoke it.
    if (Test-Path -LiteralPath $tokenPath) { return (Get-Content -LiteralPath $tokenPath -Raw).Trim() }
    $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'.ToCharArray()
    $bytes = New-Object byte[] 12
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    New-Item -ItemType Directory -Force (Split-Path $tokenPath) | Out-Null
    Set-Content -LiteralPath $tokenPath -Value $token -Encoding ascii -NoNewline
    return $token
}
function Show-LanLinks {
    $token = Get-LanToken
    # Only adapters with a gateway are the real Wi-Fi/Ethernet; host-only VM adapters have none.
    $configs = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway })
    $addresses = $configs | ForEach-Object { $_.IPv4Address.IPAddress } |
        Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' }
    Write-Host ''
    Write-Host 'Open on a phone or iPad on the same Wi-Fi:'
    if (-not $addresses) { Write-Host '  (no Wi-Fi/Ethernet IPv4 address found)' }
    foreach ($ip in $addresses) { Write-Host "  http://${ip}:8000/?key=$token" }
    if ($configs | Where-Object { $_.NetProfile.NetworkCategory -eq 'Public' }) {
        Write-Host 'This Wi-Fi is set to Public in Windows, which blocks phones. Set it to Private (Settings > Network > Wi-Fi > this network).'
    }
    Write-Host 'If it still does not load, allow Python on Private networks in Windows Firewall.'
    "http://$($addresses | Select-Object -First 1):8000/?key=$token" | Set-Content -LiteralPath (Join-Path $projectRoot '.runtime\lan-url.txt') -Encoding utf8
}
$pythonPath = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath) -or -not (Test-Path -LiteralPath 'frontend\dist\index.html')) {
    throw 'Run .\scripts\setup.ps1 first.'
}
try {
    $existing = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
    if ($existing.status -eq 'ok' -and $existing.local_only) {
        if ([bool]$existing.lan -ne [bool]$Lan) {
            $mode = if ($existing.lan) { 'LAN' } else { 'local-only' }
            throw "PaperLab is already running in $mode mode. Run Stop-PaperLab.cmd first, then start again."
        }
        Write-Host 'PaperLab is already running: http://127.0.0.1:8000'
        if ($Lan) { Show-LanLinks }
        if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8000' }
        return
    }
    throw 'Port 8000 is occupied by another service.'
} catch [System.Net.WebException] { }
catch {
    if ($_.Exception.Message -like '*occupied*' -or $_.Exception.Message -like '*Stop-PaperLab*') { throw }
}
New-Item -ItemType Directory -Force '.runtime' | Out-Null
# Paper data lives in PAPERLAB_DATA_DIR (.env.local, default D:\PaperLab\data); see backend/app/paths.py.
Remove-Item Env:PAPERLAB_ROOT -ErrorAction SilentlyContinue
$bindHost = '127.0.0.1'
$env:PAPERLAB_LAN_TOKEN = ''
if ($Lan) { $bindHost = '0.0.0.0'; $env:PAPERLAB_LAN_TOKEN = Get-LanToken }
$service = Start-Process -FilePath $pythonPath -ArgumentList '-X','utf8','-m','uvicorn','app.main:app','--host',$bindHost,'--port','8000','--app-dir','backend' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput '.runtime\server.log' -RedirectStandardError '.runtime\server-error.log' -PassThru
@{ pid=$service.Id; started=$service.StartTime.ToUniversalTime().ToString('o'); executable=$pythonPath } | ConvertTo-Json | Set-Content '.runtime\server.json'
for ($attempt=0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($service.HasExited) { throw 'Server failed. Read .runtime\server-error.log.' }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 1
        if ($health.status -eq 'ok') {
            Write-Host 'PaperLab: http://127.0.0.1:8000'
            if ($Lan) { Show-LanLinks }
            if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8000' }
            return
        }
    } catch { }
}
throw 'Server startup timed out. Read .runtime\server-error.log.'
