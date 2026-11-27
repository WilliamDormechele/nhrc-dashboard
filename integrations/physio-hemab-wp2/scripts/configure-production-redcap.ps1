# Configure only the production REDCap credentials; no participant exports or writes.
$ErrorActionPreference = "Stop"
$Repo = "WilliamDormechele/nhrc-dashboard"
$Url = "https://redcap.uk-halle.de/api/"
$Workflow = "physio-hemab-wp2-refresh.yml"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is required. Install it and run gh auth login."
}
& gh auth status
if ($LASTEXITCODE -ne 0) { throw "Authenticate GitHub CLI first." }

function Read-VerifiedToken {
    param([string]$Title, [int]$ProjectId)
    $secret = Read-Host "Paste the PRODUCTION REDCap API token for $Title (PID $ProjectId)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
        if ([string]::IsNullOrWhiteSpace($token)) { throw "No token entered." }
        try {
            $result = Invoke-RestMethod -Uri $Url -Method Post -MaximumRedirection 0 -TimeoutSec 60 -Body @{
                token = $token
                content = "project"
                format = "json"
                returnFormat = "json"
            }
        } catch {
            throw "Unable to verify production API access for PID $ProjectId. Check that the token belongs to the production project and has API Export access."
        }
        $project = @($result)
        if ($project.Count -ne 1 -or [string]$project[0].project_id -ne [string]$ProjectId -or
            ([string]$project[0].project_title).Trim() -ne $Title) {
            throw "Wrong project token. Expected $Title, PID $ProjectId. No secrets have been changed."
        }
        if ($null -ne $project[0].in_production -and [string]$project[0].in_production -notin @("1", "True")) {
            throw "PID $ProjectId is not in production mode."
        }
        Write-Host "Verified $Title (PID $ProjectId)." -ForegroundColor Green
        return $token
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $secret.Dispose()
    }
}

function Set-Secret {
    param([string]$Name, [string]$Value)
    $Value | & gh secret set $Name --repo $Repo
    if ($LASTEXITCODE -ne 0) { throw "Could not set $Name. Do not start a refresh until both tokens are configured." }
    Write-Host "Configured $Name" -ForegroundColor Green
}

$main = $null
$devices = $null
try {
    # Validate both tokens before changing any GitHub secrets.
    $main = Read-VerifiedToken "HeMAB Ghana Main" 115
    $devices = Read-VerifiedToken "HeMAB Ghana Devices" 116
    Set-Secret "PHYSIO_HEMAB_MAIN_REDCAP_API_URL" $Url
    Set-Secret "PHYSIO_HEMAB_DEVICES_REDCAP_API_URL" $Url
    Set-Secret "PHYSIO_HEMAB_MAIN_REDCAP_API_TOKEN" $main
    Set-Secret "PHYSIO_HEMAB_DEVICES_REDCAP_API_TOKEN" $devices
} finally {
    $main = $null
    $devices = $null
}

$source = "production-cutover-" + [Guid]::NewGuid().ToString("N").Substring(0,12)
& gh workflow run $Workflow --repo $Repo --ref main -f "source=$source"
if ($LASTEXITCODE -ne 0) { throw "Could not start the production refresh." }

$run = $null
for ($i = 0; $i -lt 30 -and -not $run; $i++) {
    $json = & gh run list --repo $Repo --workflow $Workflow --branch main --event workflow_dispatch --limit 20 --json databaseId,displayTitle
    if ($LASTEXITCODE -ne 0) { throw "Could not locate the refresh workflow." }
    foreach ($candidate in (ConvertFrom-Json -InputObject ($json -join "`n"))) {
        if ([string]$candidate.displayTitle -like "*$source*") {
            $run = $candidate
            break
        }
    }
    if (-not $run) { Start-Sleep -Seconds 4 }
}
if (-not $run) { throw "Refresh was requested but its run ID could not be confirmed. Check the workflow in GitHub Actions before proceeding." }
Write-Host "Watching verified production refresh $($run.databaseId)..." -ForegroundColor Cyan
& gh run watch $run.databaseId --repo $Repo --exit-status
if ($LASTEXITCODE -ne 0) { throw "Production refresh failed. Existing snapshot retained. Inspect the run in GitHub Actions." }
Write-Host "Production refresh completed successfully." -ForegroundColor Green
