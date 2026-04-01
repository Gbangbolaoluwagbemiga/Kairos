#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Agent {
    pub id: u32,
    pub owner: Address,
    pub name: String,
    pub service_type: String,
    pub price: i128,
    pub reputation: u32,
    pub tasks_completed: u32,
    pub active: bool,
}

#[contracttype]
pub enum DataKey {
    Agent(u32),
    AgentByWallet(Address),
    AgentsByService(String),
    AgentCount,
}

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    /// Register a new AI Agent with its service type and per-task fee
    pub fn register_agent(
        env: Env,
        owner: Address,
        name: String,
        service_type: String,
        price: i128,
    ) -> u32 {
        owner.require_auth();

        // Ensure wallet isn't already registered
        if env.storage().persistent().has(&DataKey::AgentByWallet(owner.clone())) {
            panic!("Agent already registered for this wallet");
        }

        let mut count: u32 = env.storage().persistent().get(&DataKey::AgentCount).unwrap_or(0);
        count += 1;

        let agent = Agent {
            id: count,
            owner: owner.clone(),
            name,
            service_type: service_type.clone(),
            price,
            reputation: 100,
            tasks_completed: 0,
            active: true,
        };

        // Store agent data and mappings
        env.storage().persistent().set(&DataKey::Agent(count), &agent);
        env.storage().persistent().set(&DataKey::AgentByWallet(owner.clone()), &count);
        env.storage().persistent().set(&DataKey::AgentCount, &count);

        let mut service_agents: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::AgentsByService(service_type.clone()))
            .unwrap_or(Vec::new(&env));
            
        service_agents.push_back(count);
        
        env.storage()
            .persistent()
            .set(&DataKey::AgentsByService(service_type), &service_agents);

        count
    }

    /// Update an agent's price and active status
    pub fn update_agent(env: Env, owner: Address, price: i128, active: bool) {
        owner.require_auth();

        let agent_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::AgentByWallet(owner.clone()))
            .unwrap_or_else(|| panic!("Agent not found"));

        let mut agent: Agent = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id))
            .unwrap();

        agent.price = price;
        agent.active = active;

        env.storage().persistent().set(&DataKey::Agent(agent_id), &agent);
    }

    /// Deactivate an agent and free its wallet mapping
    pub fn deregister_agent(env: Env, owner: Address) {
        owner.require_auth();

        let agent_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::AgentByWallet(owner.clone()))
            .unwrap_or_else(|| panic!("Agent not found"));

        let mut agent: Agent = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent_id))
            .unwrap();

        agent.active = false;
        env.storage().persistent().set(&DataKey::Agent(agent_id), &agent);
        
        // Remove from wallet mapping to allow re-registration
        env.storage().persistent().remove(&DataKey::AgentByWallet(owner));
    }

    /// Retrieve agent details by ID
    pub fn get_agent(env: Env, id: u32) -> Agent {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(id))
            .unwrap_or_else(|| panic!("Agent ID not found"))
    }

    /// Get all agent IDs that offer a specific service type
    pub fn get_agents_by_service(env: Env, service_type: String) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::AgentsByService(service_type))
            .unwrap_or(Vec::new(&env))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{String, Env};

    #[test]
    fn test_register_and_get_agent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgentRegistry);
        let client = AgentRegistryClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let name = String::from_str(&env, "StellarScout");
        let service_type = String::from_str(&env, "analysis");
        let price = 1000000; // 1 USDC

        let agent_id = client.register_agent(&owner, &name, &service_type, &price);
        assert_eq!(agent_id, 1);

        let agent = client.get_agent(&agent_id);
        assert_eq!(agent.name, name);
        assert_eq!(agent.service_type, service_type);
        assert_eq!(agent.price, price);
        assert!(agent.active);
    }

    #[test]
    fn test_update_agent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, AgentRegistry);
        let client = AgentRegistryClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let name = String::from_str(&env, "PriceOracle");
        let service_type = String::from_str(&env, "price");
        let price = 500000;

        client.register_agent(&owner, &name, &service_type, &price);

        let new_price = 750000;
        client.update_agent(&owner, &new_price, &false);

        let agent = client.get_agent(&1);
        assert_eq!(agent.price, new_price);
        assert!(!agent.active);
    }
}

