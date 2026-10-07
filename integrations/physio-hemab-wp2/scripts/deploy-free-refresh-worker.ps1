$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkerRoot = Join-Path $IntegrationRoot "refresh-worker"
$EndpointScript = Join-Path $PSScriptRoot "configure-refresh-endpoint.ps1"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm is required because this setup uses the Cloudflare Wrangler CLI through npx."
}

if (-not (Test-Path -LiteralPath $WorkerRoot)) {
    throw "Refresh worker directory not found: $WorkerRoot"
}

Push-Location $WorkerRoot

try {
    Write-Host "Checking Cloudflare login..." -ForegroundColor Cyan
    & npx --yes wrangler@latest whoami
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Cloudflare login is required. A browser window will open." -ForegroundColor Yellow
        & npx --yes wrangler@latest login
        if ($LASTEXITCODE -ne 0) {
            throw "Cloudflare login failed."
        }
    }

    Write-Host ""
    Write-Host "Wrangler will now ask for GITHUB_TOKEN." -ForegroundColor Yellow
    Write-Host "Use a GitHub fine-grained personal access token restricted to" -ForegroundColor Yellow
    Write-Host "WilliamDormechele/nhrc-dashboard with Actions: Read and write." -ForegroundColor Yellow
    Write-Host "Do not paste the token into ChatGPT or save it in this repository." -ForegroundColor Yellow
    Write-Host ""

    & npx --yes wrangler@latest secret put GITHUB_TOKEN
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to store the GitHub token as a Cloudflare Worker secret."
    }

    Write-Host ""
    Write-Host "Deploying free refresh worker..." -ForegroundColor Cyan

    $deployLines = @(& npx --yes wrangler@latest deploy 2>&1)
    $deployLines | ForEach-Object { Write-Host $_ }

    if ($LASTEXITCODE -ne 0) {
        throw "Cloudflare Worker deployment failed."
    }

    $deployText = $deployLines -join [Environment]::NewLine
    $match = [regex]::Match(
        $deployText,
        'https://[A-Za-z0-9.-]+\.workers\.dev'
    )

    if (-not $match.Success) {
        Write-Host ""
        Write-Host "Worker deployed, but the workers.dev URL could not be detected automatically." -ForegroundColor Yellow
        Write-Host "Copy the HTTPS URL shown above and run:" -ForegroundColor Yellow
        Write-Host '.\scripts\configure-refresh-endpoint.ps1 -Url "https://YOUR-WORKER.workers.dev"'
        exit 0
    }

    $workerUrl = $match.Value.TrimEnd('/')

    Write-Host ""
    Write-Host "Configuring the dashboard to use:" -ForegroundColor Cyan
    Write-Host $workerUrl -ForegroundColor Green

    & $EndpointScript -Url $workerUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Worker deployed but dashboard endpoint configuration failed."
    }

    Write-Host ""
    Write-Host "Free manual refresh service is configured." -ForegroundColor Green
}
finally {
    Pop-Location
}
