param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "Stop"

if ($Url -notmatch '^https://') {
    throw "Refresh endpoint must use HTTPS."
}

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $IntegrationRoot "..\..")
$Python = Join-Path $IntegrationRoot ".venv\Scripts\python.exe"
$Configurator = Join-Path $IntegrationRoot "src\configure_refresh_endpoint.py"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found at $Python"
}

if (-not (Test-Path -LiteralPath $Configurator)) {
    throw "Refresh endpoint configurator not found at $Configurator"
}

$Endpoint = $Url.Trim().TrimEnd('/')

Push-Location $RepoRoot
try {
    & $Python $Configurator --url $Endpoint
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to save the WP2 refresh endpoint to Firestore."
    }
}
finally {
    Pop-Location
}
