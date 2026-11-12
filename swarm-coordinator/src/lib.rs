use near_sdk::{env, near, AccountId, BorshStorageKey, NearSchema, PanicOnDefault, Promise, NearToken};
use near_sdk::collections::{UnorderedMap, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{borsh::{BorshDeserialize, BorshSerialize}, CryptoHash};

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey { Buyers, Workers, Rounds, Bids { id: u64 } }
const DEMANDS_PREFIX: &[u8] = b"swarm-market/demands/";
const ALLOCATIONS_PREFIX: &[u8] = b"swarm-market/allocations/";
const MARKET_SETTLED_PREFIX: &[u8] = b"swarm-market/settled/";

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

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Demand {
    pub buyer: AccountId,
    pub max_price: u128,
    pub quantity: u128,
    pub locked: u128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DemandView { pub buyer: AccountId, pub max_price: U128, pub quantity: U128, pub locked: U128 }

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Allocation { pub worker: AccountId, pub price: u128, pub quantity: u128 }

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AllocationView { pub worker: AccountId, pub price: U128, pub quantity: U128 }

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

    /// Lock buyer demand without changing the deployed Round Borsh layout.
    /// One buyer may submit one demand record per round.
    #[payable]
    pub fn submit_demand(&mut self, round_id: u64, max_price: U128, quantity: U128) {
        let round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Open, "Round not accepting demand");
        let buyer = env::predecessor_account_id();
        assert!(self.buyers.contains(&buyer), "Buyer not registered");
        assert!(quantity.0 > 0 && max_price.0 > 0, "Invalid demand");
        let mut demands = self.demands(round_id);
        assert!(demands.iter().all(|d| d.buyer != buyer), "Demand already submitted");
        let locked = max_price.0.checked_mul(quantity.0).unwrap_or_else(|| env::panic_str("Demand overflow"));
        assert_eq!(env::attached_deposit().as_yoctonear(), locked, "Demand deposit mismatch");
        demands.push(Demand { buyer, max_price: max_price.0, quantity: quantity.0, locked });
        self.write_demands(round_id, &demands);
    }

    pub fn get_demands(&self, round_id: u64) -> Vec<DemandView> {
        self.demands(round_id).into_iter().map(|d| DemandView { buyer: d.buyer, max_price: U128(d.max_price), quantity: U128(d.quantity), locked: U128(d.locked) }).collect()
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

    /// Cheapest-first market clearing for locked buyer demand. Each revealed
    /// worker bid supplies one unit; selected workers share the clearing price.
    pub fn clear_market(&mut self, round_id: u64) {
        self.assert_owner();
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Revealing, "Round not ready to clear");
        let demands = self.demands(round_id);
        assert!(demands.len() >= 1, "No buyer demand");
        let total_quantity: u128 = demands.iter().map(|d| d.quantity).sum();
        let max_price = demands.iter().map(|d| d.max_price).max().unwrap();
        let mut ranked: Vec<Bid> = round.bids.iter().filter_map(|(_, bid)| if bid.price.is_some() && bid.quality.is_some() && bid.price.unwrap() <= round.budget && bid.price.unwrap() <= max_price { Some(bid) } else { None }).collect();
        ranked.sort_by(|a, b| a.price.unwrap().cmp(&b.price.unwrap()).then_with(|| b.quality.unwrap().cmp(&a.quality.unwrap())).then_with(|| a.worker.cmp(&b.worker)));
        let selected: Vec<Bid> = ranked.into_iter().take(total_quantity as usize).collect();
        assert!(!selected.is_empty(), "No eligible bids");
        let clearing_price = selected.iter().map(|b| b.price.unwrap()).max().unwrap();
        let allocations: Vec<Allocation> = selected.into_iter().map(|b| Allocation { worker: b.worker, price: clearing_price, quantity: 1 }).collect();
        round.winner = allocations.first().map(|a| a.worker.clone());
        round.clearing_price = Some(clearing_price);
        round.phase = RoundPhase::Cleared;
        self.write_allocations(round_id, &allocations);
        self.rounds.insert(&round_id, &round);
        env::log_str(&format!("SwarmMarketCleared {{id:{}, clearing_price:{}, allocated_units:{}}}", round_id, clearing_price, allocations.len()));
    }

    pub fn get_allocations(&self, round_id: u64) -> Vec<AllocationView> {
        self.allocations(round_id).into_iter().map(|a| AllocationView { worker: a.worker, price: U128(a.price), quantity: U128(a.quantity) }).collect()
    }

    /// Pay selected workers and refund each buyer's unused maximum.
    pub fn allocate_market(&mut self, round_id: u64) {
        self.assert_owner();
        let mut round = self.get_round_or_panic(round_id);
        assert_eq!(round.phase, RoundPhase::Cleared, "Round not cleared");
        assert!(env::storage_read(&market_settled_key(round_id)).is_none(), "Market already allocated");
        let allocations = self.allocations(round_id);
        assert!(!allocations.is_empty(), "No allocations");
        let clearing_price = round.clearing_price.unwrap();
        for allocation in &allocations {
            let amount = allocation.price * allocation.quantity;
            let _ = Promise::new(allocation.worker.clone()).transfer(NearToken::from_yoctonear(amount));
        }
        let mut remaining_units = allocations.iter().map(|a| a.quantity).sum::<u128>();
        for demand in self.demands(round_id) {
            let used_units = demand.quantity.min(remaining_units);
            remaining_units = remaining_units.saturating_sub(used_units);
            let used = clearing_price.saturating_mul(used_units);
            let refund = demand.locked.saturating_sub(used);
            if refund > 0 { let _ = Promise::new(demand.buyer).transfer(NearToken::from_yoctonear(refund)); }
        }
        round.phase = RoundPhase::Allocated;
        self.rounds.insert(&round_id, &round);
        env::storage_write(&market_settled_key(round_id), &[1]);
        env::log_str(&format!("SwarmMarketAllocated {{id:{}, clearing_price:{}, allocations:{}}}", round_id, clearing_price, allocations.len()));
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
    fn demands(&self, round_id: u64) -> Vec<Demand> { env::storage_read(&demands_key(round_id)).and_then(|bytes| Vec::<Demand>::try_from_slice(&bytes).ok()).unwrap_or_default() }
    fn write_demands(&mut self, round_id: u64, demands: &[Demand]) { env::storage_write(&demands_key(round_id), &borsh::to_vec(demands).unwrap()); }
    fn allocations(&self, round_id: u64) -> Vec<Allocation> { env::storage_read(&allocations_key(round_id)).and_then(|bytes| Vec::<Allocation>::try_from_slice(&bytes).ok()).unwrap_or_default() }
    fn write_allocations(&mut self, round_id: u64, allocations: &[Allocation]) { env::storage_write(&allocations_key(round_id), &borsh::to_vec(allocations).unwrap()); }
}

fn demands_key(round_id: u64) -> Vec<u8> { [DEMANDS_PREFIX, round_id.to_string().as_bytes()].concat() }
fn allocations_key(round_id: u64) -> Vec<u8> { [ALLOCATIONS_PREFIX, round_id.to_string().as_bytes()].concat() }
fn market_settled_key(round_id: u64) -> Vec<u8> { [MARKET_SETTLED_PREFIX, round_id.to_string().as_bytes()].concat() }

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
