param(
  [Parameter(Mandatory=$true)][string]$BundleDir,
  [string]$ConfigFile = ""
)
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }

$root = Join-Path $env:ProgramData 'Kairoseth\LocalAgent'
$appRoot = Join-Path $root 'app'
$current = Join-Path $appRoot 'current'
if ([string]::IsNullOrWhiteSpace($ConfigFile)) { $ConfigFile = Join-Path $root 'config\agent.json' }
$taskName = 'Kairoseth Local Agent'

$manifestPath = Join-Path $BundleDir 'bundle-manifest.json'
if (-not (Test-Path $manifestPath)) { throw 'Bundle manifest missing' }
if (-not (Test-Path $ConfigFile)) { throw 'Installed config missing' }
if (-not (Test-Path $current)) { throw 'Current Local Agent release missing' }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid source commit' }

$previousRelease = (Get-Item -LiteralPath $current).Target
if ($previousRelease -is [array]) { $previousRelease = $previousRelease[0] }
$previousRelease = [IO.Path]::GetFullPath([string]$previousRelease)
$targetRelease = Join-Path (Join-Path $appRoot 'releases') "$($manifest.version)-$($manifest.sourceCommit)"

$config = Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json
$dataDir = [string]$config.dataDir
if (-not [IO.Path]::IsPathRooted($dataDir)) {
  $dataDir = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $ConfigFile) $dataDir))
}
$receiptDir = Join-Path $dataDir 'upgrades'
$receipt = Join-Path $receiptDir 'last-upgrade.json'

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$wasRunning = $false
if ($task -and $task.State -eq 'Running') {
  $wasRunning = $true
  Stop-ScheduledTask -TaskName $taskName
}

$activated = $false
try {
  $prepareOutput = & $node (Join-Path $BundleDir 'packages\local-agent\src\upgrade-cli.mjs') prepare --manifest $manifestPath --config $ConfigFile
  if ($LASTEXITCODE -ne 0) { throw 'Local Agent pre-upgrade guard failed' }
  $prepare = $prepareOutput | ConvertFrom-Json
  if ($prepare.status -ne 'ready') { throw 'Local Agent pre-upgrade guard did not return ready' }
  $backupPath = [string]$prepare.backup.backupPath

  if (-not (Test-Path $targetRelease)) {
    New-Item -ItemType Directory -Force $targetRelease | Out-Null
    Copy-Item -Recurse -Force (Join-Path $BundleDir '*') $targetRelease
    & $npm --prefix $targetRelease install --omit=dev --ignore-scripts --package-lock=false
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -Recurse -Force $targetRelease -ErrorAction SilentlyContinue
      throw 'npm install failed'
    }
  }

  if (Test-Path $current) {
    & cmd.exe /c rmdir "$current"
    if ($LASTEXITCODE -ne 0) { throw 'Could not replace current release junction' }
  }
  New-Item -ItemType Junction -Path $current -Target $targetRelease | Out-Null
  $activated = $true

  New-Item -ItemType Directory -Force $receiptDir | Out-Null
  [pscustomobject]@{
    schemaVersion = 1
    previousRelease = $previousRelease
    targetRelease = $targetRelease
    backupPath = $(if ([string]::IsNullOrWhiteSpace($backupPath)) { $null } else { $backupPath })
    sourceCommit = [string]$manifest.sourceCommit
    version = [string]$manifest.version
    rollbackPolicy = 'code-only'
    automaticDatabaseRollback = $false
    activatedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $receipt

  & icacls.exe $receiptDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not harden upgrade receipt directory ACL' }
  & icacls.exe $receipt /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not harden upgrade receipt ACL' }

  if ($wasRunning) { Start-ScheduledTask -TaskName $taskName }

  [pscustomobject]@{
    status = 'ok'
    platform = 'windows'
    previous_release = $previousRelease
    target_release = $targetRelease
    backup_path = $backupPath
    rollback_policy = 'code-only'
    database_rollback = $false
  } | ConvertTo-Json -Compress
}
catch {
  if ($activated -and (Test-Path $previousRelease)) {
    if (Test-Path $current) { & cmd.exe /c rmdir "$current" | Out-Null }
    New-Item -ItemType Junction -Path $current -Target $previousRelease -Force | Out-Null
  }
  if ($wasRunning) {
    Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  throw
}
