#!/usr/bin/env python3
"""Swarm worker.

DEMO_MODE=1 is a deterministic judging path. DEMO_MODE=0 calls NEAR AI Cloud
and returns the raw gateway/model evidence for a separate verification gate.
The worker never labels an unverified response as verified.
"""

import hashlib
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import urllib.error


MODEL = os.environ.get("NEAR_AI_MODEL", "zai-org/GLM-5.1-FP8")
GATEWAY = "https://cloud-api.near.ai"


def request_json(url, *, method="GET", headers=None, body=None):
    request = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode()), dict(response.headers)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:1000]
        raise RuntimeError(f"NEAR AI Cloud HTTP {error.code} at {url.split('?')[0]}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"NEAR AI Cloud network error at {url.split('?')[0]}: {error.reason}") from error


def demo_result(request):
    output = "NEAR Intents volume was healthy over the last 30 days, with routing activity concentrated in stablecoin swaps and cross-chain settlement."
    digest = "0x" + hashlib.sha256(output.encode()).hexdigest()
    account = request.get("agent_account", "")
    return {"output_hash": digest, "attestation": "demo-tee-quote-v2-" + digest[2:18], "score": 90 if account.startswith("agent1") else 75, "output_preview": output, "demo_mode": True, "verification_status": "demo_only"}


def live_result(request):
    api_key = os.environ.get("NEAR_AI_API_KEY")
    if not api_key:
        raise RuntimeError("NEAR_AI_API_KEY is required when DEMO_MODE=0")

    nonce = secrets.token_hex(32)
    query = urllib.parse.urlencode({"signing_algo": "ecdsa", "nonce": nonce, "model": MODEL, "provider": "near"})
    evidence, _ = request_json(f"{GATEWAY}/v1/attestation/report?{query}", headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}", "x-no-aliasing": "true"})
    prompt = request.get("description", "Complete the assigned bounty.")
    request_body = json.dumps({"model": MODEL, "messages": [{"role": "user", "content": prompt}], "stream": False}, separators=(",", ":")).encode()
    response, response_headers = request_json(f"{GATEWAY}/v1/chat/completions", method="POST", headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {api_key}", "x-no-aliasing": "true", "Accept-Encoding": "identity"}, body=request_body)
    output = response["choices"][0]["message"]["content"]
    response_id = response.get("id")
    signature = None
    if response_id:
        signature, _ = request_json(f"{GATEWAY}/v1/signature/{urllib.parse.quote(response_id)}?signing_algo=ecdsa", headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"})
    digest = "0x" + hashlib.sha256(output.encode()).hexdigest()
    evidence_bundle = {"nonce": nonce, "model": MODEL, "gateway_attestation": evidence.get("gateway_attestation"), "model_attestations": evidence.get("model_attestations", []), "response_signature": signature, "request_hash": hashlib.sha256(request_body).hexdigest(), "response_id": response_id, "request_id": response_headers.get("X-Request-Id")}
    return {"output_hash": digest, "attestation": json.dumps(evidence_bundle, separators=(",", ":")), "score": int(os.environ.get("DEFAULT_SCORE", "85")), "output_preview": output[:500], "demo_mode": False, "verification_status": "evidence_collected_unverified"}


def main():
    request = json.load(sys.stdin)
    result = demo_result(request) if os.environ.get("DEMO_MODE", "1") != "0" else live_result(request)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "demo_mode": False}), file=sys.stderr)
        sys.exit(1)
