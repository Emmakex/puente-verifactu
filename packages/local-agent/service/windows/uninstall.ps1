param([switch]$RemoveCode)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator' }
$root = Join-Path $env:ProgramData 'Kairoseth\LocalAgent'
Unregister-ScheduledTask -TaskName 'Kairoseth Local Agent' -Confirm:$false -ErrorAction SilentlyContinue
if ($RemoveCode) {
  Remove-Item -Recurse -Force (Join-Path $root 'app') -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $root 'run.ps1') -ErrorAction SilentlyContinue
}
[pscustomobject]@{
  status='ok'
  platform='windows'
  preserved=@((Join-Path $root 'config'), (Join-Path $root 'data'))
} | ConvertTo-Json -Compress
