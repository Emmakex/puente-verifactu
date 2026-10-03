param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$AppCurrent,
  [Parameter(Mandatory=$true)][string]$ConfigFile,
  [Parameter(Mandatory=$true)][string]$EnvFile
)
$ErrorActionPreference = 'Stop'
foreach ($line in Get-Content -LiteralPath $EnvFile) {
  $trimmed = $line.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
  if ($trimmed -notmatch '^([A-Z_][A-Z0-9_]*)=(.*)$') { throw 'Invalid environment entry' }
  [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
}
& $NodePath (Join-Path $AppCurrent 'bin\kairoseth-local-agent.mjs') start --config $ConfigFile
exit $LASTEXITCODE
