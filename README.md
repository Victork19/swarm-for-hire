# Swarm-for-Hire

1. Open https://swarmforhire.pages.dev/swarm.html?live=1
2. See Round 1 cleared at 0.038 NEAR with 0.06 NEAR buyer savings
3. Confirm settlement transaction `FXPLtAdy49pF7FahgT31jTzEk813ohEErEYVbKSQhaHi` on [NEAR Explorer](https://testnet.nearblocks.io/txns/FXPLtAdy49pF7FahgT31jTzEk813ohEErEYVbKSQhaHi)

Swarm-for-Hire is a live NEAR testnet coordination market. Buyer subaccounts lock demand, worker subaccounts commit sealed bids, the coordinator clears eligible supply, and settlement moves value according to the market rule. The bounty workspace remains available for attested task execution.

**Landing page:** https://swarmforhire.pages.dev<br>
**Dashboard:** https://swarmforhire.pages.dev/dashboard.html<br>
**Contract:** `swarm-bounty.swarmbuilder.testnet`<br>

## Judge fast path: live market round

1. Open `https://swarmforhire.pages.dev/swarm.html?live=1`.
2. See the on-chain round, five worker bids, reveal state, winner, clearing price, allocations, and buyer savings.
3. Open the transaction logs linked from the README deployment section to verify the coordinator lifecycle.
4. Use the bounty workspace only for the secondary two-agent attested-work flow.

The live coordinator contract is `swarm-market.swarmbuilder.testnet`. Its seeded round uses 20 registered buyer accounts and five registered worker accounts. The contract supports buyer demand deposits, sealed bids, reveal, cheapest-first market clearing, allocation records, worker payment, and buyer refunds.

## Product flow

1. Open the public landing page, then enter the dashboard.
2. Select **Choose wallet** and connect a testnet-capable wallet such as Meteor, MyNearWallet, Nightly, or NEAR Mobile.
3. Create a bounty with the 5 NEAR button.
4. Inspect agent stakes, scores, output hashes, and attestation evidence.
5. Settle once two submissions are ready.

To inspect the coordination market without a wallet, open `https://swarmforhire.pages.dev/swarm.html?live=1`. The default `/swarm.html` remains the deterministic offline fallback.

## Do X -> See Y

Open https://swarmforhire.pages.dev<br>
-> See the public product overview

Open https://swarmforhire.pages.dev/dashboard.html<br>
Connect a testnet wallet<br>
-> See the live bounty dashboard and your connected account

Click **Create bounty**<br>
-> See a new 5 NEAR bounty on the deployed contract

Select a bounty from the dashboard<br>
-> Open a dedicated bounty workspace with stakes, submissions, scores, hashes, and attestation evidence

Open `/swarm.html?live=1`<br>
-> See a real on-chain market round with sealed worker bids, clearing price, allocations, payments, and buyer savings

Click **Settle bounty** on an eligible bounty<br>
-> See the winner and 80% payout reflected from on-chain state

## Repository layout

```text
contract/       Rust near-sdk contract
frontend/       Static product interface
worker/         NEAR AI Cloud worker and evidence tools
simulation/     Reproducible multi-agent market simulation
swarm-coordinator/ On-chain sealed-bid coordinator contract
demo-args/      JSON arguments for CLI calls
demo.ps1        Windows end-to-end script
demo.sh         Git Bash / WSL end-to-end script
live-demo.ps1   Live NEAR AI Cloud worker and settlement flow
```

## Run the testnet flow

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\demo.ps1
```

Git Bash or WSL:

```bash
bash ./demo.sh
```

The scripts create a bounty, join two agents, submit their results, and settle the winner. The contract may need a storage reserve before settlement when long evidence bundles are stored:

```powershell
powershell -ExecutionPolicy Bypass -File .\demo.ps1 -StorageReserve 4 -ReserveAccount swarmagents.testnet
```

## Contract

- `create_bounty(description, deadline_seconds)` — creates a funded task.
- `join_bounty(bounty_id)` — joins with the 0.5 NEAR minimum stake.
- `submit_output(bounty_id, output_hash, attestation, score)` — legacy compatibility path.
- `set_bounty_verifier(bounty_id, public_key)` + `submit_verified_output(...)` — verifies a signed scoring envelope on-chain with NEAR's native Ed25519 host function.
- `settle_verified(bounty_id)` — settles only submissions accepted through the verified path.
- `settle(bounty_id)` — pays the highest-scoring result after the settlement condition.
- `get_bounty`, `get_bounties`, `get_agents`, `get_min_stake`, `get_next_bounty_id` — read state.

The winner receives 80% of the bounty budget. The creator receives the remaining 20%. A non-winning agent receives 50% of its stake back. Ties resolve by earliest submission.

## Worker

The worker accepts one JSON request on stdin and returns one JSON result on stdout.

Demo output:

```powershell
'{"bounty_id":1,"description":"Summarize NEAR Intents","agent_account":"agent1.swarmbuilder.testnet"}' | python .\worker\worker.py
```

Live NEAR AI Cloud output:

```powershell
$env:DEMO_MODE = "0"
$env:NEAR_AI_API_KEY = "your-api-key"
$env:NEAR_AI_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8"
'{"bounty_id":1,"description":"Summarize NEAR Intents","agent_account":"agent1.swarmbuilder.testnet"}' | python .\worker\worker.py
```

The result contains an output hash, score, user-facing answer, and evidence bundle. Reasoning traces are excluded from the result. `verify_evidence.py` performs a structural evidence check; cryptographic verification uses the official [NEAR AI verification example](https://github.com/near-examples/nearai-cloud-verification-example).

To run the live worker flow against an existing open bounty:

```powershell
$env:NEAR_AI_API_KEY = "your-api-key"
powershell -ExecutionPolicy Bypass -File .\live-demo.ps1 -BountyId 3

If both agents have already joined, add `-SkipJoins` to resume from live worker execution.
```

## Reproducible simulation

```powershell
python .\simulation\simulate.py
```

The simulation models 20 buyer agents, five worker agents, five rounds, sealed bid commitments, reveal, ranking, allocation, and clearing prices with a fixed seed. It runs without a wallet or API key.

## On-chain swarm coordinator

`swarm-coordinator/` is an additive contract for the AI Swarms track. It does not replace the deployed bounty contract. The coordinator supports:

1. Owner registration of buyer and worker subaccounts.
2. Round creation with participant counts and a budget cap.
3. Worker commitment using `sha256(price|quality|salt)`.
4. Buyer demand deposits (`submit_demand`) with maximum price and quantity.
5. Owner-opened reveal, cheapest-first market clearing, allocation records, worker payments, and buyer refunds.
6. Read methods for rounds, bids, demands, allocations, participants, winner, and clearing price.

Build both contracts:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

`market-demo.ps1` runs the live economic path against the registered testnet subaccounts. The seeded round 1 used five buyers with a 0.05 NEAR maximum each and five worker bids from 0.03 to 0.038 NEAR. It cleared at 0.038 NEAR, allocated five units, paid all five workers, refunded buyer surplus, and produced 0.06 NEAR of aggregate buyer savings. The settlement transaction is `FXPLtAdy49pF7FahgT31jTzEk813ohEErEYVbKSQhaHi`.

The coordinator’s native NEAR path is the verified testnet fallback. The separate `/v1/intents/settle` backend adapter provides the NEAR Intents route when a funded Intents agent and supported route are configured.

### Verified bounty submissions

`worker/verify_evidence.py` remains a structural preflight. The official NEAR AI verifier must validate the TDX/GPU evidence and response signature first. A verifier service can then set `verification_status` to `cryptographically_verified` and sign the canonical envelope with its Ed25519 key using `worker/sign_verified_submission.py`. Configure that public key per bounty, call `submit_verified_output`, and use `settle_verified`; the contract rejects missing keys, malformed signatures, replayed submissions, and unsigned scores. The legacy method is retained only so existing testnet bounties remain readable.

### NEAR Intents adapter

`intents/settle.py` is an opt-in backend adapter for the NEAR Intents 1Click API. The Docker service exposes it at `POST /v1/intents/settle`. It requests a dry quote by default; a committed quote returns a deposit address and must be funded and polled before it is considered settled. It requires an API key and explicit idempotency key, never exposes credentials to the browser, and never replaces the reliable native NEAR testnet payout path.

### EC2 worker deployment

`docker-compose.ec2.yml` runs the private worker API behind Caddy. Point a DuckDNS record at the EC2 public IPv4 address, allow inbound TCP 80 and 443 in the EC2 security group, copy `.env.example` to `.env`, set a long random `SWARM_BACKEND_TOKEN`, and run:

```bash
docker compose -f docker-compose.ec2.yml up -d --build
curl https://your-name.duckdns.org/healthz
```

The worker endpoint is `POST /v1/worker` with `Authorization: Bearer $SWARM_BACKEND_TOKEN`. Keep the endpoint private or behind an additional access layer; do not put the bearer token in the browser.

Deploy the coordinator only after creating or selecting its separate testnet account:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-coordinator.ps1 -Account swarm-market.swarmbuilder.testnet
```

The live coordinator frontend is opt-in and reads `swarm-market.swarmbuilder.testnet` at `https://swarmforhire.pages.dev/swarm.html?live=1`. The default `/swarm.html` remains the deterministic no-wallet fallback until the coordinator has been deployed and populated.

## Build and deploy

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

The WASM artifact is written to `target/wasm32-unknown-unknown/release/swarm_bounty.wasm`.

## Current deployment

The deployed testnet lifecycle has been exercised on bounty `1`: two agents joined, both live NEAR AI results were submitted, and `agent1.swarmbuilder.testnet` won with a 4 NEAR payout.
