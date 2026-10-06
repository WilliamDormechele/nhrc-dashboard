$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $IntegrationRoot "..\..")
$FirebaseProject = "nhrc-dashboard"

function Read-DotEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $values = @{}

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()

        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) {
            continue
        }

        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()

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

function Get-RequiredValue {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $value = [string]$Values[$Name]

    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required value is missing from .env: $Name"
    }

    return $value.Trim()
}

function Set-FirebaseSecretFromValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) (
        "nhrc-dashboard-" + [Guid]::NewGuid().ToString("N") + ".txt"
    )

    try {
        [System.IO.File]::WriteAllText(
            $tempPath,
            $Value,
            [System.Text.UTF8Encoding]::new($false)
        )

        Write-Host "Setting Firebase secret: $Name" -ForegroundColor Cyan

        $secretArgs = @(
            "functions:secrets:set",
            $Name,
            "--data-file",
            $tempPath,
            "--project",
            $FirebaseProject
        )

        & firebase @secretArgs

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to set Firebase secret: $Name"
        }
    }
    finally {
        if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force
        }
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Physio-HeMAB WP2 native dashboard production deploy" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $RepoRoot

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
    throw "Firebase CLI is not installed or is not available on PATH."
}

Write-Host "[1/7] Confirming repository state..." -ForegroundColor Yellow
git branch --show-current
git status --short

Write-Host ""
Write-Host "[2/7] Running WP2 validation..." -ForegroundColor Yellow
npm run test:physio-hemab-wp2

if ($LASTEXITCODE -ne 0) {
    throw "Physio-HeMAB WP2 validation failed."
}

$envCandidates = @(
    (Join-Path $RepoRoot ".env"),
    (Join-Path $IntegrationRoot ".env")
)

$envPath = $envCandidates |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1

if (-not $envPath) {
    throw "No .env file was found at the repository root or integration folder."
}

Write-Host ""
Write-Host "[3/7] Reading local REDCap configuration from:" -ForegroundColor Yellow
Write-Host "      $envPath"

$envValues = Read-DotEnvFile -Path $envPath

$mainUrl = Get-RequiredValue -Values $envValues -Name "PHYSIO_HEMAB_MAIN_REDCAP_API_URL"
$devicesUrl = Get-RequiredValue -Values $envValues -Name "PHYSIO_HEMAB_DEVICES_REDCAP_API_URL"
$mainToken = Get-RequiredValue -Values $envValues -Name "PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN"
$devicesToken = Get-RequiredValue -Values $envValues -Name "PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN"

if ($mainUrl.TrimEnd("/") -ne $devicesUrl.TrimEnd("/")) {
    throw "The Main and Devices REDCap API URLs differ. Review the .env configuration before deploying."
}

$apiUrl = $mainUrl.TrimEnd("/") + "/"

Write-Host ""
Write-Host "[4/7] Updating Firebase Secret Manager values..." -ForegroundColor Yellow

Set-FirebaseSecretFromValue -Name "PHYSIO_HEMAB_REDCAP_API_URL" -Value $apiUrl
Set-FirebaseSecretFromValue -Name "PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN" -Value $mainToken
Set-FirebaseSecretFromValue -Name "PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN" -Value $devicesToken

Write-Host ""
Write-Host "[5/7] Deploying the secure Firebase callable functions..." -ForegroundColor Yellow

$functionDeployArgs = @(
    "deploy",
    "--only",
    "functions:getPhysioHemabWp2Dashboard,functions:savePhysioHemabWp2Config",
    "--project",
    $FirebaseProject
)

& firebase @functionDeployArgs

if ($LASTEXITCODE -ne 0) {
    throw "Firebase function deployment failed."
}

Write-Host ""
Write-Host "[6/7] Regenerating versioned hosting index..." -ForegroundColor Yellow
npm run build:version

if ($LASTEXITCODE -ne 0) {
    throw "Versioned index generation failed."
}

Write-Host ""
Write-Host "[7/7] Deploying Firebase Hosting..." -ForegroundColor Yellow

$hostingDeployArgs = @(
    "deploy",
    "--only",
    "hosting",
    "--project",
    $FirebaseProject
)

& firebase @hostingDeployArgs

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
Write-Host "Sign in with an NHRC dashboard account assigned to physio-hemab-wp2."
Write-Host "No Power BI sign-in is required."
