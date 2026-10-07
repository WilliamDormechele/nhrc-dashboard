$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $IntegrationRoot "..\..")
$Repo = "WilliamDormechele/nhrc-dashboard"
$EnvFile = Join-Path $RepoRoot ".env"

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Local .env file not found at $EnvFile"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is not installed or is not available on PATH."
}

& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run: gh auth login"
}

function Read-DotEnv {
    param([Parameter(Mandatory = $true)][string]$Path)

    $values = @{}

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()

        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $index = $trimmed.IndexOf("=")
        if ($index -lt 1) {
            continue
        }

        $name = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1).Trim()

        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $values[$name] = $value
    }

    return $values
}

function Require-Value {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $value = [string]$Values[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required local .env value is missing: $Name"
    }

    return $value
}

function Set-RepoSecret {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $Value | & gh secret set $Name --repo $Repo
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set GitHub Actions secret: $Name"
    }

    Write-Host "Configured GitHub Actions secret: $Name" -ForegroundColor Green
}

$values = Read-DotEnv -Path $EnvFile

$secretMap = @{
    PHYSIO_HEMAB_MAIN_REDCAP_API_URL = Require-Value $values "PHYSIO_HEMAB_MAIN_REDCAP_API_URL"
    PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN = Require-Value $values "PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN"
    PHYSIO_HEMAB_MAIN_REDCAP_RECORD_ID_FIELD = (
        [string]$values["PHYSIO_HEMAB_MAIN_REDCAP_RECORD_ID_FIELD"]
    )
    PHYSIO_HEMAB_DEVICES_REDCAP_API_URL = Require-Value $values "PHYSIO_HEMAB_DEVICES_REDCAP_API_URL"
    PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN = Require-Value $values "PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN"
    PHYSIO_HEMAB_DEVICES_REDCAP_RECORD_ID_FIELD = (
        [string]$values["PHYSIO_HEMAB_DEVICES_REDCAP_RECORD_ID_FIELD"]
    )
}

if ([string]::IsNullOrWhiteSpace($secretMap.PHYSIO_HEMAB_MAIN_REDCAP_RECORD_ID_FIELD)) {
    $secretMap.PHYSIO_HEMAB_MAIN_REDCAP_RECORD_ID_FIELD = "record_id"
}

if ([string]::IsNullOrWhiteSpace($secretMap.PHYSIO_HEMAB_DEVICES_REDCAP_RECORD_ID_FIELD)) {
    $secretMap.PHYSIO_HEMAB_DEVICES_REDCAP_RECORD_ID_FIELD = "record_id"
}

foreach ($entry in $secretMap.GetEnumerator()) {
    Set-RepoSecret -Name $entry.Key -Value ([string]$entry.Value)
}

$credentialSetting = [string]$values["PHYSIO_HEMAB_FIREBASE_CREDENTIALS_FILE"]
$credentialCandidates = @()

if (-not [string]::IsNullOrWhiteSpace($credentialSetting)) {
    if ([System.IO.Path]::IsPathRooted($credentialSetting)) {
        $credentialCandidates += $credentialSetting
    }
    else {
        $credentialCandidates += (Join-Path $RepoRoot $credentialSetting)
        $credentialCandidates += (Join-Path $IntegrationRoot $credentialSetting)
    }
}

$credentialCandidates += (Join-Path $RepoRoot "serviceAccountKey.json")
$credentialCandidates += (Join-Path $RepoRoot "firebase-adminsdk.json")

$credentialPath = $credentialCandidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

if (-not $credentialPath) {
    throw "Firebase service-account JSON was not found. Keep it local and set PHYSIO_HEMAB_FIREBASE_CREDENTIALS_FILE in .env if necessary."
}

$firebaseJson = Get-Content -LiteralPath $credentialPath -Raw
Set-RepoSecret -Name "PHYSIO_HEMAB_FIREBASE_SERVICE_ACCOUNT_JSON" -Value $firebaseJson

Write-Host ""
Write-Host "GitHub Actions refresh secrets are configured without printing their values." -ForegroundColor Green
