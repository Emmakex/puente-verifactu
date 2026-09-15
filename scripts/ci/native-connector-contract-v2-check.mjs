import { readFileSync, existsSync } from 'node:fs';

const paths = {
  fixture: 'packages/connector-contract-suite/fixtures/native-reconciliation-v2.json',
  wooRuntime: 'scripts/ci/woocommerce-native-reconciliation-v2.php',
  wooSmoke: 'scripts/ci/woocommerce-compatibility-smoke.sh',
  wooConnector: 'connectors/woocommerce/includes/class-pv-woo-connector.php',
  wooClient: 'connectors/woocommerce/includes/class-pv-woo-client.php',
  prestaRuntime: 'scripts/ci/prestashop-rectification-runtime.php',
  prestaSmoke: 'scripts/ci/prestashop-compatibility-smoke.sh',
  prestaAutomation: 'connectors/prestashop/classes/PVFPrestaShopAutomation.php',
  prestaClient: 'connectors/prestashop/classes/PVFPrestaShopClient.php',
  prestaException: 'connectors/prestashop/classes/PVFPrestaShopApiException.php',
};

const failures = [];
for (const path of Object.values(paths)) {
  if (!existsSync(path)) failures.push({ code: 'NATIVE_V2_REQUIRED_PATH_MISSING', path });
}

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const fixture = existsSync(paths.fixture) ? JSON.parse(read(paths.fixture)) : { scenarios: [] };
const scenarios = Array.isArray(fixture.scenarios) ? fixture.scenarios : [];
const wooRuntime = read(paths.wooRuntime);
const wooSmoke = read(paths.wooSmoke);
const wooConnector = read(paths.wooConnector);
const wooClient = read(paths.wooClient);
const prestaRuntime = read(paths.prestaRuntime);
const prestaSmoke = read(paths.prestaSmoke);
const prestaAutomation = read(paths.prestaAutomation);
const prestaClient = read(paths.prestaClient);
const prestaException = read(paths.prestaException);

if (fixture.schema_version !== 2 || fixture.contract !== 'native-reconciliation-v2' || scenarios.length !== 6) {
  failures.push({ code: 'NATIVE_V2_FIXTURE_INVALID' });
}

for (const scenario of scenarios) {
  if (!wooRuntime.includes(`'${scenario}'`)) {
    failures.push({ code: 'NATIVE_V2_WOO_SCENARIO_MISSING', scenario });
  }
  if (!prestaRuntime.includes(`'${scenario}'`)) {
    failures.push({ code: 'NATIVE_V2_PRESTA_SCENARIO_MISSING', scenario });
  }
}

const expectations = [
  [wooSmoke.includes('woocommerce-native-reconciliation-v2.php'), 'NATIVE_V2_WOO_REAL_MATRIX_NOT_WIRED'],
  [prestaSmoke.includes('prestashop-rectification-runtime.php'), 'NATIVE_V2_PRESTA_REAL_MATRIX_NOT_WIRED'],
  [wooConnector.includes('if ( $order->get_meta( self::META_RECORD_ID, true ) )') && wooConnector.includes('$this->reconcile_order( $order_id );') && wooConnector.includes('return;'), 'NATIVE_V2_WOO_INVOICE_RECONCILE_FIRST_MISSING'],
  [wooConnector.includes('if ( $refund->get_meta( self::META_RECORD_ID, true ) )') && wooConnector.includes('$this->reconcile_refund( $refund_id );'), 'NATIVE_V2_WOO_CORRECTIVE_RECONCILE_FIRST_MISSING'],
  [wooConnector.includes('private function reconcile_object( WC_Abstract_Order $order') && wooConnector.includes('private function record_error( WC_Abstract_Order $order') && wooConnector.includes('private function store_success( WC_Abstract_Order $order'), 'NATIVE_V2_WOO_SHARED_REFUND_CRUD_ABSTRACTION_MISSING'],
  [wooConnector.includes("'woo:%d:order:%d:issue:v1'") && wooConnector.includes("'woo:%d:refund:%d:issue:v1'"), 'NATIVE_V2_WOO_STABLE_IDEMPOTENCY_MISSING'],
  [wooClient.includes("array( 'cause' => $response->get_error_code(), 'retryable' => true )") && wooClient.includes("429 === $status || $status >= 500"), 'NATIVE_V2_WOO_RETRYABLE_CLASSIFICATION_MISSING'],
  [prestaClient.includes("require_once __DIR__ . '/PVFPrestaShopApiException.php';"), 'NATIVE_V2_PRESTA_TYPED_ERROR_NOT_LOADED'],
  [prestaClient.includes("'PVF_TRANSPORT_ERROR'") && prestaClient.includes('$status === 429 || $status >= 500'), 'NATIVE_V2_PRESTA_RETRYABLE_CLASSIFICATION_MISSING'],
  [prestaException.includes('final class PVFPrestaShopApiException') && prestaException.includes('public function isRetryable()'), 'NATIVE_V2_PRESTA_TYPED_ERROR_INVALID'],
  [prestaAutomation.includes("return $exception->isRetryable() ? 'retry_pending' : 'blocked';"), 'NATIVE_V2_PRESTA_RETRY_STATE_MISSING'],
  [prestaAutomation.includes("self::reconcileOrder($module, $order, $existing);\n                return;"), 'NATIVE_V2_PRESTA_INVOICE_RECONCILE_FIRST_MISSING'],
  [prestaAutomation.includes("self::reconcileSlip($module, $order, $slip, $existing);\n                return;"), 'NATIVE_V2_PRESTA_CORRECTIVE_RECONCILE_FIRST_MISSING'],
  [prestaAutomation.includes("(string) $existing['record_id']") && prestaAutomation.includes("(string) $existing['idempotency_key']"), 'NATIVE_V2_PRESTA_EXISTING_IDENTITY_NOT_PRESERVED'],
  [prestaRuntime.includes("'retry_pending'") && prestaRuntime.includes("'blocked'"), 'NATIVE_V2_PRESTA_RUNTIME_FAILURE_STATES_MISSING'],
  [wooRuntime.includes("'retryable-all'") && wooRuntime.includes("'issue-retryable'"), 'NATIVE_V2_WOO_RUNTIME_FAILURE_MODES_MISSING'],
];

for (const [ok, code] of expectations) {
  if (!ok) failures.push({ code });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 2,
    pipeline: 'GitHub Actions',
    job: 'validation',
    step: 'native-connector-contract-v2',
    exit_code: 1,
    primary_error: failures[0].code,
    failures,
    root_cause_status: 'confirmed',
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 2,
  status: 'ok',
  check: 'native-connector-contract-v2',
  connectors: ['woocommerce', 'prestashop'],
  scenarios,
  real_matrices: true,
}, null, 2));
