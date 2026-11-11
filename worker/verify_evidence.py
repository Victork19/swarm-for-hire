#!/usr/bin/env python3
"""Structural evidence preflight.

This is deliberately not presented as cryptographic verification. It catches
malformed or incomplete evidence before submission. Full
TEE verification remains the official NEAR AI verifier's responsibility.
"""

import json
import re
import sys


def inspect(result):
    checks = {}
    checks["live_result"] = result.get("demo_mode") is False
    checks["output_hash"] = bool(re.fullmatch(r"0x[0-9a-f]{64}", result.get("output_hash", "")))
    checks["preview"] = isinstance(result.get("output_preview"), str) and bool(result["output_preview"].strip())
    try:
        evidence = json.loads(result.get("attestation", ""))
    except (TypeError, json.JSONDecodeError):
        evidence = {}
    checks["nonce"] = bool(re.fullmatch(r"[0-9a-f]{64}", evidence.get("nonce", "")))
    checks["model"] = bool(evidence.get("model"))
    checks["gateway_attestation"] = bool(evidence.get("gateway_attestation"))
    checks["response_signature"] = bool(evidence.get("response_signature"))
    signature = evidence.get("response_signature") or {}
    checks["signature_fields"] = all(signature.get(field) for field in ("signature", "text", "signing_address", "signing_algo"))
    return {"checks": checks, "structurally_valid": all(checks.values()), "cryptographically_verified": False}


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    report = inspect(payload)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["structurally_valid"] else 1)
