#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

/// A spending policy that enforces daily limits on agent payments.
/// Demonstrates how autonomous agents can have programmable spending constraints.
/// 
/// Use cases:
/// - Agent daily spending caps (e.g., max 10 USDC/day for A2A payments)
/// - Rate limiting expensive API calls
/// - Budget management for multi-agent workflows

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingLimit {
    pub agent: Address,
    pub daily_limit: i128,      // Max spend per day in stroops (1 USDC = 10_000_000)
    pub spent_today: i128,      // Amount spent in current period
    pub period_start: u64,      // Unix timestamp when current period started
    pub total_spent: i128,      // Lifetime spend tracking
}

#[contracttype]
pub enum DataKey {
    SpendingLimit(Address),
    Owner,
}

const DAY_IN_SECONDS: u64 = 86400;

#[contract]
pub struct SpendingPolicy;

#[contractimpl]
impl SpendingPolicy {
    /// Initialize the contract with an owner who can set spending limits
    pub fn initialize(env: Env, owner: Address) {
        owner.require_auth();
        env.storage().persistent().set(&DataKey::Owner, &owner);
    }

    /// Set a daily spending limit for an agent wallet
    /// Only the owner can set limits
    pub fn set_limit(env: Env, agent: Address, daily_limit: i128) {
        let owner: Address = env.storage().persistent().get(&DataKey::Owner)
            .unwrap_or_else(|| panic!("Contract not initialized"));
        owner.require_auth();

        let now = env.ledger().timestamp();
        let limit = SpendingLimit {
            agent: agent.clone(),
            daily_limit,
            spent_today: 0,
            period_start: now,
            total_spent: 0,
        };

        env.storage().persistent().set(&DataKey::SpendingLimit(agent), &limit);
    }

    /// Check if an agent can spend the requested amount
    /// Returns true if within limit, false if would exceed
    pub fn can_spend(env: Env, agent: Address, amount: i128) -> bool {
        let limit: Option<SpendingLimit> = env.storage()
            .persistent()
            .get(&DataKey::SpendingLimit(agent));

        match limit {
            None => true, // No limit set = unlimited
            Some(mut l) => {
                let now = env.ledger().timestamp();
                
                // Reset if new day
                if now >= l.period_start + DAY_IN_SECONDS {
                    l.spent_today = 0;
                }

                l.spent_today + amount <= l.daily_limit
            }
        }
    }

    /// Record a spend and update the limit tracker
    /// Returns the new spent_today amount
    /// Panics if the spend would exceed the limit
    pub fn record_spend(env: Env, agent: Address, amount: i128) -> i128 {
        agent.require_auth();

        let mut limit: SpendingLimit = env.storage()
            .persistent()
            .get(&DataKey::SpendingLimit(agent.clone()))
            .unwrap_or_else(|| panic!("No spending limit set for this agent"));

        let now = env.ledger().timestamp();

        // Reset if new day
        if now >= limit.period_start + DAY_IN_SECONDS {
            limit.spent_today = 0;
            limit.period_start = now;
        }

        // Check limit
        if limit.spent_today + amount > limit.daily_limit {
            panic!("Spending limit exceeded");
        }

        // Record spend
        limit.spent_today += amount;
        limit.total_spent += amount;

        env.storage().persistent().set(&DataKey::SpendingLimit(agent), &limit);

        limit.spent_today
    }

    /// Get the current spending status for an agent
    pub fn get_status(env: Env, agent: Address) -> SpendingLimit {
        let mut limit: SpendingLimit = env.storage()
            .persistent()
            .get(&DataKey::SpendingLimit(agent.clone()))
            .unwrap_or_else(|| panic!("No spending limit set for this agent"));

        let now = env.ledger().timestamp();

        // Reset if new day (return fresh state)
        if now >= limit.period_start + DAY_IN_SECONDS {
            limit.spent_today = 0;
            limit.period_start = now;
        }

        limit
    }

    /// Get remaining daily budget
    pub fn get_remaining(env: Env, agent: Address) -> i128 {
        let status = Self::get_status(env, agent);
        status.daily_limit - status.spent_today
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    #[test]
    fn test_spending_limit() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicy);
        let client = SpendingPolicyClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let agent = Address::generate(&env);

        // Initialize
        client.initialize(&owner);

        // Set limit: 1 USDC daily (10_000_000 stroops)
        let daily_limit: i128 = 10_000_000;
        client.set_limit(&agent, &daily_limit);

        // Can spend small amount
        assert!(client.can_spend(&agent, &50_000)); // 0.005 USDC

        // Record a spend
        client.record_spend(&agent, &5_000_000); // 0.5 USDC
        
        // Check remaining
        let remaining = client.get_remaining(&agent);
        assert_eq!(remaining, 5_000_000); // 0.5 USDC left

        // Cannot exceed limit
        assert!(!client.can_spend(&agent, &6_000_000)); // Would exceed
    }

    #[test]
    fn test_daily_reset() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicy);
        let client = SpendingPolicyClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let agent = Address::generate(&env);

        client.initialize(&owner);
        client.set_limit(&agent, &10_000_000);

        // Spend full limit
        client.record_spend(&agent, &10_000_000);
        assert!(!client.can_spend(&agent, &1));

        // Advance time by 1 day
        env.ledger().with_mut(|li| {
            li.timestamp += 86401;
        });

        // Should be able to spend again
        assert!(client.can_spend(&agent, &5_000_000));
    }
}
