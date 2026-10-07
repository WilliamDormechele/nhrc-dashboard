param(
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

$TaskName = "NHRC Physio-HeMAB WP2 - 5 Minute Sync"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (-not $Task) {
    Write-Host "The legacy 5-minute Physio-HeMAB task is not installed." -ForegroundColor Yellow
    exit 0
}

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
catch {
}

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed legacy task: $TaskName" -ForegroundColor Green
    exit 0
}

Disable-ScheduledTask -TaskName $TaskName | Out-Null
$Updated = Get-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Legacy 5-minute Physio-HeMAB task disabled." -ForegroundColor Green
Write-Host "Task:  $($Updated.TaskName)"
Write-Host "State: $($Updated.State)"
Write-Host ""
Write-Host "The free cloud refresh workflow will replace this task once its GitHub/Cloudflare setup is completed."
