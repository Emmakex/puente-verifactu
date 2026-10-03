param(
  [Parameter(Mandatory=$true)][string]$BundleRoot
)
$ErrorActionPreference = 'Stop'

$installer = Join-Path $BundleRoot 'packages\local-agent\service\windows\install.ps1'
$uninstaller = Join-Path $BundleRoot 'packages\local-agent\service\windows\uninstall.ps1'
$runner = Join-Path $BundleRoot 'packages\local-agent\service\windows\run.ps1'
foreach ($script in @($installer, $uninstaller, $runner)) {
  if (-not (Test-Path $script)) { throw "Missing Windows service script: $script" }
  [void][scriptblock]::Create((Get-Content -Raw -LiteralPath $script))
}

$fixture = Join-Path $env:RUNNER_TEMP ('pv-local-agent-service-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $fixture | Out-Null
$configOne = Join-Path $fixture 'agent-one.json'
$configTwo = Join-Path $fixture 'agent-two.json'
$envSource = Join-Path $fixture 'agent.env'
Set-Content -NoNewline -Encoding UTF8 -LiteralPath $configOne -Value '{"schemaVersion":1,"marker":"first"}'
Set-Content -NoNewline -Encoding UTF8 -LiteralPath $configTwo -Value '{"schemaVersion":1,"marker":"second"}'
Set-Content -NoNewline -Encoding UTF8 -LiteralPath $envSource -Value 'PV_LOCAL_AGENT_API_KEY=service-smoke'

$root = Join-Path $env:ProgramData 'Kairoseth\LocalAgent'
$appRoot = Join-Path $root 'app'
$configRoot = Join-Path $root 'config'
$dataDir = Join-Path $root 'data'
$configFile = Join-Path $configRoot 'agent.json'
$envFile = Join-Path $configRoot 'agent.env'

function Assert-ProtectedAcl([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw "ACL inheritance is still enabled: $Path" }
  $sids = @($acl.Access | ForEach-Object {
    try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
    catch { $_.IdentityReference.Value }
  })
  if ($sids -notcontains 'S-1-5-18') { throw "SYSTEM ACL missing: $Path" }
  if ($sids -notcontains 'S-1-5-32-544') { throw "Administrators ACL missing: $Path" }
}

try {
  & $installer -BundleDir $BundleRoot -ConfigSource $configOne -EnvSource $envSource | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'First Windows install failed' }

  $current = Join-Path $appRoot 'current'
  if (-not (Test-Path $current)) { throw 'Current release junction missing' }
  if (-not (Test-Path $configFile)) { throw 'Installed config missing' }
  if (-not (Test-Path $envFile)) { throw 'Installed env file missing' }
  if (-not (Test-Path $dataDir)) { throw 'Data directory missing' }

  Set-Content -NoNewline -Encoding UTF8 -LiteralPath (Join-Path $dataDir 'state-marker') -Value 'state-survives'

  & $installer -BundleDir $BundleRoot -ConfigSource $configTwo -EnvSource $envSource | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Second Windows install failed' }

  $installedConfig = Get-Content -Raw -LiteralPath $configFile
  if ($installedConfig -notmatch '"marker":"first"') { throw 'Config was replaced during idempotent reinstall' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $dataDir 'state-marker')) -ne 'state-survives') { throw 'Data state did not survive reinstall' }

  Assert-ProtectedAcl $configRoot
  Assert-ProtectedAcl $dataDir
  Assert-ProtectedAcl $configFile
  Assert-ProtectedAcl $envFile

  & $uninstaller -RemoveCode | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows uninstall failed' }

  if (Test-Path $appRoot) { throw 'Code tree survived uninstall' }
  if (-not (Test-Path $configFile)) { throw 'Config was deleted by uninstall' }
  if (-not (Test-Path $envFile)) { throw 'Secret env file was deleted by uninstall' }
  if ((Get-Content -Raw -LiteralPath (Join-Path $dataDir 'state-marker')) -ne 'state-survives') { throw 'Data state was deleted by uninstall' }

  [pscustomobject]@{
    status = 'ok'
    check = 'local-agent-service-windows'
    install_idempotent = $true
    config_preserved = $true
    data_preserved = $true
    acl_hardened = $true
  } | ConvertTo-Json -Compress
}
finally {
  Unregister-ScheduledTask -TaskName 'Kairoseth Local Agent' -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $fixture -ErrorAction SilentlyContinue
}
