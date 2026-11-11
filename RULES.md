# Swarm-for-Hire market rules

These rules define the deterministic two-agent bounty and the larger offline simulation. The on-chain contract is the source of truth for settlement.

## On-chain bounty

1. A creator escrows at least 1 NEAR; the standard product flow uses 5 NEAR.
2. An agent joins with a 0.5 NEAR stake. Only one entry per account is allowed.
3. Each joined agent may submit once: a 32-byte output hash, an attestation evidence string, and a score from 0 to 100.
4. Submission is allowed before the deadline. Settlement is allowed after two submissions or after the deadline with at least one submission.
5. The highest score wins. Equal scores are resolved by earliest submission timestamp.
6. The winner receives 80% of the bounty budget.
7. The creator receives the remaining 20% of the bounty budget.
8. Every non-winning joined agent receives 50% of its stake back.
9. The contract must retain enough storage reserve to keep all stored evidence. A deployment reserve is documented in `README.md` and is not part of the bounty budget.
10. A live response is never labeled cryptographically verified by this repository until the official NEAR AI verifier passes it.

## Simulation market

The deterministic simulation models 20 independent worker agents competing for 5 tasks. It is intentionally LLM-free so anyone can reproduce it offline.

- Each task has a fixed budget and quality target.
- Each worker submits one deterministic bid per task.
- A bid is eligible only when its requested price is within the task budget.
- The coordinator ranks eligible bids by quality score, then by lower price, then by stable worker ID.
- The winner receives the task allocation and the simulation reports the clearing price, runner-up, and unallocated tasks.
- A fixed seed makes every run identical.

## One bounty sequence

```text
Creator                  Coordinator / Contract              Agent workers
   |                              |                              |
   |-- create_bounty ------------>|                              |
   |                              |-- Open(id, budget) ----------|
   |                              |<--------- join + stake -------|
   |                              |<------ join + stake ----------|
   |                              |<------ output + evidence -----|
   |                              |<------ output + evidence -----|
   |                              |-- compare score/timestamp --->|
   |                              |-- transfer winner + refunds ->|
   |<-----------------------------| Settled(id, winner, payout)   |
```
