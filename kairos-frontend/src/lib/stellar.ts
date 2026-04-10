// Stellar configuration for Kairos frontend

export const STELLAR_NETWORK = "TESTNET";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

// Circle USDC on Stellar Testnet (raw strings — no Asset constructor at module scope)
export const USDC_CODE = "USDC";
export const USDC_ISSUER = "GBBD47IF6LWNC76YUOOWDQUV6SBCSYOTZLHXWNIY6S77AZEGTXCOFOYJ";

export const KAIROS_API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
