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

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found at $Python"
}

$PreviousPythonPath = $env:PYTHONPATH
$PreviousEndpoint = $env:PHYSIO_HEMAB_REFRESH_ENDPOINT

try {
    $env:PYTHONPATH = Join-Path $IntegrationRoot "src"
    $env:PHYSIO_HEMAB_REFRESH_ENDPOINT = $Url.TrimEnd('/')

    Set-Location $RepoRoot

    $pythonCode = @'
import os
from dotenv import load_dotenv

load_dotenv()

from publish_firestore import _firestore_client

endpoint = os.environ["PHYSIO_HEMAB_REFRESH_ENDPOINT"].rstrip("/")
client = _firestore_client()
client.collection("projects").document("physio-hemab-wp2").set(
    {"wp2RefreshEndpoint": endpoint},
    merge=True,
)
print("Physio-HeMAB WP2 refresh endpoint configured.")
'@

    & $Python -c $pythonCode
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to save the WP2 refresh endpoint to Firestore."
    }

    Write-Host "Endpoint: $($Url.TrimEnd('/'))" -ForegroundColor Green
}
finally {
    $env:PYTHONPATH = $PreviousPythonPath
    $env:PHYSIO_HEMAB_REFRESH_ENDPOINT = $PreviousEndpoint
}
