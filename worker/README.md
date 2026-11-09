# TEE worker

The worker reads one JSON request from stdin and writes one JSON response to stdout.

```bash
echo '{"bounty_id":0,"description":"Summarize NEAR Intents","agent_account":"agent1.swarmbuilder.testnet"}' | python worker.py
```

`DEMO_MODE=1` returns deterministic output and a clearly labeled demo quote. Set `DEMO_MODE=0` only after wiring the NEAR AI Cloud quote provider; the placeholder quote is intentionally not presented as a valid attestation.
