param(
    [string]$DatasetName = "BHDSS ROUND 10 DASHBOARD",
    [int]$PollSeconds = 20,
    [int]$MaxMinutes = 30
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt.Profile)) {
    Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser -Force -AllowClobber
}
if (-not (Get-Module -ListAvailable -Name MicrosoftPowerBIMgmt.Data)) {
    Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser -Force -AllowClobber
}

Import-Module MicrosoftPowerBIMgmt.Profile
Import-Module MicrosoftPowerBIMgmt.Data

Connect-PowerBIServiceAccount

$datasetsJson = Invoke-PowerBIRestMethod -Url "datasets" -Method Get
$datasets = ($datasetsJson | ConvertFrom-Json).value
$dataset = $datasets | Where-Object { $_.name -eq $DatasetName } | Select-Object -First 1

if (-not $dataset) {
    throw "Semantic model '$DatasetName' was not found in My workspace."
}

$datasetId = $dataset.id
Write-Host "Found semantic model: $($dataset.name)"
Write-Host "Dataset ID: $datasetId"

$body = @{ notifyOption = "NoNotification" } | ConvertTo-Json
Invoke-PowerBIRestMethod -Url "datasets/$datasetId/refreshes" -Method Post -Body $body | Out-Null

Write-Host "Refresh submitted. Polling status..."

$deadline = (Get-Date).AddMinutes($MaxMinutes)

while ((Get-Date) -lt $deadline) {
    $historyJson = Invoke-PowerBIRestMethod -Url "datasets/$datasetId/refreshes" -Method Get
    $history = ($historyJson | ConvertFrom-Json).value

    if (-not $history -or $history.Count -eq 0) {
        Write-Host "No refresh history yet. Waiting..."
        Start-Sleep -Seconds $PollSeconds
        continue
    }

    $latest = $history | Select-Object -First 1
    $refreshId = $latest.requestId
    $status = $latest.status

    Write-Host ("Latest status: {0}" -f $status)

    if ($refreshId) {
        try {
            $detailsJson = Invoke-PowerBIRestMethod -Url "datasets/$datasetId/refreshes/$refreshId" -Method Get
            $details = $detailsJson | ConvertFrom-Json

            if ($details.status) { $status = $details.status }
            if ($details.extendedStatus) { Write-Host ("Extended status: {0}" -f $details.extendedStatus) }

            if ($details.messages) {
                foreach ($msg in $details.messages) {
                    if ($msg.message) {
                        Write-Host ("Message: {0}" -f $msg.message)
                    }
                }
            }
        }
        catch {
            Write-Host "Execution details not available yet."
        }
    }

    if ($status -eq "Completed") {
        Write-Host "Refresh completed successfully."
        Disconnect-PowerBIServiceAccount
        exit 0
    }

    if ($status -eq "Failed") {
        Write-Host "Refresh failed."
        Disconnect-PowerBIServiceAccount
        exit 1
    }

    Start-Sleep -Seconds $PollSeconds
}

Write-Host "Timed out waiting for refresh."
Disconnect-PowerBIServiceAccount
exit 3