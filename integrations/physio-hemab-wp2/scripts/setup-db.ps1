param()

$ErrorActionPreference = "Stop"

$IntegrationDir = Split-Path -Parent $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $IntegrationDir "..\..")
$EnvFile = Join-Path $RepoRoot ".env"
$ComposeFile = Join-Path $IntegrationDir "compose.yaml"

if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile. Add the Physio-HeMAB database settings to the repository root .env file first."
}

Write-Host "Starting Physio-HeMAB WP2 PostgreSQL..." -ForegroundColor Cyan
docker compose --env-file $EnvFile -f $ComposeFile up -d postgres
if ($LASTEXITCODE -ne 0) {
    throw "Failed to start the Physio-HeMAB WP2 PostgreSQL container."
}

Write-Host "Waiting for PostgreSQL health check..." -ForegroundColor Cyan
$healthy = $false

for ($i = 0; $i -lt 30; $i++) {
    $status = docker inspect --format='{{.State.Health.Status}}' physio-hemab-wp2-postgres 2>$null

    if ($status -eq "healthy") {
        $healthy = $true
        break
    }

    Start-Sleep -Seconds 2
}

if (-not $healthy) {
    docker compose --env-file $EnvFile -f $ComposeFile ps
    throw "PostgreSQL did not become healthy in time."
}

Write-Host "Applying database schema..." -ForegroundColor Cyan
docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /opt/physio-hemab/sql/schema.sql'
if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply the Physio-HeMAB WP2 database schema."
}

Write-Host "Applying reporting views..." -ForegroundColor Cyan
docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /opt/physio-hemab/sql/views.sql'
if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply the Physio-HeMAB WP2 reporting views."
}

Write-Host "Physio-HeMAB WP2 PostgreSQL is ready." -ForegroundColor Green
