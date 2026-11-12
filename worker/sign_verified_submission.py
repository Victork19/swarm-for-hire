#!/usr/bin/env python3
"""Sign a verified scoring envelope for submit_verified_output.

The caller must provide a report produced by the official NEAR AI verifier
with cryptographically_verified=true. This script refuses unverified input.
The private key is supplied only through the environment and is never stored
in the repository.
"""

import argparse
import base64
import hashlib
import json
import os
import sys

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except ImportError as error:
    raise SystemExit("Install the verifier dependency with: python -m pip install cryptography") from error


def canonical(result):
    bounty_id = int(result["bounty_id"])
    account = result["agent_account"]
    output_hash = result["output_hash"].removeprefix("0x")
    attestation_hash = hashlib.sha256(result["attestation"].encode()).hexdigest()
    score = int(result["score"])
    return f"swarm-for-hire/v1|{bounty_id}|{account}|{output_hash}|{attestation_hash}|{score}".encode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("result_file")
    args = parser.parse_args()
    result = json.load(open(args.result_file, encoding="utf-8"))
    if result.get("verification_status") != "cryptographically_verified":
        raise RuntimeError("Refusing to sign evidence that is not cryptographically_verified")
    private_key = os.environ.get("SWARM_VERIFIER_PRIVATE_KEY_B64")
    if not private_key:
        raise RuntimeError("SWARM_VERIFIER_PRIVATE_KEY_B64 is required")
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(private_key))
    result["verifier_signature"] = list(key.sign(canonical(result)))
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
