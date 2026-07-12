param(
  [int]$DockerWaitSeconds = 180
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeDir = Join-Path $repoRoot "infra\local-services"
$envFile = Join-Path $composeDir ".env.local"
$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

if (-not (Test-Path -LiteralPath $envFile)) {
  $bytes = [byte[]]::new(48)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  [System.IO.File]::WriteAllText(
    $envFile,
    "SEARXNG_SECRET=$secret`n",
    [System.Text.UTF8Encoding]::new($false)
  )
}

if (-not (docker info 2>$null)) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop executable not found: $dockerDesktop"
  }
  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
}

$deadline = (Get-Date).AddSeconds($DockerWaitSeconds)
while ((Get-Date) -lt $deadline) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 5
}
if ($LASTEXITCODE -ne 0) {
  throw "Docker Engine did not become ready within $DockerWaitSeconds seconds"
}

docker compose --project-directory $composeDir --env-file $envFile up -d --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed"
}
