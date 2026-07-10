param(
  [ValidateSet("check", "summary")]
  [string] $Action = "check",
  [string] $ResourceGroup = "alive",
  [string] $ContainerAppName = "hhc-line-function-bot"
)

$ErrorActionPreference = "Stop"

$legacyProfileEnvNames = @(
  "BOT_PROFILES_JSON",
  "BOT_PROFILES_BASE64_JSON",
  "PROFILE_CONFIG_VERSION"
)
$legacyProfileSecretName = "bot-profiles-base64-json"

function Invoke-AzJson {
  param([Parameter(Mandatory = $true)][string[]] $Arguments)

  $output = & az @Arguments -o json
  if ($LASTEXITCODE -ne 0) {
    throw "az command failed: az $($Arguments -join ' ')"
  }
  return $output | ConvertFrom-Json
}

function Get-ProfileConfigInventory {
  $app = Invoke-AzJson -Arguments @(
    "containerapp", "show",
    "--resource-group", $ResourceGroup,
    "--name", $ContainerAppName
  )
  $envItems = @($app.properties.template.containers[0].env)
  $profileConfigPath = ($envItems | Where-Object { $_.name -eq "PROFILE_CONFIG_PATH" } | Select-Object -First 1).value
  $legacyEnvNames = @(
    $envItems |
      Where-Object { $_.name -in $legacyProfileEnvNames } |
      ForEach-Object { $_.name }
  )
  $secretNames = @(
    Invoke-AzJson -Arguments @(
      "containerapp", "secret", "list",
      "--resource-group", $ResourceGroup,
      "--name", $ContainerAppName
    ) | ForEach-Object { $_.name }
  )

  [pscustomobject]@{
    profileConfigPath = $profileConfigPath
    legacyProfileEnvNames = $legacyEnvNames
    legacyProfileSecretPresent = $secretNames -contains $legacyProfileSecretName
    latestRevision = $app.properties.latestRevisionName
    latestReadyRevision = $app.properties.latestReadyRevisionName
    runningStatus = $app.properties.runningStatus
    image = $app.properties.template.containers[0].image
  }
}

$inventory = Get-ProfileConfigInventory

if ($Action -eq "summary") {
  $inventory | ConvertTo-Json -Depth 4
  return
}

$errors = New-Object System.Collections.Generic.List[string]
if ($inventory.profileConfigPath -ne "/app/config/profiles.json") {
  $errors.Add("PROFILE_CONFIG_PATH must be /app/config/profiles.json.")
}
if ($inventory.legacyProfileEnvNames.Count -gt 0) {
  $errors.Add("Legacy profile env vars are still present: $($inventory.legacyProfileEnvNames -join ', ').")
}
if ($inventory.legacyProfileSecretPresent) {
  $errors.Add("Legacy profile secret '$legacyProfileSecretName' is still present.")
}
if ($inventory.latestRevision -ne $inventory.latestReadyRevision -or $inventory.runningStatus -ne "Running") {
  $errors.Add("Latest revision is not ready and running.")
}
if ($errors.Count -gt 0) {
  throw ($errors -join "`n")
}

Write-Output "OK: production profiles are file-backed and no legacy profile configuration remains."
