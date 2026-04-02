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

Write-Host "Signing in to Power BI..."
Connect-PowerBIServiceAccount

Write-Host "Finding semantic model in My workspace..."
$datasetsJson = Invoke-PowerBIRestMethod -Url "datasets" -Method Get
$datasets = ($datasetsJson | ConvertFrom-Json).value
$dataset = $datasets | Where-Object { $_.name -eq $DatasetName } | Select-Object -First 1

if (-not $dataset) {
    throw "Semantic model '$DatasetName' was not found in My workspace."
}

$datasetId = $dataset.id
Write-Host "Dataset ID: $datasetId"

$deadline = (Get-Date).AddMinutes($MaxMinutes)

while ((Get-Date) -lt $deadline) {
    $historyJson = Invoke-PowerBIRestMethod -Url "datasets/$datasetId/refreshes" -Method Get
    $history = ($historyJson | ConvertFrom-Json).value

    if (-not $history -or $history.Count -eq 0) {
        Write-Host "No refresh history returned yet. Waiting $PollSeconds seconds..."
        Start-Sleep -Seconds $PollSeconds
        continue
    }

    $latest = $history | Select-Object -First 1
    $refreshId = $latest.requestId
    $status = $latest.status

    Write-Host ("Latest refresh status: {0}" -f $status)

    if ($refreshId) {
        try {
            $detailsJson = Invoke-PowerBIRestMethod -Url "datasets/$datasetId/refreshes/$refreshId" -Method Get
            $details = $detailsJson | ConvertFrom-Json

            if ($details.status) {
                Write-Host ("Execution details status: {0}" -f $details.status)
                $status = $details.status
            }

            if ($details.extendedStatus) {
                Write-Host ("Extended status: {0}" -f $details.extendedStatus)
            }

            if ($details.messages) {
                foreach ($msg in $details.messages) {
                    if ($msg.message) {
                        Write-Host ("Message: {0}" -f $msg.message)
                    }
                }
            }
        }
        catch {
            Write-Host "Could not get execution details yet. Using refresh history status only."
        }
    }

    switch -Regex ($status) {
        "Completed" {
            Write-Host "Refresh completed successfully."
            Disconnect-PowerBIServiceAccount
            exit 0
        }
        "Failed" {
            Write-Host "Refresh failed."
            Disconnect-PowerBIServiceAccount
            exit 1
        }
        "Disabled" {
            Write-Host "Refresh is disabled."
            Disconnect-PowerBIServiceAccount
            exit 2
        }
        default {
            Write-Host "Refresh still in progress. Waiting $PollSeconds seconds..."
            Start-Sleep -Seconds $PollSeconds
        }
    }
}

Write-Host "Timed out waiting for refresh to finish."
Disconnect-PowerBIServiceAccount
exit 3