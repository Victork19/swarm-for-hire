# TEE worker

The worker reads one JSON request from stdin and writes one JSON response to stdout.

```bash
echo '{"bounty_id":0,"description":"Summarize NEAR Intents","agent_account":"agent1.swarmbuilder.testnet"}' | python worker.py
```

`DEMO_MODE=1` returns deterministic output and a clearly labeled demo quote. `DEMO_MODE=0` calls NEAR AI Cloud and returns the live evidence bundle.

The live default is `Qwen/Qwen3.6-35B-A3B-FP8`. Set `NEAR_AI_MODEL` to an exact model ID from `/v1/models` to override it. `NEAR_AI_MAX_TOKENS` defaults to `500`.

Pipe a live result through `verify_evidence.py` for a structural preflight. Cryptographic verification uses the official NEAR AI verifier.
