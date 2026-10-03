param(
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

if (-not (Test-Path $ConfigFile)) { throw 'Installed config missing' }
$config = Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json
$dataDir = [string]$config.dataDir
if (-not [IO.Path]::IsPathRooted($dataDir)) {
  $dataDir = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $ConfigFile) $dataDir))
}
$receipt = Join-Path (Join-Path $dataDir 'upgrades') 'last-upgrade.json'
if (-not (Test-Path $receipt)) { throw 'No Local Agent upgrade receipt found' }

$info = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
$previousRelease = [IO.Path]::GetFullPath([string]$info.previousRelease)
$targetRelease = [IO.Path]::GetFullPath([string]$info.targetRelease)
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $appRoot 'releases')) + [IO.Path]::DirectorySeparatorChar
if (-not $previousRelease.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe previous release path'
}
if (-not (Test-Path $previousRelease)) { throw 'Previous code release is unavailable' }

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$wasRunning = $false
if ($task -and $task.State -eq 'Running') {
  $wasRunning = $true
  Stop-ScheduledTask -TaskName $taskName
}

if (Test-Path $current) {
  & cmd.exe /c rmdir "$current"
  if ($LASTEXITCODE -ne 0) { throw 'Could not replace current release junction' }
}
New-Item -ItemType Junction -Path $current -Target $previousRelease | Out-Null
if ($wasRunning) { Start-ScheduledTask -TaskName $taskName }

$info | Add-Member -NotePropertyName rolledBackAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
$info | Add-Member -NotePropertyName rolledBackCodeTo -NotePropertyValue $previousRelease -Force
$info | Add-Member -NotePropertyName databaseRestored -NotePropertyValue $false -Force
$info | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $receipt

[pscustomobject]@{
  status = 'ok'
  platform = 'windows'
  rolled_back_from = $targetRelease
  rolled_back_to = $previousRelease
  database_restored = $false
} | ConvertTo-Json -Compress
