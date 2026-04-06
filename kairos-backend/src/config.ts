// config.ts - Kairos Stellar Multi-Agent Economy
import { Asset, StrKey } from "@stellar/stellar-sdk";

// Circle Testnet USDC on Stellar
const USDC_CODE = "USDC";
const DEFAULT_USDC_ISSUER = "GBBD47IF6LWNC76YUOOWDQUV6SBCSYOTZLHXWNIY6S77AZEGTXCOFOYJ";
const RAW_USDC_ISSUER = (process.env.USDC_ISSUER_ADDRESS || DEFAULT_USDC_ISSUER).trim();

// Lazy getter to avoid crashing at module-load time if SDK version has strict validation
let _usdcAsset: Asset | null = null;
export function getUsdcAsset(): Asset {
    if (!_usdcAsset) {
        const issuer = StrKey.isValidEd25519PublicKey(RAW_USDC_ISSUER)
            ? RAW_USDC_ISSUER
            : DEFAULT_USDC_ISSUER;

        if (issuer !== RAW_USDC_ISSUER) {
            // This avoids hard-crashing when a non-Stellar address is provided via env (common during hacks).
            console.warn(
                `[config] Invalid USDC_ISSUER_ADDRESS provided; falling back to default issuer ${DEFAULT_USDC_ISSUER}`
            );
        }

        _usdcAsset = new Asset(USDC_CODE, issuer);
    }
    return _usdcAsset;
}

export const config = {
    // Stellar Network
    stellar: {
        network: (process.env.STELLAR_NETWORK as "testnet" | "public") || "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        horizonUrl: "https://horizon-testnet.stellar.org",
        // Circle Testnet USDC on Stellar
        usdcCode: USDC_CODE,
        usdcIssuer: StrKey.isValidEd25519PublicKey(RAW_USDC_ISSUER) ? RAW_USDC_ISSUER : DEFAULT_USDC_ISSUER,
        // Master sponsor account (must be funded on testnet)
        sponsorSecret: process.env.STELLAR_SPONSOR_SECRET || "",
    },

    // Agent Price Settings (7 decimals for Stellar USDC)
    agent: {
        resellerPrice: "0.0300000", // $0.03 per query
        providerTaskPrice: "0.0100000", // $0.01 per task
        escrowTimeout: 300, // 5 minutes
    },

    // Gemini AI model
    gemini: {
        model: "gemini-3-flash-preview",
    },

    // Agent specific pricing
    prices: {
        oracle: "0.0100000",
        news: "0.0100000",
        yield: "0.0100000",
        tokenomics: "0.0100000",
        perp: "0.0100000",
        stellarScout: "0.0100000",
    },

    agentAddresses: {
        oracle: process.env.ORACLE_X402_ADDRESS || 'GD3ST27N7QIGIJTFFBMHEHKNTRLGAQNENFG3SCJIACFU2RFZB3GFBKOD',
        news: process.env.NEWS_X402_ADDRESS || 'GC7XSVV54SBKFHE6LZYXK7Q6PYD5PCZ4DBWQQO64HUIDCFLABALGIRFU',
        yield: process.env.YIELD_X402_ADDRESS || 'GBREPHL7BFCVQXIT2EJZ2LGEEXZBGJKA5I34WM224PV3CNLVBAKGJOGH',
        tokenomics: process.env.TOKENOMICS_X402_ADDRESS || 'GAKNTZ5VMLJTWXADZIDNTJYZWITRCA5URY4C5L2ARBRQ4O5S4SRLIMMW',
        perp: process.env.PERP_STATS_X402_ADDRESS || 'GA26WFT2JJLPATCW4KNAMFLOGRKS7VA7AQVNB74QISFDCTY2CU4HXUWF',
        stellarScout: process.env.STELLAR_SCOUT_X402_ADDRESS || 'GAUIRD53K7O24JRP7VH2DHCRUSUVT7WFY5P6OBPHQUDBEWBC3KLFAIET',
    }
};

