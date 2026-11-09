#!/usr/bin/env python3
import hashlib, json, os, sys

def main():
    request = json.load(sys.stdin)
    output = "NEAR Intents volume was healthy over the last 30 days, with routing activity concentrated in stablecoin swaps and cross-chain settlement."
    digest = "0x" + hashlib.sha256(output.encode()).hexdigest()
    demo_mode = os.environ.get("DEMO_MODE", "1") != "0"
    quote = "demo-tee-quote-v2-" + digest[2:18] if demo_mode else "REPLACE_WITH_NEAR_AI_CLOUD_QUOTE"
    print(json.dumps({"output_hash": digest, "attestation": quote, "score": 90 if request.get("agent_account", "").startswith("agent1") else 75, "output_preview": output, "demo_mode": demo_mode}))

if __name__ == "__main__": main()
