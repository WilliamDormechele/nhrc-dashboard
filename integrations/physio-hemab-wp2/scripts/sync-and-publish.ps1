$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $IntegrationRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found at $Python"
}

Set-Location $IntegrationRoot

$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

Write-Host "Synchronizing REDCap..." -ForegroundColor Cyan
& $Python ".\src\sync.py" all
if ($LASTEXITCODE -ne 0) {
    throw "REDCap synchronization failed."
}

Write-Host "Publishing Firestore dashboard snapshot..." -ForegroundColor Cyan
& $Python ".\src\publish_firestore.py"
if ($LASTEXITCODE -ne 0) {
    throw "Firestore snapshot publishing failed."
}

Write-Host "Physio-HeMAB WP2 dashboard snapshot updated." -ForegroundColor Green
