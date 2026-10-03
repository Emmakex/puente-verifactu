import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(path, 'utf8');
}

const linuxUnit = source('packages/local-agent/service/linux/kairoseth-local-agent.service.template');
const linuxInstall = source('packages/local-agent/service/linux/install.sh');
const linuxUninstall = source('packages/local-agent/service/linux/uninstall.sh');
const macRunner = source('packages/local-agent/service/macos/run.sh.template');
const macPlist = source('packages/local-agent/service/macos/com.kairoseth.local-agent.plist.template');
const macInstall = source('packages/local-agent/service/macos/install.sh');
const macUninstall = source('packages/local-agent/service/macos/uninstall.sh');
const winRunner = source('packages/local-agent/service/windows/run.ps1');
const winInstall = source('packages/local-agent/service/windows/install.ps1');
const winUninstall = source('packages/local-agent/service/windows/uninstall.ps1');
const envExample = source('config/local-agent.env.example');

const failures = [];
function expect(condition, code) {
  if (!condition) failures.push(code);
}

function forbidsSensitiveMaterial(value, prefix) {
  expect(!/\\.pfx\\b|\\.p12\\b|privateKeyPem|aeatCertificate|AEAT_CERTIFICATE/i.test(value), prefix + '_AEAT_SECRET_FORBIDDEN');
}

expect(linuxUnit.includes('NoNewPrivileges=true'), 'LINUX_NO_NEW_PRIVILEGES_REQUIRED');
expect(linuxUnit.includes('ProtectSystem=strict'), 'LINUX_PROTECT_SYSTEM_REQUIRED');
expect(linuxUnit.includes('ProtectHome=true'), 'LINUX_PROTECT_HOME_REQUIRED');
expect(linuxUnit.includes('ReadWritePaths=__DATA_DIR__'), 'LINUX_DATA_ONLY_WRITE_PATH_REQUIRED');
expect(linuxUnit.includes('ExecStart=__NODE_BIN__ __APP_CURRENT__/bin/kairoseth-local-agent.mjs start --config __CONFIG_FILE__'), 'LINUX_AGENT_START_COMMAND_REQUIRED');
expect(linuxInstall.includes('APP_ROOT="/opt/kairoseth/local-agent"'), 'LINUX_APP_ROOT_REQUIRED');
expect(linuxInstall.includes('CONFIG_ROOT="/etc/kairoseth-local-agent"'), 'LINUX_CONFIG_ROOT_REQUIRED');
expect(linuxInstall.includes('DATA_DIR="/var/lib/kairoseth-local-agent"'), 'LINUX_DATA_ROOT_REQUIRED');
expect(linuxInstall.includes('if [[ ! -f "$CONFIG_FILE" || $REPLACE_CONFIG -eq 1 ]]'), 'LINUX_CONFIG_PRESERVATION_REQUIRED');
expect(linuxInstall.includes('ln -sfn "$RELEASE_DIR" "$CURRENT"'), 'LINUX_CURRENT_LINK_REQUIRED');
expect(!linuxUninstall.includes('rm -rf /etc/kairoseth-local-agent'), 'LINUX_UNINSTALL_CONFIG_DELETE_FORBIDDEN');
expect(!linuxUninstall.includes('rm -rf /var/lib/kairoseth-local-agent'), 'LINUX_UNINSTALL_DATA_DELETE_FORBIDDEN');

expect(macPlist.includes('<key>UserName</key><string>__SERVICE_USER__</string>'), 'MACOS_NON_ROOT_USER_REQUIRED');
expect(macPlist.includes('<key>RunAtLoad</key><true/>'), 'MACOS_RUN_AT_LOAD_REQUIRED');
expect(macPlist.includes('<key>KeepAlive</key><true/>'), 'MACOS_KEEP_ALIVE_REQUIRED');
expect(macInstall.includes('STATE_ROOT="/Library/Application Support/Kairoseth/LocalAgent"'), 'MACOS_STATE_ROOT_REQUIRED');
expect(macInstall.includes('SERVICE_USER=') && macInstall.includes('SUDO_USER'), 'MACOS_SERVICE_USER_REQUIRED');
expect(macInstall.includes('if [[ ! -f "$CONFIG_FILE" || $REPLACE_CONFIG -eq 1 ]]'), 'MACOS_CONFIG_PRESERVATION_REQUIRED');
expect(macInstall.includes('ln -sfn "$RELEASE_DIR" "$CURRENT"'), 'MACOS_CURRENT_LINK_REQUIRED');
expect(macRunner.includes('export "$key=$value"'), 'MACOS_ENV_EXPORT_REQUIRED');
expect(!/\\bsource\\s+["']?\\$ENV_FILE|\\beval\\b/.test(macRunner), 'MACOS_ENV_EVAL_FORBIDDEN');
expect(!macUninstall.includes('rm -rf "/Library/Application Support/Kairoseth/LocalAgent"'), 'MACOS_UNINSTALL_STATE_DELETE_FORBIDDEN');

expect(winInstall.includes("Join-Path $env:ProgramData 'Kairoseth\\\\LocalAgent'"), 'WINDOWS_PROGRAMDATA_ROOT_REQUIRED');
expect(winInstall.includes('Register-ScheduledTask -TaskName $taskName'), 'WINDOWS_NATIVE_TASK_REQUIRED');
expect(winInstall.includes('New-ScheduledTaskTrigger -AtStartup'), 'WINDOWS_STARTUP_TRIGGER_REQUIRED');
expect(winInstall.includes("New-ScheduledTaskPrincipal -UserId 'SYSTEM'"), 'WINDOWS_SYSTEM_PRINCIPAL_REQUIRED');
expect(winInstall.includes("*S-1-5-18:(OI)(CI)F"), 'WINDOWS_SYSTEM_DIRECTORY_ACL_REQUIRED');
expect(winInstall.includes("*S-1-5-32-544:(OI)(CI)F"), 'WINDOWS_ADMIN_DIRECTORY_ACL_REQUIRED');
expect(winInstall.includes("*S-1-5-18:F"), 'WINDOWS_SYSTEM_FILE_ACL_REQUIRED');
expect(winInstall.includes("*S-1-5-32-544:F"), 'WINDOWS_ADMIN_FILE_ACL_REQUIRED');
expect(winInstall.includes('cmd.exe /c rmdir "$current"'), 'WINDOWS_SAFE_JUNCTION_REPLACE_REQUIRED');
expect(winInstall.includes('if ($ReplaceConfig -or -not (Test-Path $configFile))'), 'WINDOWS_CONFIG_PRESERVATION_REQUIRED');
expect(!/nssm|winsw|node-windows/i.test(winInstall + winRunner), 'WINDOWS_THIRD_PARTY_SERVICE_WRAPPER_FORBIDDEN');
expect(!/Remove-Item[^\\n]*(?:config|data)/i.test(winUninstall), 'WINDOWS_UNINSTALL_STATE_DELETE_FORBIDDEN');
expect(winRunner.includes("[Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')"), 'WINDOWS_ENV_PROCESS_SCOPE_REQUIRED');

expect(envExample.includes('PV_LOCAL_AGENT_API_KEY=replace-me'), 'LOCAL_AGENT_ENV_API_KEY_EXAMPLE_REQUIRED');
expect(!/PFX|P12|AEAT_CERT|PRIVATE_KEY/i.test(envExample), 'LOCAL_AGENT_ENV_FISCAL_SECRET_FORBIDDEN');

forbidsSensitiveMaterial(linuxUnit + linuxInstall + linuxUninstall, 'LINUX');
forbidsSensitiveMaterial(macRunner + macPlist + macInstall + macUninstall, 'MACOS');
forbidsSensitiveMaterial(winRunner + winInstall + winUninstall, 'WINDOWS');

for (const item of [
  ['LINUX', linuxInstall + linuxUninstall],
  ['MACOS', macInstall + macUninstall],
  ['WINDOWS', winInstall + winUninstall],
]) {
  expect(!/curl\\s+.*\\|\\s*(?:sh|bash|powershell)|Invoke-Expression|iex\\s/i.test(item[1]), item[0] + '_REMOTE_EXECUTION_FORBIDDEN');
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'blocked',
    check: 'local-agent-service-install-contract',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'local-agent-service-install-contract',
  linux_systemd: true,
  macos_launchd: true,
  windows_task_scheduler: true,
  state_preserving_uninstall: true,
  windows_acl_hardened: true,
  third_party_service_wrapper: false,
}, null, 2));
