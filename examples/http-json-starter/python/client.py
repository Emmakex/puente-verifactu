#!/usr/bin/env python3
import json
import os
import sys
from urllib import error, parse, request


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE_URL = required_env("PUENTE_BASE_URL").rstrip("/")
TOKEN = required_env("PUENTE_TOKEN")


def api(path, method="GET", body=None, idempotency_key=None):
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {TOKEN}",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    req = request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        payload = json.loads(raw) if raw else {}
        detail = payload.get("error", {})
        raise RuntimeError(
            f"{detail.get('code', 'HTTP_ERROR')}: {detail.get('message', 'HTTP ' + str(exc.code))}"
        ) from None


def preflight(payload):
    return api("/v1/preflight", method="POST", body=payload)


def issue(payload, idempotency_key):
    return api(
        "/v1/fiscal-records",
        method="POST",
        body=payload,
        idempotency_key=idempotency_key,
    )


def status(record_id):
    return api(f"/v1/fiscal-records/{parse.quote(record_id, safe='')}/status")


def cancel(record_id, source_cancellation_id, idempotency_key):
    return api(
        f"/v1/fiscal-records/{parse.quote(record_id, safe='')}/cancel",
        method="POST",
        body={"sourceCancellationId": source_cancellation_id},
        idempotency_key=idempotency_key,
    )


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main(argv):
    if not argv:
        raise RuntimeError(
            "Usage: preflight <json> | issue|rectify <json> <idempotency-key> | "
            "status <recordId> | cancel <recordId> <sourceCancellationId> <idempotency-key>"
        )
    command = argv[0]
    if command == "preflight":
        result = preflight(load_json(argv[1]))
    elif command in ("issue", "rectify"):
        result = issue(load_json(argv[1]), argv[2])
    elif command == "status":
        result = status(argv[1])
    elif command == "cancel":
        result = cancel(argv[1], argv[2], argv[3])
    else:
        raise RuntimeError("Unsupported command")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
