param(
  [Parameter(Mandatory=$true)][string]$BundleRoot
)
$ErrorActionPreference = 'Stop'

$installer = Join-Path $BundleRoot 'packages\local-agent\service\windows\install.ps1'
$uninstaller = Join-Path $BundleRoot 'packages\local-agent\service\windows\uninstall.ps1'
$fixture = Join-Path $env:RUNNER_TEMP ('pv-local-agent-upgrade-' + [guid]::NewGuid().ToString('N'))
$target = Join-Path $fixture 'target'
$configSource = Join-Path $fixture 'agent.json'
$envSource = Join-Path $fixture 'agent.env'
$root = Join-Path $env:ProgramData 'Kairoseth\LocalAgent'
$appRoot = Join-Path $root 'app'
$current = Join-Path $appRoot 'current'
$dataDir = Join-Path $root 'data'
$db = Join-Path $dataDir 'agent.sqlite'
$configFile = Join-Path $root 'config\agent.json'
$syntheticCommit = '3333333333333333333333333333333333333333'

New-Item -ItemType Directory -Force $fixture | Out-Null
$config = [ordered]@{
  schemaVersion = 1
  installationId = 'upgrade-windows'
  dataDir = $dataDir
  bridge = [ordered]@{
    baseUrl = 'https://bridge.example'
    apiKeyEnv = 'PV_LOCAL_AGENT_API_KEY'
  }
  source = [ordered]@{
    kind = 'watch-folder'
    sourceId = 'upgrade-watch'
    profileId = 'upgrade-profile'
    root = (Join-Path $dataDir 'files')
    issueEnabled = $false
  }
}
$config | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $configSource
Set-Content -Encoding UTF8 -LiteralPath $envSource -Value 'PV_LOCAL_AGENT_API_KEY=upgrade-smoke'

try {
  & $installer -BundleDir $BundleRoot -ConfigSource $configSource -EnvSource $envSource | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Base install failed' }

  $previous = (Get-Item -LiteralPath $current).Target
  if ($previous -is [array]) { $previous = $previous[0] }
  $previous = [IO.Path]::GetFullPath([string]$previous)

  node scripts/ci/local-agent-upgrade-state-fixture.mjs create --db $db --key before | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create pre-upgrade SQLite fixture' }

  New-Item -ItemType Directory -Force $target | Out-Null
  Copy-Item -Recurse -Force -Path (Join-Path $BundleRoot '*') -Destination $target
  $targetManifest = Join-Path $target 'bundle-manifest.json'
  $manifest = Get-Content -Raw -LiteralPath $targetManifest | ConvertFrom-Json
  $manifest.sourceCommit = $syntheticCommit
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $targetManifest

  $upgrade = Join-Path $target 'packages\local-agent\service\windows\upgrade.ps1'
  $rollback = Join-Path $target 'packages\local-agent\service\windows\rollback.ps1'
  [void][scriptblock]::Create((Get-Content -Raw -LiteralPath $upgrade))
  [void][scriptblock]::Create((Get-Content -Raw -LiteralPath $rollback))

  & $upgrade -BundleDir $target -ConfigFile $configFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows upgrade failed' }

  $active = (Get-Item -LiteralPath $current).Target
  if ($active -is [array]) { $active = $active[0] }
  $active = [IO.Path]::GetFullPath([string]$active)
  if ($active -eq $previous) { throw 'Upgrade did not switch current release' }
  if ($active -notmatch $syntheticCommit) { throw 'Target release does not contain synthetic commit' }

  $receipt = Join-Path (Join-Path $dataDir 'upgrades') 'last-upgrade.json'
  if (-not (Test-Path $receipt)) { throw 'Upgrade receipt missing' }
  $receiptInfo = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
  $backup = [string]$receiptInfo.backupPath
  if ([string]::IsNullOrWhiteSpace($backup) -or -not (Test-Path $backup)) { throw 'Verified SQLite backup missing' }

  $backupState = (node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db $backup | ConvertFrom-Json)
  if ($backupState.count -ne 1 -or -not $backupState.quickCheck) { throw 'Pre-upgrade backup state mismatch' }

  node scripts/ci/local-agent-upgrade-state-fixture.mjs create --db $db --key after | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not mutate post-upgrade SQLite fixture' }
  $currentState = (node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db $db | ConvertFrom-Json)
  if ($currentState.count -ne 2) { throw 'Post-upgrade state mutation missing' }

  & $rollback -ConfigFile $configFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows code rollback failed' }

  $rolledBack = (Get-Item -LiteralPath $current).Target
  if ($rolledBack -is [array]) { $rolledBack = $rolledBack[0] }
  $rolledBack = [IO.Path]::GetFullPath([string]$rolledBack)
  if ($rolledBack -ne $previous) { throw 'Windows rollback did not restore previous code pointer' }

  $afterRollback = (node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db $db | ConvertFrom-Json)
  if ($afterRollback.count -ne 2) { throw 'SQLite was rolled back with code, which is forbidden' }
  $backupAfter = (node scripts/ci/local-agent-upgrade-state-fixture.mjs inspect --db $backup | ConvertFrom-Json)
  if ($backupAfter.count -ne 1) { throw 'Pre-upgrade backup was modified' }

  $receiptAfter = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
  if ($receiptAfter.databaseRestored -ne $false) { throw 'Rollback receipt must state databaseRestored=false' }

  [pscustomobject]@{
    status = 'ok'
    check = 'local-agent-upgrade-windows'
    backup_verified = $true
    code_rollback = $true
    database_rollback = $false
    state_after_rollback = 2
  } | ConvertTo-Json -Compress
}
finally {
  & $uninstaller -RemoveCode 2>$null | Out-Null
  Unregister-ScheduledTask -TaskName 'Kairoseth Local Agent' -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $fixture -ErrorAction SilentlyContinue
}
