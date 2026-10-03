param(
  [Parameter(Mandatory=$true)][string]$BundleDir,
  [Parameter(Mandatory=$true)][string]$ConfigSource,
  [Parameter(Mandatory=$true)][string]$EnvSource,
  [switch]$Register,
  [switch]$Start,
  [switch]$ReplaceConfig
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }

$root = Join-Path $env:ProgramData 'Kairoseth\LocalAgent'
$appRoot = Join-Path $root 'app'
$configRoot = Join-Path $root 'config'
$dataDir = Join-Path $root 'data'
$runner = Join-Path $root 'run.ps1'
$configFile = Join-Path $configRoot 'agent.json'
$envFile = Join-Path $configRoot 'agent.env'
$taskName = 'Kairoseth Local Agent'
$manifestPath = Join-Path $BundleDir 'bundle-manifest.json'
if (-not (Test-Path $manifestPath) -or -not (Test-Path $ConfigSource) -or -not (Test-Path $EnvSource)) { throw 'Bundle/config/env source missing' }

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid source commit' }
$release = Join-Path (Join-Path $appRoot 'releases') "$($manifest.version)-$($manifest.sourceCommit)"
$current = Join-Path $appRoot 'current'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Force (Join-Path $appRoot 'releases'), $configRoot, $dataDir | Out-Null
if (-not (Test-Path $release)) {
  New-Item -ItemType Directory -Force $release | Out-Null
  Copy-Item -Recurse -Force (Join-Path $BundleDir '*') $release
  & $npm --prefix $release install --omit=dev --ignore-scripts --package-lock=false
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -Recurse -Force $release -ErrorAction SilentlyContinue
    throw 'npm install failed'
  }
}
if (Test-Path $current) {
  & cmd.exe /c rmdir "$current"
  if ($LASTEXITCODE -ne 0) { throw 'Could not replace current release junction' }
}
New-Item -ItemType Junction -Path $current -Target $release | Out-Null

if ($ReplaceConfig -or -not (Test-Path $configFile)) { Copy-Item -Force $ConfigSource $configFile }
Copy-Item -Force $EnvSource $envFile
Copy-Item -Force (Join-Path $current 'packages\local-agent\service\windows\run.ps1') $runner

foreach ($path in @($configRoot, $dataDir)) {
  & icacls.exe $path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not harden ACL: $path" }
}
foreach ($path in @($configFile, $envFile, $runner)) {
  & icacls.exe $path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not harden file ACL: $path" }
}

if ($Register -or $Start) {
  $ps = (Get-Command powershell.exe -ErrorAction Stop).Source
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -NodePath `"$node`" -AppCurrent `"$current`" -ConfigFile `"$configFile`" -EnvFile `"$envFile`""
  $action = New-ScheduledTaskAction -Execute $ps -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principalTask -Settings $settings -Force | Out-Null
  if ($Start) { Start-ScheduledTask -TaskName $taskName }
}

[pscustomobject]@{
  status = 'ok'
  platform = 'windows'
  release = "$($manifest.version)-$($manifest.sourceCommit)"
  task_registered = [bool]($Register -or $Start)
  config_preserved = $true
  data_preserved = $true
} | ConvertTo-Json -Compress
