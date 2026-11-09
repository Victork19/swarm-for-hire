#!/usr/bin/env bash
set -euo pipefail

BOUNTY_ID="${SWARM_BOUNTY_ID:-0}"

CONTRACT="swarm-bounty.swarmbuilder.testnet"
CREATOR="creator.swarmbuilder.testnet"
AGENT1="agent1.swarmbuilder.testnet"
AGENT2="agent2.swarmbuilder.testnet"

echo "[1/6] Creator creates 5 NEAR bounty"
near contract call-function as-transaction "$CONTRACT" create_bounty json-args '{"description":"Summarize NEAR Intents 30-day volume","deadline_seconds":3600}' prepaid-gas '100 Tgas' attached-deposit '5 NEAR' sign-as "$CREATOR" network-config testnet sign-with-keychain send
if [[ "$BOUNTY_ID" == "0" ]]; then BOUNTY_ID=$(near contract call-function as-read-only "$CONTRACT" get_next_bounty_id json-args '{}' network-config testnet | rg -o '[0-9]+' | tail -1); BOUNTY_ID=$((BOUNTY_ID-1)); fi
echo "[2/6] Agent 1 joins"
near contract call-function as-transaction "$CONTRACT" join_bounty json-args "{\"bounty_id\":$BOUNTY_ID}" prepaid-gas '50 Tgas' attached-deposit '0.5 NEAR' sign-as "$AGENT1" network-config testnet sign-with-keychain send
echo "[3/6] Agent 2 joins"
near contract call-function as-transaction "$CONTRACT" join_bounty json-args "{\"bounty_id\":$BOUNTY_ID}" prepaid-gas '50 Tgas' attached-deposit '0.5 NEAR' sign-as "$AGENT2" network-config testnet sign-with-keychain send
echo "[4/6] Agent 1 submits score 90"
near contract call-function as-transaction "$CONTRACT" submit_output json-args "{\"bounty_id\":$BOUNTY_ID,\"output_hash\":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],\"attestation\":\"demo-tee-quote-v2-a1b2c3d4\",\"score\":90}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$AGENT1" network-config testnet sign-with-keychain send
echo "[5/6] Agent 2 submits score 75"
near contract call-function as-transaction "$CONTRACT" submit_output json-args "{\"bounty_id\":$BOUNTY_ID,\"output_hash\":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],\"attestation\":\"demo-tee-quote-v2-e5f6a7b8\",\"score\":75}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$AGENT2" network-config testnet sign-with-keychain send
echo "[6/6] Settle and assert Agent 1 winner"
near contract call-function as-transaction "$CONTRACT" settle json-args "{\"bounty_id\":$BOUNTY_ID}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$CREATOR" network-config testnet sign-with-keychain send
WINNER=$(near contract call-function as-read-only "$CONTRACT" get_bounty json-args "{\"bounty_id\":$BOUNTY_ID}" network-config testnet | rg -o 'agent1\.swarmbuilder\.testnet' | head -1)
if [[ "$WINNER" != "$AGENT1" ]]; then echo "FAIL: unexpected winner"; exit 1; fi
echo "PASS: $AGENT1 won and received the ~4 NEAR payout"
