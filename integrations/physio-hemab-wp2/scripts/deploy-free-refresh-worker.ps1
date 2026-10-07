param(
    [switch]$SkipSecret,
    [string]$WorkersDevSubdomain
)

$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkerRoot = Join-Path $IntegrationRoot "refresh-worker"
$EndpointScript = Join-Path $PSScriptRoot "configure-refresh-endpoint.ps1"
$WranglerConfig = Join-Path $WorkerRoot "wrangler.toml"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm is required because this setup uses Cloudflare Wrangler through npx."
}

if (-not (Test-Path -LiteralPath $WorkerRoot)) {
    throw "Refresh worker directory not found: $WorkerRoot"
}

if (-not (Test-Path -LiteralPath $WranglerConfig)) {
    throw "Wrangler configuration not found: $WranglerConfig"
}

$workerConfigText = Get-Content -LiteralPath $WranglerConfig -Raw
$workerNameMatch = [regex]::Match($workerConfigText, '(?m)^name\s*=\s*"([^"]+)"')
if (-not $workerNameMatch.Success) {
    throw "Unable to determine the Worker name from wrangler.toml."
}
$WorkerName = $workerNameMatch.Groups[1].Value

function Invoke-WranglerJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& npx --yes --loglevel=silent wrangler@latest @Arguments 2>$null)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0) {
        throw "Wrangler command failed: $($Arguments -join ' ')"
    }

    $jsonText = ($output -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($jsonText)) {
        throw "Wrangler returned no JSON for: $($Arguments -join ' ')"
    }

    try {
        return $jsonText | ConvertFrom-Json
    }
    catch {
        throw "Wrangler returned invalid JSON for: $($Arguments -join ' ')"
    }
}

function Invoke-WranglerCaptured {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $lines = @(& npx --yes --loglevel=silent wrangler@latest @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Lines = $lines
        Text = ($lines -join [Environment]::NewLine)
    }
}

function Get-CloudflareContext {
    $identity = Invoke-WranglerJson -Arguments @("whoami", "--json")
    $auth = Invoke-WranglerJson -Arguments @("auth", "token", "--json")

    $accounts = @($identity.accounts)
    if ($accounts.Count -lt 1) {
        throw "Wrangler is authenticated but no Cloudflare account was returned."
    }

    if ($accounts.Count -gt 1) {
        throw "Multiple Cloudflare accounts are available. Use a Wrangler auth profile/account selection before running this script."
    }

    $accountId = [string]$accounts[0].id
    $token = [string]$auth.token

    if ([string]::IsNullOrWhiteSpace($accountId)) {
        throw "Cloudflare account ID could not be determined."
    }

    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "Cloudflare authentication token could not be obtained from Wrangler."
    }

    return [pscustomobject]@{
        AccountId = $accountId
        Token = $token
    }
}

function ConvertTo-WorkersDevLabel {
    param([string]$Value)

    $label = ([string]$Value).ToLowerInvariant()
    $label = [regex]::Replace($label, '[^a-z0-9-]+', '-')
    $label = [regex]::Replace($label, '-+', '-').Trim('-')

    if ($label.Length -gt 50) {
        $label = $label.Substring(0, 50).Trim('-')
    }

    return $label
}

function Ensure-WorkersDevSubdomain {
    param(
        [Parameter(Mandatory = $true)][string]$AccountId,
        [Parameter(Mandatory = $true)][string]$Token,
        [string]$PreferredSubdomain
    )

    $uri = "https://api.cloudflare.com/client/v4/accounts/$AccountId/workers/subdomain"
    $headers = @{
        Authorization = "Bearer $Token"
        "Content-Type" = "application/json"
    }

    try {
        $existing = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 30
        if ($existing.success -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$existing.result.subdomain)) {
            return [string]$existing.result.subdomain
        }
    }
    catch {
        # No account-level workers.dev subdomain yet; create one below.
    }

    $baseLabel = ConvertTo-WorkersDevLabel -Value $PreferredSubdomain
    if ([string]::IsNullOrWhiteSpace($baseLabel)) {
        $baseLabel = "nhrc-dashboard-wp2"
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($baseLabel)

    for ($i = 0; $i -lt 6; $i++) {
        $suffix = [Guid]::NewGuid().ToString("N").Substring(0, 6)
        $candidates.Add("$baseLabel-$suffix")
    }

    foreach ($candidate in $candidates) {
        $body = @{ subdomain = $candidate } | ConvertTo-Json -Compress

        try {
            $created = Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -Body $body -TimeoutSec 30
            if ($created.success -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$created.result.subdomain)) {
                Write-Host "Registered workers.dev account subdomain: $($created.result.subdomain).workers.dev" -ForegroundColor Green
                return [string]$created.result.subdomain
            }
        }
        catch {
            Write-Host "workers.dev name unavailable, trying another safe name..." -ForegroundColor DarkGray
        }
    }

    throw "Cloudflare could not create a workers.dev account subdomain after several safe attempts."
}

Push-Location $WorkerRoot

try {
    $env:NO_COLOR = "1"
    $env:WRANGLER_SEND_METRICS = "false"

    Write-Host "Checking Cloudflare authentication..." -ForegroundColor Cyan

    try {
        $context = Get-CloudflareContext
    }
    catch {
        Write-Host "Cloudflare login is required. A browser window will open." -ForegroundColor Yellow
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & npx --yes --loglevel=silent wrangler@latest login
            $loginExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }

        if ($loginExitCode -ne 0) {
            throw "Cloudflare login failed."
        }

        $context = Get-CloudflareContext
    }

    $preferred = if ([string]::IsNullOrWhiteSpace($WorkersDevSubdomain)) {
        "nhrc-dashboard-wp2"
    }
    else {
        $WorkersDevSubdomain
    }

    $accountSubdomain = Ensure-WorkersDevSubdomain `
        -AccountId $context.AccountId `
        -Token $context.Token `
        -PreferredSubdomain $preferred

    # Remove the token reference from our local variable as soon as the API setup is complete.
    $context.Token = $null

    if (-not $SkipSecret) {
        Write-Host ""
        Write-Host "Wrangler will now ask for GITHUB_TOKEN." -ForegroundColor Yellow
        Write-Host "Use the existing fine-grained GitHub token restricted to" -ForegroundColor Yellow
        Write-Host "WilliamDormechele/nhrc-dashboard with Actions: Read and write." -ForegroundColor Yellow
        Write-Host "Do not paste the token into ChatGPT or save it in this repository." -ForegroundColor Yellow
        Write-Host ""

        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & npx --yes --loglevel=silent wrangler@latest secret put GITHUB_TOKEN
            $secretExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }

        if ($secretExitCode -ne 0) {
            throw "Failed to store the GitHub token as a Cloudflare Worker secret."
        }
    }
    else {
        Write-Host ""
        Write-Host "Skipping GITHUB_TOKEN secret upload because -SkipSecret was supplied." -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "Deploying free refresh worker..." -ForegroundColor Cyan

    $deploy = Invoke-WranglerCaptured -Arguments @("deploy", "--config", $WranglerConfig)
    $deploy.Lines | ForEach-Object { Write-Host $_ }

    if ($deploy.ExitCode -ne 0) {
        throw "Cloudflare Worker deployment failed."
    }

    $workerUrl = "https://$WorkerName.$accountSubdomain.workers.dev"

    Write-Host ""
    Write-Host "Worker URL:" -ForegroundColor Cyan
    Write-Host $workerUrl -ForegroundColor Green

    Write-Host ""
    Write-Host "Configuring the dashboard refresh endpoint..." -ForegroundColor Cyan
    & $EndpointScript -Url $workerUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Worker deployed but dashboard endpoint configuration failed."
    }

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

    if ($healthy) {
        Write-Host "Worker health check passed." -ForegroundColor Green
    }
    else {
        Write-Host "Worker deployed and configured, but workers.dev DNS is still propagating. This can take a few minutes." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Free manual refresh service is configured." -ForegroundColor Green
}
finally {
    Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
    Remove-Item Env:WRANGLER_SEND_METRICS -ErrorAction SilentlyContinue
    Pop-Location
}
