param(
    [switch]$SkipFirebaseSecret,
    [switch]$SkipResendSecret
)

$ErrorActionPreference = "Stop"

$WorkerRoot = Resolve-Path $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $WorkerRoot "..\..")
$Config = Join-Path $WorkerRoot "wrangler.toml"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm is required."
}

function Invoke-Wrangler {
    param([string[]]$Arguments)

    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& npx --yes --loglevel=silent wrangler@latest @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    $output | ForEach-Object { Write-Host $_ }

    if ($exitCode -ne 0) {
        throw "Wrangler command failed: $($Arguments -join ' ')"
    }
}

function Set-WorkerSecret {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $Value | & npx --yes --loglevel=silent wrangler@latest secret put $Name --config $Config
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($exitCode -ne 0) {
        throw "Failed to store Worker secret: $Name"
    }

    Write-Host "Configured Worker secret: $Name" -ForegroundColor Green
}

Push-Location $WorkerRoot
try {
    $env:NO_COLOR = "1"
    $env:WRANGLER_SEND_METRICS = "false"

    Write-Host "Checking Cloudflare authentication..." -ForegroundColor Cyan
    Invoke-Wrangler @("whoami")

    if (-not $SkipFirebaseSecret) {
        $credentialCandidates = @(
            (Join-Path $RepoRoot "serviceAccountKey.json"),
            (Join-Path $RepoRoot "firebase-adminsdk.json")
        )

        $credentialPath = $credentialCandidates |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1

        if (-not $credentialPath) {
            throw "Firebase service-account JSON was not found in the repository root."
        }

        $firebaseJson = Get-Content -LiteralPath $credentialPath -Raw
        Set-WorkerSecret -Name "FIREBASE_SERVICE_ACCOUNT_JSON" -Value $firebaseJson
        $firebaseJson = $null
    }

    if (-not $SkipResendSecret) {
        Write-Host ""
        Write-Host "Enter a CURRENT Resend API key." -ForegroundColor Yellow
        Write-Host "Use a newly rotated key if an older key was ever exposed. Do not paste it into chat." -ForegroundColor Yellow

        $secureKey = Read-Host "RESEND_API_KEY" -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

        try {
            $resendKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
            if ([string]::IsNullOrWhiteSpace($resendKey)) {
                throw "RESEND_API_KEY cannot be empty."
            }

            Set-WorkerSecret -Name "RESEND_API_KEY" -Value $resendKey
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
            $resendKey = $null
        }
    }

    Write-Host ""
    Write-Host "Deploying admin operations Worker..." -ForegroundColor Cyan
    Invoke-Wrangler @("deploy", "--config", $Config)

    $workerUrl = "https://nhrc-admin-ops.nhrc-dashboard-wp2.workers.dev"

    Write-Host ""
    Write-Host "Checking Worker health..." -ForegroundColor Cyan
    $healthy = $false

    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$workerUrl/health" -TimeoutSec 15
            if ($health.ok -eq $true) {
                $healthy = $true
                break
            }
        }
        catch {
        }

        Start-Sleep -Seconds 5
    }

    if (-not $healthy) {
        throw "Admin operations Worker health check failed."
    }

    Write-Host "Admin operations Worker health check passed." -ForegroundColor Green
    Write-Host "Worker URL: $workerUrl" -ForegroundColor Green
}
finally {
    Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
    Remove-Item Env:WRANGLER_SEND_METRICS -ErrorAction SilentlyContinue
    Pop-Location
}
