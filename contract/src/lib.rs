use near_sdk::{env, near, AccountId, BorshStorageKey, NearSchema, PanicOnDefault, Promise};
use near_sdk::collections::UnorderedMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{borsh::{BorshDeserialize, BorshSerialize}, CryptoHash};

const YOCTO_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MIN_STAKE: u128 = 500_000_000_000_000_000_000_000;
const VERIFIER_PREFIX: &[u8] = b"swarm-for-hire/verifier/";
const VERIFIED_PREFIX: &[u8] = b"swarm-for-hire/verified/";
const MIN_VERIFIED_SCORE: u32 = 70;

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey { Bounties, Agents { id: u64 } }

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum BountyStatus { Open, Settled }

#[derive(BorshDeserialize, BorshSerialize)]
pub struct AgentEntry {
    pub stake: u128,
    pub joined_at: u64,
    pub output_hash: Option<CryptoHash>,
    pub attestation: Option<String>,
    pub submitted_at: Option<u64>,
    pub score: Option<u32>,
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Bounty {
    pub id: u64,
    pub creator: AccountId,
    pub budget: u128,
    pub description: String,
    pub created_at: u64,
    pub deadline: u64,
    pub status: BountyStatus,
    pub agents: UnorderedMap<AccountId, AgentEntry>,
    pub winner: Option<AccountId>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BountyView {
    pub id: u64, pub creator: AccountId, pub budget: U128, pub description: String,
    pub created_at: u64, pub deadline: u64, pub status: BountyStatus, pub winner: Option<AccountId>, pub agent_count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AgentView {
    pub account: AccountId, pub stake: U128, pub joined_at: u64, pub output_hash: Option<CryptoHash>,
    pub attestation: Option<String>, pub submitted_at: Option<u64>, pub score: Option<u32>, pub verified: bool,
}

#[near(contract_state)]
#[derive(NearSchema, PanicOnDefault)]
pub struct Contract {
    pub bounties: UnorderedMap<u64, Bounty>,
    pub next_bounty_id: u64,
    pub min_stake: u128,
    pub protocol_fee_bps: u16,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self { Self { bounties: UnorderedMap::new(StorageKey::Bounties), next_bounty_id: 0, min_stake: MIN_STAKE, protocol_fee_bps: 0 } }

    #[payable]
    pub fn create_bounty(&mut self, description: String, deadline_seconds: u64) -> u64 {
        assert!(description.chars().count() <= 500, "Description too long");
        let budget = env::attached_deposit().as_yoctonear();
        assert!(budget >= YOCTO_NEAR, "Insufficient budget");
        let id = self.next_bounty_id;
        self.next_bounty_id += 1;
        let bounty = Bounty { id, creator: env::predecessor_account_id(), budget, description, created_at: env::block_timestamp(), deadline: env::block_timestamp() + deadline_seconds * 1_000_000_000, status: BountyStatus::Open, agents: UnorderedMap::new(StorageKey::Agents { id }), winner: None };
        self.bounties.insert(&id, &bounty);
        env::log_str(&format!("BountyCreated {{id:{}, creator:{}, budget:{}}}", id, env::predecessor_account_id(), budget));
        id
    }

    #[payable]
    pub fn join_bounty(&mut self, bounty_id: u64) {
        let mut bounty = self.bounties.get(&bounty_id).unwrap_or_else(|| env::panic_str("Bounty not found"));
        assert_eq!(bounty.status, BountyStatus::Open, "Bounty not open");
        let account = env::predecessor_account_id();
        assert!(bounty.agents.get(&account).is_none(), "Already joined");
        let stake = env::attached_deposit().as_yoctonear();
        assert!(stake >= self.min_stake, "Insufficient stake");
        bounty.agents.insert(&account, &AgentEntry { stake: self.min_stake, joined_at: env::block_timestamp(), output_hash: None, attestation: None, submitted_at: None, score: None });
        self.bounties.insert(&bounty_id, &bounty);
        let excess = stake - self.min_stake;
        if excess > 0 { let _ = Promise::new(account).transfer(near_sdk::NearToken::from_yoctonear(excess)); }
    }

    pub fn submit_output(&mut self, bounty_id: u64, output_hash: CryptoHash, attestation: String, score: u32) {
        let mut bounty = self.bounties.get(&bounty_id).unwrap_or_else(|| env::panic_str("Bounty not found"));
        assert_eq!(bounty.status, BountyStatus::Open, "Bounty not open");
        let account = env::predecessor_account_id();
        let mut agent = bounty.agents.get(&account).unwrap_or_else(|| env::panic_str("Not joined"));
        assert!(agent.output_hash.is_none(), "Already submitted");
        assert!(!attestation.is_empty(), "Missing attestation");
        assert!(score <= 100, "Invalid score");
        agent.output_hash = Some(output_hash); agent.attestation = Some(attestation); agent.submitted_at = Some(env::block_timestamp()); agent.score = Some(score);
        bounty.agents.insert(&account, &agent);
        let submissions = bounty.agents.iter().filter(|(_, a)| a.output_hash.is_some()).count();
        assert!(env::block_timestamp() <= bounty.deadline || submissions >= 2, "Deadline passed");
        self.bounties.insert(&bounty_id, &bounty);
    }

    /// Set the Ed25519 public key used by the external NEAR AI verifier for
    /// this bounty. The verifier must first validate the TDX/GPU evidence and
    /// response signature off-chain, then sign the canonical envelope below.
    /// The key is stored in raw storage so this is additive and does not alter
    /// the Borsh layout of deployed bounty state.
    pub fn set_bounty_verifier(&mut self, bounty_id: u64, public_key: [u8; 32]) {
        let bounty = self.bounties.get(&bounty_id).unwrap_or_else(|| env::panic_str("Bounty not found"));
        assert_eq!(bounty.creator, env::predecessor_account_id(), "Only bounty creator");
        assert_eq!(bounty.status, BountyStatus::Open, "Bounty not open");
        env::storage_write(&verifier_key(bounty_id), &public_key);
    }

    pub fn get_bounty_verifier(&self, bounty_id: u64) -> Option<Vec<u8>> {
        env::storage_read(&verifier_key(bounty_id))
    }

    /// Accept only a score and evidence envelope signed by the configured
    /// verifier. This is the secure replacement for caller-supplied scoring.
    /// The legacy submit_output method remains for backwards compatibility.
    pub fn submit_verified_output(&mut self, bounty_id: u64, output_hash: CryptoHash, attestation: String, score: u32, signature: Vec<u8>) {
        let mut bounty = self.bounties.get(&bounty_id).unwrap_or_else(|| env::panic_str("Bounty not found"));
        assert_eq!(bounty.status, BountyStatus::Open, "Bounty not open");
        assert!(score <= 100, "Invalid score");
        assert!(score >= MIN_VERIFIED_SCORE, "Score below policy threshold");
        let account = env::predecessor_account_id();
        let mut agent = bounty.agents.get(&account).unwrap_or_else(|| env::panic_str("Not joined"));
        assert!(agent.output_hash.is_none(), "Already submitted");
        assert!(!attestation.is_empty(), "Missing attestation");
        let public_key: [u8; 32] = env::storage_read(&verifier_key(bounty_id)).unwrap_or_else(|| env::panic_str("Verifier not configured")).try_into().unwrap();
        let signature: [u8; 64] = signature.try_into().unwrap_or_else(|_| env::panic_str("Invalid verifier signature length"));
        let attestation_hash = env::sha256_array(attestation.as_bytes());
        let message = signed_submission_message(bounty_id, &account, &output_hash, &attestation_hash, score);
        assert!(env::ed25519_verify(&signature, &message, &public_key), "Invalid verifier signature");
        agent.output_hash = Some(output_hash);
        agent.attestation = Some(attestation);
        agent.submitted_at = Some(env::block_timestamp());
        agent.score = Some(score);
        bounty.agents.insert(&account, &agent);
        env::storage_write(&verified_key(bounty_id, &account), &[1]);
        let submissions = bounty.agents.iter().filter(|(_, a)| a.output_hash.is_some()).count();
        assert!(env::block_timestamp() <= bounty.deadline || submissions >= 2, "Deadline passed");
        self.bounties.insert(&bounty_id, &bounty);
    }

    pub fn settle_verified(&mut self, bounty_id: u64) {
        self.settle_internal(bounty_id, true);
    }

    pub fn settle(&mut self, bounty_id: u64) {
        self.settle_internal(bounty_id, false);
    }

    fn settle_internal(&mut self, bounty_id: u64, verified_only: bool) {
        let mut bounty = self.bounties.get(&bounty_id).unwrap_or_else(|| env::panic_str("Bounty not found"));
        assert_eq!(bounty.status, BountyStatus::Open, "Bounty not open");
        let submissions: Vec<(AccountId, AgentEntry)> = bounty.agents.iter().filter(|(account, a)| a.output_hash.is_some() && (!verified_only || is_verified(bounty_id, account))).collect();
        assert!(!submissions.is_empty(), "No submissions");
        assert!(submissions.len() >= 2 || env::block_timestamp() >= bounty.deadline, "Deadline passed");
        let winner = submissions.iter().max_by(|a, b| a.1.score.unwrap_or(0).cmp(&b.1.score.unwrap_or(0)).then_with(|| b.1.submitted_at.unwrap_or(u64::MAX).cmp(&a.1.submitted_at.unwrap_or(u64::MAX)))).unwrap().0.clone();
        let payout = bounty.budget * 80 / 100;
        let _ = Promise::new(winner.clone()).transfer(near_sdk::NearToken::from_yoctonear(payout));
        for (account, agent) in bounty.agents.iter() { if account != winner { let _ = Promise::new(account).transfer(near_sdk::NearToken::from_yoctonear(agent.stake / 2)); } }
        let creator_remainder = bounty.budget - payout;
        let _ = Promise::new(bounty.creator.clone()).transfer(near_sdk::NearToken::from_yoctonear(creator_remainder));
        bounty.status = BountyStatus::Settled; bounty.winner = Some(winner.clone()); self.bounties.insert(&bounty_id, &bounty);
        env::log_str(&format!("BountySettled {{id:{}, winner:{}, payout:{}}}", bounty_id, winner, payout));
    }

    pub fn get_bounty(&self, bounty_id: u64) -> Option<BountyView> { self.bounties.get(&bounty_id).map(|b| BountyView { id:b.id, creator:b.creator, budget:U128(b.budget), description:b.description, created_at:b.created_at, deadline:b.deadline, status:b.status, winner:b.winner, agent_count:b.agents.len() as u32 }) }
    pub fn get_bounties(&self) -> Vec<BountyView> { self.bounties.iter().map(|(_, b)| BountyView { id:b.id, creator:b.creator, budget:U128(b.budget), description:b.description, created_at:b.created_at, deadline:b.deadline, status:b.status, winner:b.winner, agent_count:b.agents.len() as u32 }).collect() }
    pub fn get_agents(&self, bounty_id: u64) -> Vec<AgentView> { self.bounties.get(&bounty_id).map(|b| b.agents.iter().map(|(account,a)| AgentView { verified: is_verified(bounty_id, &account), account, stake:U128(a.stake), joined_at:a.joined_at, output_hash:a.output_hash, attestation:a.attestation, submitted_at:a.submitted_at, score:a.score }).collect()).unwrap_or_default() }
    pub fn get_min_stake(&self) -> U128 { U128(self.min_stake) }
    pub fn get_next_bounty_id(&self) -> u64 { self.next_bounty_id }
}

fn verifier_key(bounty_id: u64) -> Vec<u8> { [VERIFIER_PREFIX, bounty_id.to_string().as_bytes()].concat() }
fn verified_key(bounty_id: u64, account: &AccountId) -> Vec<u8> { [VERIFIED_PREFIX, bounty_id.to_string().as_bytes(), b"/", account.as_str().as_bytes()].concat() }
fn is_verified(bounty_id: u64, account: &AccountId) -> bool { env::storage_read(&verified_key(bounty_id, account)).is_some() }
fn signed_submission_message(bounty_id: u64, account: &AccountId, output_hash: &CryptoHash, attestation_hash: &CryptoHash, score: u32) -> Vec<u8> {
    format!("swarm-for-hire/v1|{}|{}|{}|{}|{}", bounty_id, account, to_hex(output_hash), to_hex(attestation_hash), score).into_bytes()
}
fn to_hex(bytes: &[u8; 32]) -> String { bytes.iter().map(|byte| format!("{byte:02x}")).collect() }

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn account(name: &str) -> AccountId { name.parse().unwrap() }
    fn context(predecessor: &str, deposit: u128, timestamp: u64) -> near_sdk::VMContext {
        VMContextBuilder::new().current_account_id(account("swarm.testnet")).predecessor_account_id(account(predecessor)).attached_deposit(NearToken::from_yoctonear(deposit)).block_timestamp(timestamp).build()
    }

    #[test]
    fn creates_bounty_and_advances_id() {
        testing_env!(context("creator.testnet", YOCTO_NEAR * 5, 1));
        let mut contract = Contract::new();
        assert_eq!(contract.create_bounty("brief".into(), 3600), 0);
        assert_eq!(contract.get_next_bounty_id(), 1);
        assert_eq!(contract.get_bounty(0).unwrap().budget.0, YOCTO_NEAR * 5);
    }

    #[test]
    fn agent_can_join_once_with_minimum_stake() {
        testing_env!(context("creator.testnet", YOCTO_NEAR * 5, 1));
        let mut contract = Contract::new();
        contract.create_bounty("brief".into(), 3600);
        testing_env!(context("agent.testnet", MIN_STAKE, 2));
        contract.join_bounty(0);
        assert_eq!(contract.get_agents(0).len(), 1);
    }

    #[test]
    fn settles_highest_score_and_lists_bounty() {
        testing_env!(context("creator.testnet", YOCTO_NEAR * 5, 1));
        let mut contract = Contract::new();
        contract.create_bounty("brief".into(), 3600);
        testing_env!(context("agent1.testnet", MIN_STAKE, 2));
        contract.join_bounty(0);
        testing_env!(context("agent2.testnet", MIN_STAKE, 3));
        contract.join_bounty(0);
        testing_env!(context("agent1.testnet", 0, 4));
        contract.submit_output(0, [1; 32], "quote-1".into(), 90);
        testing_env!(context("agent2.testnet", 0, 5));
        contract.submit_output(0, [2; 32], "quote-2".into(), 75);
        testing_env!(context("creator.testnet", 0, 6));
        contract.settle(0);
        let bounty = contract.get_bounty(0).unwrap();
        assert_eq!(bounty.status, BountyStatus::Settled);
        assert_eq!(bounty.winner, Some(account("agent1.testnet")));
        assert_eq!(contract.get_bounties().len(), 1);
    }
}
