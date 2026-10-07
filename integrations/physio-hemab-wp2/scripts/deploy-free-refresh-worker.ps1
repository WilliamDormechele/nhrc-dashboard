param(
    [switch]$SkipSecret
)

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

function Invoke-WranglerCaptured {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Arguments
    )

    # Wrangler/npm writes informational notices to stderr. Running it through
    # cmd.exe merges stderr into stdout before PowerShell receives the stream,
    # avoiding NativeCommandError when $ErrorActionPreference is Stop.
    $command = "npx --yes wrangler@latest $Arguments 2>&1"
    $lines = @(& cmd.exe /d /s /c $command)
    $exitCode = $LASTEXITCODE

    return [pscustomobject]@{
        ExitCode = $exitCode
        Lines = $lines
        Text = ($lines -join [Environment]::NewLine)
    }
}

Push-Location $WorkerRoot

try {
    Write-Host "Checking Cloudflare login..." -ForegroundColor Cyan
    $whoami = Invoke-WranglerCaptured -Arguments "whoami"
    $whoami.Lines | ForEach-Object { Write-Host $_ }

    if (
        $whoami.ExitCode -ne 0 -or
        $whoami.Text -match "not authenticated"
    ) {
        Write-Host "Cloudflare login is required. A browser window will open." -ForegroundColor Yellow
        & npx --yes wrangler@latest login
        if ($LASTEXITCODE -ne 0) {
            throw "Cloudflare login failed."
        }
    }

    if (-not $SkipSecret) {
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
    }
    else {
        Write-Host ""
        Write-Host "Skipping GITHUB_TOKEN secret upload because -SkipSecret was supplied." -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "Deploying free refresh worker..." -ForegroundColor Cyan

    $deploy = Invoke-WranglerCaptured -Arguments "deploy"
    $deploy.Lines | ForEach-Object { Write-Host $_ }

    if ($deploy.ExitCode -ne 0) {
        throw "Cloudflare Worker deployment failed."
    }

    $match = [regex]::Match(
        $deploy.Text,
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
