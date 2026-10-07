param(
    [switch]$SkipFirebaseSecret,
    [switch]$SkipResendSecret
)

$ErrorActionPreference = "Stop"

$WorkerRoot = Resolve-Path $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $WorkerRoot "..\..")
$Config = Join-Path $WorkerRoot "wrangler.toml"
$EnvFile = Join-Path $RepoRoot ".env"
$WorkerUrl = "https://nhrc-admin-ops.nhrc-dashboard-wp2.workers.dev"

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

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $index = $trimmed.IndexOf("=")
        if ($index -lt 1) { continue }

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
        $envValues = Read-DotEnv -Path $EnvFile
        $resendKey = [string]$envValues["RESEND_API_KEY"]

        if ([string]::IsNullOrWhiteSpace($resendKey)) {
            Write-Host ""
            Write-Host "A Resend API key is required for account/access notification emails." -ForegroundColor Yellow
            Write-Host "Enter a CURRENT key. Do not paste it into ChatGPT or commit it." -ForegroundColor Yellow
            $secureKey = Read-Host "RESEND_API_KEY" -AsSecureString
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

            try {
                $resendKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
            }
            finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
            }
        }

        if ([string]::IsNullOrWhiteSpace($resendKey)) {
            throw "RESEND_API_KEY cannot be empty."
        }

        Set-WorkerSecret -Name "RESEND_API_KEY" -Value $resendKey
        $resendKey = $null
    }

    Write-Host ""
    Write-Host "Deploying admin operations Worker..." -ForegroundColor Cyan
    Invoke-Wrangler @("deploy", "--config", $Config)

    Write-Host ""
    Write-Host "Checking Worker health and required capabilities..." -ForegroundColor Cyan
    $health = $null

    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$WorkerUrl/health" -TimeoutSec 15
            if ($health.ok -eq $true) { break }
        }
        catch {
            $health = $null
        }
        Start-Sleep -Seconds 5
    }

    if (-not $health -or $health.ok -ne $true) {
        throw "Admin operations Worker health check failed."
    }

    if ($health.firebaseAdminConfigured -ne $true) {
        throw "Admin Worker is live but Firebase Admin credentials are not configured."
    }

    if ($health.emailConfigured -ne $true) {
        throw "Admin Worker is live but RESEND_API_KEY is not configured."
    }

    Write-Host "Admin operations Worker is healthy." -ForegroundColor Green
    Write-Host "Firebase Admin: configured" -ForegroundColor Green
    Write-Host "Email provider: configured" -ForegroundColor Green
    Write-Host "Worker URL: $WorkerUrl" -ForegroundColor Green
}
finally {
    Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
    Remove-Item Env:WRANGLER_SEND_METRICS -ErrorAction SilentlyContinue
    Pop-Location
}
