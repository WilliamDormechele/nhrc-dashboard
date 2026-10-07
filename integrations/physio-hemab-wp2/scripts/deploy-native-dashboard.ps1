$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $IntegrationRoot "..\..")
$FirebaseProject = "nhrc-dashboard"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Physio-HeMAB WP2 free-tier native dashboard deploy" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $RepoRoot

Write-Host "[1/9] Confirming repository state..." -ForegroundColor Yellow
git branch --show-current
git status --short

Write-Host ""
Write-Host "[2/9] Running WP2 structural validation..." -ForegroundColor Yellow
npm run test:physio-hemab-wp2
if ($LASTEXITCODE -ne 0) {
    throw "Physio-HeMAB WP2 validation failed."
}

$Python = Join-Path $IntegrationRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found at $Python"
}

Write-Host ""
Write-Host "[3/9] Ensuring Python dependencies are installed..." -ForegroundColor Yellow
& $Python -m pip install -r (Join-Path $IntegrationRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Physio-HeMAB Python dependencies."
}

Write-Host ""
Write-Host "[4/9] Starting/upgrading local PostgreSQL reporting layer..." -ForegroundColor Yellow
& (Join-Path $IntegrationRoot "scripts\setup-db.ps1")

Write-Host ""
Write-Host "[5/9] Synchronizing both REDCap projects locally..." -ForegroundColor Yellow
& $Python (Join-Path $IntegrationRoot "src\sync.py") all
if ($LASTEXITCODE -ne 0) {
    throw "REDCap synchronization failed."
}

Write-Host ""
Write-Host "[6/9] Publishing privacy-minimised dashboard snapshot to Firestore..." -ForegroundColor Yellow
& $Python (Join-Path $IntegrationRoot "src\publish_firestore.py")
if ($LASTEXITCODE -ne 0) {
    throw "Firestore snapshot publishing failed."
}

Write-Host ""
Write-Host "[7/9] Installing/refreshing the 5-minute automatic data task..." -ForegroundColor Yellow
& (Join-Path $IntegrationRoot "scripts\install-auto-refresh-task.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Automatic 5-minute refresh task installation failed."
}

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
    throw "Firebase CLI is not installed or is not available on PATH."
}

Write-Host ""
Write-Host "[8/9] Regenerating versioned hosting index..." -ForegroundColor Yellow
npm run build:version
if ($LASTEXITCODE -ne 0) {
    throw "Versioned index generation failed."
}

Write-Host ""
Write-Host "[9/9] Deploying Firebase Hosting only..." -ForegroundColor Yellow
$deployArgs = @(
    "deploy",
    "--only",
    "hosting",
    "--project",
    $FirebaseProject
)
& firebase @deployArgs
if ($LASTEXITCODE -ne 0) {
    throw "Firebase Hosting deployment failed."
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host " Physio-HeMAB native dashboard deployment completed" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Open:" -ForegroundColor Green
Write-Host "https://nhrc-dashboard.web.app/"
Write-Host ""
Write-Host "This deployment uses no Power BI embed, no Cloud Functions, and no Secret Manager."
Write-Host "Users authenticate only with the existing NHRC Firebase login."
