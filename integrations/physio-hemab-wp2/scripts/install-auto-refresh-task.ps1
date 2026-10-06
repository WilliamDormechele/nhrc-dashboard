$ErrorActionPreference = "Stop"

$TaskName = "NHRC Physio-HeMAB WP2 - 5 Minute Sync"
$IntegrationRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$SyncScript = Join-Path $IntegrationRoot "scripts\sync-and-publish.ps1"

if (-not (Test-Path -LiteralPath $SyncScript)) {
    throw "Sync-and-publish script not found: $SyncScript"
}

if (-not (Get-Module -ListAvailable -Name ScheduledTasks)) {
    throw "The Windows ScheduledTasks PowerShell module is unavailable."
}

$PowerShellExe = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path -LiteralPath $PowerShellExe)) {
    $PowerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
}

$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$StartAt = (Get-Date).AddMinutes(1)
$PowerShellArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $SyncScript + '"'

$Action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $PowerShellArguments
$Trigger = New-ScheduledTaskTrigger -Once -At $StartAt -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited

$RegisterArgs = @{
    TaskName = $TaskName
    Action = $Action
    Trigger = $Trigger
    Settings = $Settings
    Principal = $Principal
    Description = "Refresh Physio-HeMAB WP2 from REDCap and publish the Firestore dashboard snapshot every 5 minutes."
    Force = $true
}

Register-ScheduledTask @RegisterArgs | Out-Null

$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host ""
Write-Host "Physio-HeMAB WP2 automatic refresh task installed." -ForegroundColor Green
Write-Host "Task:      $($Task.TaskName)"
Write-Host "Interval:  Every 5 minutes"
Write-Host "User:      $CurrentUser"
Write-Host "Next run:  $($Info.NextRunTime)"
Write-Host ""
Write-Host "The task runs while this Windows user is signed in, including when the PC is locked."
Write-Host "The sync runner prevents overlapping executions automatically."
