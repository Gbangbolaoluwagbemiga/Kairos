import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { networkPassphrase, sorobanServer } from "./stellar.js";

/**
 * Agent Registry Service
 * Interface for the Soroban Agent Registry contract.
 * Provides on-chain agent discovery and pricing.
 */
export interface AgentMetadata {
    id: number;
    owner: string;
    name: string;
    serviceType: string;
    price: string; // Stored as i128 in contract, decimal string here (e.g., "0.01")
    reputation: number;
    tasksCompleted: number;
    active: boolean;
}

// Default Registry (Mocked if CID is missing)
const MOCK_REGISTRY: Record<string, AgentMetadata> = {
    oracle:     { id: 1, owner: config.agentAddresses.oracle,     name: "Price Oracle",        serviceType: "price",     price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    news:       { id: 2, owner: config.agentAddresses.news,       name: "News Scout",           serviceType: "news",      price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    yield:      { id: 3, owner: config.agentAddresses.yield,      name: "Yield Optimizer",      serviceType: "yield",     price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    tokenomics: { id: 4, owner: config.agentAddresses.tokenomics, name: "Tokenomics Analyzer",  serviceType: "tokenomics",price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    perp:       { id: 5, owner: config.agentAddresses.perp,       name: "Perp Stats",           serviceType: "perp",      price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    stellar:        { id: 6, owner: config.agentAddresses.stellarScout, name: "Stellar Scout", serviceType: "stellar",     price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    "stellar-scout": { id: 6, owner: config.agentAddresses.stellarScout, name: "Stellar Scout", serviceType: "stellar",     price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    protocol:   { id: 7, owner: config.agentAddresses.protocol,   name: "Protocol Stats",       serviceType: "protocol",  price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    bridges:    { id: 8, owner: config.agentAddresses.bridges,    name: "Bridge Monitor",       serviceType: "bridges",   price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
    "stellar-dex": { id: 9, owner: config.agentAddresses.stellarDex, name: "Stellar DEX",      serviceType: "stellar-dex",price: "0.01", reputation: 100, tasksCompleted: 0, active: true },
};

export class AgentRegistryService {
    private static contractId = process.env.AGENT_REGISTRY_CONTRACT_ID;
    private static serviceTypeByKey: Record<string, string> = {
        oracle: "price",
        news: "news",
        yield: "yield",
        tokenomics: "tokenomics",
        perp: "perp",
        stellar: "stellar",
        "stellar-scout": "stellar", // alias for stellar-scout agent
        protocol: "protocol",
        bridges: "bridges",
        "stellar-dex": "stellar-dex",
    };

    private static async simulateReadonly(method: string, args: unknown[] = []): Promise<unknown> {
        if (!this.contractId) throw new Error("AGENT_REGISTRY_CONTRACT_ID missing");
        if (!config.stellar.sponsorSecret?.startsWith("S")) {
            throw new Error("STELLAR_SPONSOR_SECRET required for Soroban read simulation");
        }

        const source = StellarSdk.Keypair.fromSecret(config.stellar.sponsorSecret).publicKey();
        const contract = new StellarSdk.Contract(this.contractId);
        const account = await sorobanServer.getAccount(source);
        const opArgs = args.map((a) => {
            // Soroban contract expects u32 for agent IDs; passing i32 will trap.
            if (method === "get_agent" && typeof a === "number" && Number.isInteger(a) && a >= 0) {
                return StellarSdk.nativeToScVal(a, { type: "u32" });
            }
            return StellarSdk.nativeToScVal(a);
        });

        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase,
        })
            .addOperation(contract.call(method, ...opArgs))
            .setTimeout(30)
            .build();

        const sim = await sorobanServer.simulateTransaction(tx);
        if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
            const error = (sim as any)?.error || "Unknown Soroban simulation failure";
            throw new Error(`Soroban simulate failed for ${method}: ${error}`);
        }

        const retval = (sim as any).result?.retval;
        if (!retval) {
            throw new Error(`Soroban simulate returned no retval for ${method}`);
        }

        return StellarSdk.scValToNative(retval);
    }

    private static formatPrice(value: unknown): string {
        try {
            const raw = BigInt(value as any);
            const scale = 10n ** 7n;
            const sign = raw < 0n ? "-" : "";
            const abs = raw < 0n ? -raw : raw;
            const whole = abs / scale;
            const fraction = (abs % scale).toString().padStart(7, "0");
            return `${sign}${whole.toString()}.${fraction}`;
        } catch {
            return "0.0100000";
        }
    }

    private static toAgentMetadata(native: any): AgentMetadata | undefined {
        if (!native || typeof native !== "object") return undefined;
        const obj = native as Record<string, any>;

        const id = Number(obj.id ?? obj["id"] ?? 0);
        const ownerRaw = obj.owner ?? obj["owner"];
        const owner = typeof ownerRaw === "string" ? ownerRaw : String(ownerRaw ?? "");
        const name = String(obj.name ?? obj["name"] ?? "");
        const serviceType = String(obj.service_type ?? obj.serviceType ?? "");
        const price = this.formatPrice(obj.price ?? "0");
        const reputation = Number(obj.reputation ?? 0);
        const tasksCompleted = Number(obj.tasks_completed ?? obj.tasksCompleted ?? 0);
        const active = Boolean(obj.active ?? false);

        if (!owner || !name || !serviceType) return undefined;

        return {
            id,
            owner,
            name,
            serviceType,
            price,
            reputation,
            tasksCompleted,
            active,
        };
    }

    /**
     * Resolves an agent's metadata (address, price) from the Soroban registry.
     * Falls back to high-fidelity mock if no contract ID is provided.
     */
    static async getAgent(agentIdOrService: string): Promise<AgentMetadata | undefined> {
        console.log(`[Registry] 🔍 Resolving agent: ${agentIdOrService}...`);

        if (!this.contractId) {
            console.warn(`[Registry] ⚠️ No AGENT_REGISTRY_CONTRACT_ID. Using local definition for ${agentIdOrService}.`);
            return MOCK_REGISTRY[agentIdOrService];
        }

        try {
            const maybeId = Number(agentIdOrService);
            let agentId: number | undefined = Number.isInteger(maybeId) && maybeId > 0 ? maybeId : undefined;

            if (!agentId) {
                const serviceType = this.serviceTypeByKey[agentIdOrService] || agentIdOrService;
                const ids = (await this.simulateReadonly("get_agents_by_service", [serviceType])) as unknown[];
                const firstId = Array.isArray(ids) && ids.length > 0 ? Number(ids[0]) : NaN;
                if (Number.isFinite(firstId) && firstId > 0) {
                    agentId = firstId;
                }
            }

            if (!agentId) {
                return undefined;
            }

            const raw = await this.simulateReadonly("get_agent", [agentId]);
            const parsed = this.toAgentMetadata(raw);
            return parsed;
        } catch (e) {
            console.error(`[Registry] ❌ Soroban query failed:`, e);
            return undefined;
        }
    }

    /**
     * Lists all active agents from the registry.
     */
    static async listAgents(): Promise<AgentMetadata[]> {
        if (!this.contractId) return Object.values(MOCK_REGISTRY);

        try {
            const services = Object.values(this.serviceTypeByKey);
            const ids = new Set<number>();
            for (const service of services) {
                const serviceIds = (await this.simulateReadonly("get_agents_by_service", [service])) as unknown[];
                if (!Array.isArray(serviceIds)) continue;
                for (const id of serviceIds) {
                    const n = Number(id);
                    if (Number.isFinite(n) && n > 0) ids.add(n);
                }
            }

            const out: AgentMetadata[] = [];
            for (const id of ids) {
                const raw = await this.simulateReadonly("get_agent", [id]);
                const parsed = this.toAgentMetadata(raw);
                if (parsed?.active) out.push(parsed);
            }
            return out;
        } catch (e) {
            console.error(`[Registry] ❌ Failed to list agents on-chain:`, e);
            return [];
        }
    }
}
