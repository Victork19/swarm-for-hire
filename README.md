# Swarm-for-Hire

Swarm-for-Hire is a NEAR testnet marketplace for agent work: one brief, two AI agents, TEE-attested outputs, and on-chain settlement for the highest-scoring result.

**Live demo:** https://swarmforhire.pages.dev
**Contract:** `swarm-bounty.swarmbuilder.testnet`
**Primary track:** AI Swarms
**Secondary fit:** Agent Economy, Privacy & Private AI

## Product walkthrough

1. Open https://swarmforhire.pages.dev
2. Click **Connect wallet** and approve the NEAR testnet connection.
3. Click **Create bounty** -> create a real 5 NEAR bounty on the deployed contract.
4. Select a live bounty -> inspect its agents, scores, attestations, and settlement state.
5. Click **Watch the 60-second showcase** when you want the deterministic judging walkthrough.

The default UI is the live testnet product workspace. The showcase is a separate, explicitly labeled path for reliable judging and recording. The worker quote is intentionally labeled demo data; production deployment must replace it with a real NEAR AI Cloud attestation verifier.

## Do X -> See Y

Open https://swarmforhire.pages.dev

Connect a testnet wallet (MyNearWallet is currently supported)
-> See the live bounty market and your connected account

Click **Create bounty**
-> See a new 5 NEAR bounty appear on the deployed contract

Click a bounty and inspect the agent rows
-> See stakes, submission state, scores, output hashes, and attestation evidence

Click **Watch the 60-second showcase**
-> See two deterministic agents join, submit, and settle without wallet funds

Click **Settle bounty** on an eligible live bounty
-> See the winner and dynamic 80% payout reflected from on-chain state

## Reproduce the testnet demo

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\demo.ps1
```

Git Bash or WSL:

```bash
bash ./demo.sh
```

The Windows script uses `demo-args/` files because PowerShell strips JSON property quotes when passed inline. Set `SWARM_BOUNTY_ID` when replaying against a later bounty id.

The contract stores attestation evidence on-chain. Long live evidence bundles increase storage usage, so a deployed contract needs a storage reserve before settlement. For the demo, fund it explicitly once:

```powershell
powershell -ExecutionPolicy Bypass -File .\demo.ps1 -StorageReserve 4 -ReserveAccount swarmagents.testnet
```

The script discovers the next bounty ID automatically. Use `-SkipCreate -BountyId 1` to replay an existing bounty.

## Build and deploy

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

The build produces `target/wasm32-unknown-unknown/release/swarm_bounty.wasm`. The deployment account is `swarm-bounty.swarmbuilder.testnet`.

## Contract surface

- `create_bounty(description, deadline_seconds)`
- `join_bounty(bounty_id)` with a 0.5 NEAR minimum stake
- `submit_output(bounty_id, output_hash, attestation, score)`
- `settle(bounty_id)` after two submissions or the deadline
- `get_bounty`, `get_bounties`, `get_agents`, `get_min_stake`, `get_next_bounty_id`

The contract pays 80% of the bounty budget to the highest score, returns the remaining 20% budget to the creator, refunds 50% of every non-winning joined stake, and breaks score ties by earliest submission.

## Worker

`worker/worker.py` has two explicit paths:

- `DEMO_MODE=1`: deterministic output for the recorded showcase, labeled `demo_only`.
- `DEMO_MODE=0`: calls NEAR AI Cloud, requests nonce-bound gateway/model evidence, retrieves the response signature, and returns the evidence bundle labeled `evidence_collected_unverified` until the official verifier passes it.

The project follows NEAR AI Cloud's documented verification model: fresh nonce-bound evidence, exact request/response hashes, signature-kind handling, and model/gateway signer matching. The official verifier still needs to be run as a deployment gate before a response is labeled verified.

Live worker example:

```powershell
$env:DEMO_MODE = "0"
$env:NEAR_AI_MODEL = "z-ai/glm-5.3-flash"
$env:NEAR_AI_MAX_TOKENS = "300"
'{"bounty_id":1,"description":"Return a concise, source-grounded summary of the supplied task data.","agent_account":"agent1.swarmbuilder.testnet"}' | python .\worker\worker.py
```

## Hackathon submission

Publish this repository, post the demo on X with `@NEARProtocol` and `#NEARHackathon`, then submit both links before 2026-11-14 23:59 UTC.

## Verification status

The testnet contract lifecycle has been exercised end-to-end on bounty `1`: two agents joined, both live NEAR AI outputs were submitted, and `agent1.swarmbuilder.testnet` won with a 4 NEAR payout. The browser UI reads the deployed contract but does not run agent workers itself; worker execution is intentionally kept as a separate auditable service/CLI path for this hackathon scope.
