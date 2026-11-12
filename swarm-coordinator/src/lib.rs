use near_sdk::{env, near, AccountId, BorshStorageKey, NearSchema, PanicOnDefault, Promise, NearToken};
use near_sdk::collections::{UnorderedMap, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{borsh::{BorshDeserialize, BorshSerialize}, CryptoHash};

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey { Buyers, Workers, Rounds, Bids { id: u64 } }

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum RoundPhase { Open, Revealing, Cleared, Allocated }

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Bid {
    pub worker: AccountId,
    pub commitment: CryptoHash,
    pub price: Option<u128>,
    pub quality: Option<u8>,
    pub revealed_at: Option<u64>,
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Round {
    pub id: u64,
    pub task: String,
    pub budget: u128,
    pub buyer_count: u32,
    pub worker_count: u32,
    pub phase: RoundPhase,
    pub opened_at: u64,
    pub bids: UnorderedMap<AccountId, Bid>,
    pub winner: Option<AccountId>,
    pub clearing_price: Option<u128>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundView {
    pub id: u64, pub task: String, pub budget: U128, pub buyer_count: u32,
    pub worker_count: u32, pub phase: RoundPhase, pub opened_at: u64,
    pub bid_count: u32, pub revealed_count: u32, pub winner: Option<AccountId>,
    pub clearing_price: Option<U128>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BidView {
    pub worker: AccountId, pub commitment: CryptoHash, pub price: Option<U128>,
    pub quality: Option<u8>, pub revealed_at: Option<u64>,
}

#[near(contract_state)]
#[derive(NearSchema, PanicOnDefault)]
pub struct Contract {
    pub owner: AccountId,
    pub buyers: UnorderedSet<AccountId>,
    pub workers: UnorderedSet<AccountId>,
    pub rounds: UnorderedMap<u64, Round>,
    pub next_round_id: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            owner: env::predecessor_account_id(),
            buyers: UnorderedSet::new(StorageKey::Buyers),
            workers: UnorderedSet::new(StorageKey::Workers),
            rounds: UnorderedMap::new(StorageKey::Rounds),
            next_round_id: 0,
        }
    }

    fn assert_owner(&self) { assert_eq!(env::predecessor_account_id(), self.owner, "Only coordinator owner"); }
    fn get_round_or_panic(&self, id: u64) -> Round { self.rounds.get(&id).unwrap_or_else(|| env::panic_str("Round not found")) }
    fn hash_bid(price: u128, quality: u8, salt: &str) -> CryptoHash { env::sha256(format!("{}|{}|{}", price, quality, salt).as_bytes()).try_into().unwrap() }

    pub fn register_buyer(&mut self, account: AccountId) { self.assert_owner(); self.buyers.insert(&account); }
    pub fn register_worker(&mut self, account: AccountId) { self.assert_owner(); self.workers.insert(&account); }

    pub fn open_round(&mut self, task: String, budget: U128, buyer_count: u32, worker_count: u32) -> u64 {
        self.assert_owner();
        assert!(!task.is_empty() && task.chars().count() <= 500, "Invalid task");
        assert!(buyer_count > 0 && worker_count > 0, "Invalid participant count");
        assert!(self.buyers.len() >= buyer_count as u64, "Not enough buyers");
        assert!(self.workers.len() >= worker_count as u64, "Not enough workers");
        let id = self.next_round_id;
        self.next_round_id += 1;
        let round = Round { id, task, budget: budget.0, buyer_count, worker_count, phase: RoundPhase::Open, opened_at: env::block_timestamp(), bids: UnorderedMap::new(StorageKey::Bids { id }), winner: None, clearing_price: None };
        self.rounds.insert(&id, &round);
        env::log_str(&format!("SwarmRoundOpened {{id:{}, buyers:{}, workers:{}}}", id, buyer_count, worker_count));
        id
    }

    pub fn commit_bid(&mut self, round_id: u64, commitment: CryptoHash) {
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Open, "Round not accepting commitments");
        let worker = env::predecessor_account_id();
        assert!(self.workers.contains(&worker), "Worker not registered");
        assert!(round.bids.get(&worker).is_none(), "Bid already committed");
        assert!(round.bids.len() < round.worker_count as u64, "All worker bids committed");
        round.bids.insert(&worker, &Bid { worker: worker.clone(), commitment, price: None, quality: None, revealed_at: None });
        self.rounds.insert(&round_id, &round);
    }

    pub fn open_reveal(&mut self, round_id: u64) {
        self.assert_owner();
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Open, "Round not accepting commitments");
        assert!(round.bids.len() > 0, "No bids committed");
        round.phase = RoundPhase::Revealing;
        self.rounds.insert(&round_id, &round);
    }

    pub fn reveal_bid(&mut self, round_id: u64, price: U128, quality: u8, salt: String) {
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Revealing, "Round not revealing");
        assert!(quality <= 100, "Invalid quality");
        let worker = env::predecessor_account_id();
        let mut bid = round.bids.get(&worker).unwrap_or_else(|| env::panic_str("Bid not committed"));
        assert!(bid.price.is_none(), "Bid already revealed");
        assert_eq!(bid.commitment, Self::hash_bid(price.0, quality, &salt), "Commitment mismatch");
        bid.price = Some(price.0); bid.quality = Some(quality); bid.revealed_at = Some(env::block_timestamp());
        round.bids.insert(&worker, &bid);
        self.rounds.insert(&round_id, &round);
    }

    pub fn clear_round(&mut self, round_id: u64) {
        self.assert_owner();
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Revealing, "Round not ready to clear");
        let mut ranked: Vec<Bid> = round.bids.iter().filter_map(|(_, bid)| if bid.price.is_some() && bid.quality.is_some() && bid.price.unwrap() <= round.budget { Some(bid) } else { None }).collect();
        assert!(!ranked.is_empty(), "No eligible bids");
        ranked.sort_by(|a, b| b.quality.unwrap().cmp(&a.quality.unwrap()).then_with(|| a.price.unwrap().cmp(&b.price.unwrap())).then_with(|| a.worker.cmp(&b.worker)));
        let winner = ranked.first().unwrap();
        round.winner = Some(winner.worker.clone());
        round.clearing_price = Some(winner.price.unwrap());
        round.phase = RoundPhase::Cleared;
        self.rounds.insert(&round_id, &round);
        env::log_str(&format!("SwarmRoundCleared {{id:{}, winner:{}, clearing_price:{}}}", round_id, winner.worker, winner.price.unwrap()));
    }

    pub fn allocate(&mut self, round_id: u64) {
        self.assert_owner();
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Cleared, "Round not cleared");
        assert!(round.winner.is_some(), "No winner");
        let winner = round.winner.clone().unwrap();
        let payout = round.clearing_price.unwrap();
        round.phase = RoundPhase::Allocated;
        self.rounds.insert(&round_id, &round);
        // Native NEAR settlement is intentionally explicit. The coordinator
        // must be prefunded with at least the clearing price before allocation.
        let _ = Promise::new(winner.clone()).transfer(NearToken::from_yoctonear(payout));
        env::log_str(&format!("SwarmAllocation {{id:{}, winner:{}, payout:{}}}", round_id, winner, payout));
    }

    pub fn get_round(&self, round_id: u64) -> Option<RoundView> { self.rounds.get(&round_id).map(|round| self.round_view(round)) }
    pub fn get_rounds(&self) -> Vec<RoundView> { self.rounds.iter().map(|(_, round)| self.round_view(round)).collect() }
    pub fn get_bids(&self, round_id: u64) -> Vec<BidView> { self.rounds.get(&round_id).map(|round| round.bids.iter().map(|(_, bid)| BidView { worker: bid.worker, commitment: bid.commitment, price: bid.price.map(U128), quality: bid.quality, revealed_at: bid.revealed_at }).collect()).unwrap_or_default() }
    pub fn get_participants(&self) -> (Vec<AccountId>, Vec<AccountId>) { (self.buyers.to_vec(), self.workers.to_vec()) }
    pub fn hash_bid_preview(&self, price: U128, quality: u8, salt: String) -> CryptoHash { Self::hash_bid(price.0, quality, &salt) }

    fn round_view(&self, round: Round) -> RoundView { RoundView { id: round.id, task: round.task, budget: U128(round.budget), buyer_count: round.buyer_count, worker_count: round.worker_count, phase: round.phase, opened_at: round.opened_at, bid_count: round.bids.len() as u32, revealed_count: round.bids.iter().filter(|(_, bid)| bid.price.is_some()).count() as u32, winner: round.winner, clearing_price: round.clearing_price.map(U128) } }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn account(name: &str) -> AccountId { name.parse().unwrap() }
    fn context(predecessor: &str, timestamp: u64) -> near_sdk::VMContext { VMContextBuilder::new().current_account_id(account("market.testnet")).predecessor_account_id(account(predecessor)).attached_deposit(NearToken::from_near(0)).block_timestamp(timestamp).build() }
    fn commitment(price: u128, quality: u8, salt: &str) -> CryptoHash { env::sha256(format!("{}|{}|{}", price, quality, salt).as_bytes()).try_into().unwrap() }

    #[test]
    fn commits_reveals_and_clears_highest_quality() {
        testing_env!(context("owner.testnet", 1));
        let mut contract = Contract::new();
        contract.register_buyer(account("buyer.testnet"));
        contract.register_worker(account("worker1.testnet"));
        contract.register_worker(account("worker2.testnet"));
        let id = contract.open_round("GPU hours".into(), U128(100), 1, 2);
        testing_env!(context("worker1.testnet", 2)); contract.commit_bid(id, commitment(40, 80, "a"));
        testing_env!(context("worker2.testnet", 3)); contract.commit_bid(id, commitment(50, 90, "b"));
        testing_env!(context("owner.testnet", 4)); contract.open_reveal(id);
        testing_env!(context("worker1.testnet", 5)); contract.reveal_bid(id, U128(40), 80, "a".into());
        testing_env!(context("worker2.testnet", 6)); contract.reveal_bid(id, U128(50), 90, "b".into());
        testing_env!(context("owner.testnet", 7)); contract.clear_round(id); contract.allocate(id);
        let round = contract.get_round(id).unwrap();
        assert_eq!(round.winner, Some(account("worker2.testnet")));
        assert_eq!(round.phase, RoundPhase::Allocated);
        assert_eq!(round.clearing_price.unwrap().0, 50);
    }
}
