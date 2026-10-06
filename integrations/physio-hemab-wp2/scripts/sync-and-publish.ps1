$ErrorActionPreference = "Stop"

$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $IntegrationRoot "..\..")
$Python = Join-Path $IntegrationRoot ".venv\Scripts\python.exe"
$LogDir = Join-Path $RepoRoot "logs"
$LogFile = Join-Path $LogDir "physio-hemab-wp2-auto-sync.log"
$MutexName = "Local\NHRC_PhysioHeMAB_WP2_SyncPublish"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found at $Python"
}

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-AutoSyncLog {
    param([Parameter(Mandatory = $true)][string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $LogFile -Value "[$timestamp] $Message"
}

$mutex = New-Object System.Threading.Mutex($false, $MutexName)
$hasHandle = $false

try {
    try {
        $hasHandle = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $hasHandle = $true
    }

    if (-not $hasHandle) {
        Write-AutoSyncLog "Skipped: a previous sync-and-publish run is still active."
        exit 0
    }

    Set-Location $IntegrationRoot

    $env:PYTHONIOENCODING = "utf-8"
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

    Write-AutoSyncLog "Starting scheduled REDCap sync."

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI is not available on PATH."
    }

    $containerName = "physio-hemab-wp2-postgres"
    $containerExists = $false
    $containerRunning = $false

    & docker inspect $containerName *> $null
    if ($LASTEXITCODE -eq 0) {
        $containerExists = $true
        $runningText = (& docker inspect -f "{{.State.Running}}" $containerName 2>$null).Trim()
        $containerRunning = $runningText -eq "true"
    }

    if (-not $containerExists) {
        Write-AutoSyncLog "PostgreSQL container is missing; running database setup."
        & (Join-Path $IntegrationRoot "scripts\setup-db.ps1")
        if ($LASTEXITCODE -ne 0) {
            throw "PostgreSQL setup failed."
        }
    }
    elseif (-not $containerRunning) {
        Write-AutoSyncLog "PostgreSQL container is stopped; starting it."
        & docker start $containerName *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to start PostgreSQL container."
        }

        for ($i = 0; $i -lt 20; $i++) {
            & docker exec $containerName pg_isready -U physio_hemab -d physio_hemab_wp2 *> $null
            if ($LASTEXITCODE -eq 0) {
                break
            }
            Start-Sleep -Seconds 1
        }
    }

    Write-Host "Synchronizing REDCap..." -ForegroundColor Cyan
    & $Python ".\src\sync.py" all
    if ($LASTEXITCODE -ne 0) {
        throw "REDCap synchronization failed."
    }

    Write-Host "Publishing Firestore dashboard snapshot..." -ForegroundColor Cyan
    & $Python ".\src\publish_firestore.py"
    if ($LASTEXITCODE -ne 0) {
        throw "Firestore snapshot publishing failed."
    }

    Write-AutoSyncLog "Completed successfully."
    Write-Host "Physio-HeMAB WP2 dashboard snapshot updated." -ForegroundColor Green
}
catch {
    Write-AutoSyncLog ("FAILED: " + $_.Exception.Message)
    throw
}
finally {
    if ($hasHandle) {
        try {
            $mutex.ReleaseMutex()
        }
        catch {
        }
    }

    $mutex.Dispose()
}
