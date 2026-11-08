#!/usr/bin/env python3
import hashlib, json, sys

def main():
    request = json.load(sys.stdin)
    output = "NEAR Intents volume was healthy over the last 30 days, with routing activity concentrated in stablecoin swaps and cross-chain settlement."
    digest = "0x" + hashlib.sha256(output.encode()).hexdigest()
    print(json.dumps({"output_hash": digest, "attestation": "demo-tee-quote-v2-" + digest[2:18], "score": 90 if request.get("agent_account", "").startswith("agent1") else 75, "output_preview": output}))

if __name__ == "__main__": main()
