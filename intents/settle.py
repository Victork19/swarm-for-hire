#!/usr/bin/env python3
"""Submit a coordinator payout through the NEAR Intents Agent API.

This adapter is intentionally opt-in. It never falls back to a native transfer
and it requires an API key, grant token, agent id, destination and idempotency
key. The bounty contract remains the source of truth for the selected winner;
this process settles the external asset route and returns its correlation id.
"""

import json
import os
import sys
import urllib.error
import urllib.request


def call(url, payload, headers):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:1200]
        raise RuntimeError(f"NEAR Intents HTTP {error.code}: {detail}") from error


def main():
    request = json.load(sys.stdin)
    required = {
        "NEAR_INTENTS_AGENT_API_URL": os.environ.get("NEAR_INTENTS_AGENT_API_URL"),
        "NEAR_INTENTS_API_KEY": os.environ.get("NEAR_INTENTS_API_KEY"),
        "NEAR_INTENTS_GRANT_TOKEN": os.environ.get("NEAR_INTENTS_GRANT_TOKEN"),
        "NEAR_INTENTS_AGENT_ID": os.environ.get("NEAR_INTENTS_AGENT_ID"),
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError("Missing required NEAR Intents configuration: " + ", ".join(missing))
    for field in ("amount", "destination", "chain", "asset"):
        if not request.get(field):
            raise RuntimeError(f"Missing settlement field: {field}")
    idempotency = request.get("idempotency_key")
    if not idempotency:
        raise RuntimeError("idempotency_key is required")

    base = required["NEAR_INTENTS_AGENT_API_URL"].rstrip("/")
    endpoint = f"{base}/v1/agents/{required['NEAR_INTENTS_AGENT_ID']}/withdraw"
    headers = {
        "X-API-Key": required["NEAR_INTENTS_API_KEY"],
        "X-Grant-Token": required["NEAR_INTENTS_GRANT_TOKEN"],
        "Idempotency-Key": idempotency,
    }
    payload = {
        "asset": request["asset"],
        "amount": str(request["amount"]),
        "destination": request["destination"],
        "chain": request["chain"],
        "dry": bool(request.get("dry", False)),
    }
    result = call(endpoint, payload, headers)
    print(json.dumps({"ok": True, "adapter": "near-intents-agent-api", "result": result}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)
