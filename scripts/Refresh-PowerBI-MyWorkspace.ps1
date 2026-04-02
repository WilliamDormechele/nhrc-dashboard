param(
    [string]$DatasetName = "BHDSS ROUND 10 DASHBOARD"
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

Write-Host "Looking for semantic model in My workspace..."
$datasetsJson = Invoke-PowerBIRestMethod -Url "datasets" -Method Get
$datasets = ($datasetsJson | ConvertFrom-Json).value
$dataset = $datasets | Where-Object { $_.name -eq $DatasetName } | Select-Object -First 1

if (-not $dataset) {
    throw "Semantic model '$DatasetName' was not found in My workspace."
}

Write-Host "Found semantic model:"
Write-Host "  Name: $($dataset.name)"
Write-Host "  ID:   $($dataset.id)"

$body = @{
    notifyOption = "NoNotification"
} | ConvertTo-Json

Write-Host "Submitting refresh request..."
$response = Invoke-PowerBIRestMethod `
    -Url "datasets/$($dataset.id)/refreshes" `
    -Method Post `
    -Body $body

Write-Host "Refresh request submitted."

Disconnect-PowerBIServiceAccount

# Return the dataset id so Stata / caller can reuse it if needed
Write-Output $dataset.id