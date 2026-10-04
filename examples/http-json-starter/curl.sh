#!/usr/bin/env sh
set -eu

: "${PUENTE_BASE_URL:?PUENTE_BASE_URL is required}"
: "${PUENTE_TOKEN:?PUENTE_TOKEN is required}"

BASE_URL="${PUENTE_BASE_URL%/}"
COMMAND="${1:-}"

auth_header="Authorization: Bearer ${PUENTE_TOKEN}"

case "$COMMAND" in
  preflight)
    curl --fail-with-body --silent --show-error \
      -X POST "$BASE_URL/v1/preflight" \
      -H "$auth_header" \
      -H "Content-Type: application/json" \
      --data-binary "@${2:?JSON file is required}"
    ;;
  issue|rectify)
    curl --fail-with-body --silent --show-error \
      -X POST "$BASE_URL/v1/fiscal-records" \
      -H "$auth_header" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: ${3:?Idempotency key is required}" \
      --data-binary "@${2:?JSON file is required}"
    ;;
  status)
    curl --fail-with-body --silent --show-error \
      "$BASE_URL/v1/fiscal-records/${2:?recordId is required}/status" \
      -H "$auth_header"
    ;;
  cancel)
    RECORD_ID="${2:?recordId is required}"
    SOURCE_CANCELLATION_ID="${3:?sourceCancellationId is required}"
    IDEMPOTENCY_KEY="${4:?Idempotency key is required}"
    curl --fail-with-body --silent --show-error \
      -X POST "$BASE_URL/v1/fiscal-records/$RECORD_ID/cancel" \
      -H "$auth_header" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
      --data-binary "{\"sourceCancellationId\":\"$SOURCE_CANCELLATION_ID\"}"
    ;;
  *)
    echo "Usage: $0 preflight <json> | issue|rectify <json> <idempotency-key> | status <recordId> | cancel <recordId> <sourceCancellationId> <idempotency-key>" >&2
    exit 2
    ;;
esac
