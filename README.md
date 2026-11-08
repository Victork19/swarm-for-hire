# Swarm-for-Hire

Implementation scaffold for `SWARM-TDD-001`, a deterministic two-agent bounty demo on NEAR testnet.

## Do X → See Y

Open https://swarm-demo.pages.dev  
Connect wallet (or use demo mode)  
Click “Create Demo Bounty”  
   → See new bounty appear with 5 NEAR budget  
Click “Run Agents”  
   → See two agents join and submit (attestations appear)  
Click “Settle”  
   → See agent1 marked as winner and balance increased

## Run locally

Open `frontend/index.html` directly, or serve this directory with any static server. The default demo mode is deterministic and requires no wallet. Set `window.SWARM_CONFIG.mode = 'near'` before loading to wire the page to the deployed contract.

On Windows, run `powershell -ExecutionPolicy Bypass -File .\demo.ps1` for the full testnet demo. `demo.sh` is the equivalent Git Bash/WSL script.

## Contract

```sh
cd contract
cargo near build
```

On Windows, run `powershell -ExecutionPolicy Bypass -File .\build.ps1` from the project root. This produces `target/wasm32-unknown-unknown/release/swarm_bounty.wasm` directly with Rust’s WASM target. After the contract account exists and is funded, install/configure the NEAR CLI and run `deploy.ps1` to deploy and initialize `swarm-bounty.hackathon.testnet`.

The contract uses `swarm-bounty.hackathon.testnet` as its intended deployment account. `demo.sh` documents the exact testnet transaction path and validates the winner.

## Demo assumptions

The worker uses fixed output and a pre-generated-looking quote in demo mode. A production deployment must replace it with the NEAR AI Cloud attestation adapter and real key management.
# swarm-for-hire
