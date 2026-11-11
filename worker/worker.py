#!/usr/bin/env python3
"""Swarm worker for deterministic and NEAR AI Cloud-backed agent results."""

import hashlib
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request
import urllib.error


# Override with an exact catalog model ID through NEAR_AI_MODEL when needed.
MODEL = os.environ.get("NEAR_AI_MODEL", "Qwen/Qwen3.6-35B-A3B-FP8")
MAX_TOKENS = int(os.environ.get("NEAR_AI_MAX_TOKENS", "500"))
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
    # NEAR AI Cloud documents the attestation preflight as keyless. Keeping
    # the API key out of this request avoids validating it before the actual
    # model call and preserves the preflight's intended security boundary.
    evidence, _ = request_json(f"{GATEWAY}/v1/attestation/report?{query}", headers={"Accept": "application/json", "x-no-aliasing": "true"})
    prompt = request.get("description", "Complete the assigned bounty.")
    system_prompt = (
        "You are a bounty worker. Write only the answer that should be delivered to the user. "
        "Use 2 to 4 concise sentences, with no numbered steps or preamble. "
        "Be factual and clearly label uncertainty. If the prompt lacks source data, say that exact "
        "metrics cannot be verified instead of inventing them."
    )
    request_body = json.dumps({"model": MODEL, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}], "max_tokens": MAX_TOKENS, "stream": False}, separators=(",", ":")).encode()
    response, response_headers = request_json(f"{GATEWAY}/v1/chat/completions", method="POST", headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {api_key}", "x-no-aliasing": "true", "Accept-Encoding": "identity"}, body=request_body)
    try:
        message = response["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError(f"NEAR AI response did not contain choices[0].message: {json.dumps(response)[:1200]}") from error

    # Only publish the user-facing answer. Reasoning traces are never hashed,
    # stored, or sent to the contract. Some reasoning models place the final
    # answer in reasoning_content, so extract only its final answer section.
    output = message.get("content")
    if not isinstance(output, str) or not output.strip():
        reasoning = message.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning.strip():
            markers = ("final answer:", "answer:", "final:")
            lowered = reasoning.lower()
            marker_positions = [(lowered.rfind(marker), marker) for marker in markers if lowered.rfind(marker) >= 0]
            if marker_positions:
                position, marker = max(marker_positions, key=lambda item: item[0])
                output = reasoning[position + len(marker):].strip()
            else:
                paragraphs = [part.strip() for part in reasoning.split("\n\n") if part.strip()]
                output = paragraphs[-1] if paragraphs else ""
    if not isinstance(output, str) or not output.strip():
        raise RuntimeError("NEAR AI response did not contain a user-facing answer")
    output = output.replace("<think>", "").replace("</think>", "").strip()
    if output.lower().startswith(("thinking process:", "chain of thought:", "reasoning:")):
        raise RuntimeError("NEAR AI returned reasoning text instead of a user-facing answer")
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
