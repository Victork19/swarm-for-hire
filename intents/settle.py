#!/usr/bin/env python3
"""Request a NEAR Intents 1Click route for a coordinator payout.

The safe default is a dry quote. A committed quote only creates a deposit
address; it does not claim that funds were delivered. The caller must fund the
address and poll the returned deposit address with ``status`` before treating
the route as settled. Native NEAR remains the reliable testnet payout path.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


ONE_CLICK_URL = os.environ.get("NEAR_INTENTS_API_URL", "https://1click.chaindefuser.com").rstrip("/")


def call(url, payload=None, headers=None, *, method="POST"):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", "Accept": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:1200]
        raise RuntimeError(f"NEAR Intents HTTP {error.code}: {detail}") from error


def api_headers():
    key = os.environ.get("NEAR_INTENTS_API_KEY")
    return {"X-API-Key": key} if key else {}


def quote(request):
    for field in ("amount", "destination"):
        if not request.get(field):
            raise RuntimeError(f"Missing settlement field: {field}")
    idempotency = request.get("idempotency_key")
    if not idempotency:
        raise RuntimeError("idempotency_key is required")
    destination_asset = request.get("destination_asset") or request.get("asset")
    if not destination_asset:
        raise RuntimeError("Missing settlement field: destination_asset")
    origin_asset = request.get("origin_asset") or os.environ.get("NEAR_INTENTS_ORIGIN_ASSET", "nep141:wrap.near")
    deadline = request.get("deadline")
    if not deadline:
        from datetime import datetime, timedelta, timezone
        deadline = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
    payload = {
        "dry": bool(request.get("dry", True)),
        "swapType": request.get("swap_type", "EXACT_INPUT"),
        "slippageTolerance": int(request.get("slippage_tolerance", 100)),
        "originAsset": origin_asset,
        "destinationAsset": destination_asset,
        "amount": str(request["amount"]),
        "depositType": request.get("deposit_type", "ORIGIN_CHAIN"),
        "refundTo": request.get("refund_to", request["destination"]),
        "refundType": request.get("refund_type", "ORIGIN_CHAIN"),
        "recipient": request["destination"],
        "recipientType": request.get("recipient_type", "DESTINATION_CHAIN"),
        "deadline": deadline,
    }
    result = call(f"{ONE_CLICK_URL}/v0/quote", payload, {**api_headers(), "Idempotency-Key": idempotency})
    return {
        "ok": True,
        "adapter": "near-intents-1click",
        "mode": "dry_quote" if payload["dry"] else "deposit_required",
        "requires_deposit": not payload["dry"],
        "result": result,
    }


def status(request):
    deposit_address = request.get("deposit_address")
    if not deposit_address:
        raise RuntimeError("deposit_address is required")
    query = urllib.parse.urlencode({"depositAddress": deposit_address})
    result = call(f"{ONE_CLICK_URL}/v0/status?{query}", headers=api_headers(), method="GET")
    return {"ok": True, "adapter": "near-intents-1click", "mode": "status", "result": result}


def settle(request):
    if request.get("action") == "status":
        return status(request)
    return quote(request)


def main():
    print(json.dumps(settle(json.load(sys.stdin))))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)
