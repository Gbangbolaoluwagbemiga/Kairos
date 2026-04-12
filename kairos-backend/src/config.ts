// config.ts - Kairos Stellar Multi-Agent Economy (updated: agent addresses v2)
import { Asset, Keypair, StrKey } from "@stellar/stellar-sdk";

// Circle Testnet USDC on Stellar (used when no treasury / explicit issuer)
const USDC_CODE = "USDC";
const DEFAULT_USDC_ISSUER = "GBBD47IF6LWNC76YUOOWDQUV6SBCSYOTZLHXWNIY6S77AZEGTXCOFOYJ";

/**
 * USDC for treasury micropayments + Fund Wallet demo faucet must match.
 * - If `USDC_ISSUER_ADDRESS` is set to a valid Stellar key → use it (e.g. Circle testnet USDC).
 * - Otherwise, if `STELLAR_SPONSOR_SECRET` is set → issuer = treasury (same demo USDC as /api/stellar/usdc/*).
 * - Else → Circle default.
 */
function resolveUsdcIssuerAddress(): string {
    const fromEnv = (process.env.USDC_ISSUER_ADDRESS || "").trim();
    if (fromEnv && StrKey.isValidEd25519PublicKey(fromEnv)) {
        return fromEnv;
    }
    if (fromEnv) {
        console.warn(
            `[config] Invalid USDC_ISSUER_ADDRESS; ignoring. Use treasury-issued demo USDC or fall back to Circle.`
        );
    }
    const secret = (process.env.STELLAR_SPONSOR_SECRET || "").trim();
    if (secret.startsWith("S")) {
        try {
            const treasury = Keypair.fromSecret(secret).publicKey();
            if (!fromEnv) {
                console.log(
                    `[config] USDC issuer = treasury (${treasury.slice(0, 6)}…) — matches Fund Wallet demo USDC. Set USDC_ISSUER_ADDRESS for Circle or another issuer.`
                );
            }
            return treasury;
        } catch {
            /* fall through */
        }
    }
    return DEFAULT_USDC_ISSUER;
}

const RESOLVED_USDC_ISSUER = resolveUsdcIssuerAddress();

// Lazy getter to avoid crashing at module-load time if SDK version has strict validation
let _usdcAsset: Asset | null = null;
export function getUsdcAsset(): Asset {
    if (!_usdcAsset) {
        const issuer = StrKey.isValidEd25519PublicKey(RESOLVED_USDC_ISSUER)
            ? RESOLVED_USDC_ISSUER
            : DEFAULT_USDC_ISSUER;

        if (issuer !== RESOLVED_USDC_ISSUER) {
            console.warn(
                `[config] Resolved USDC issuer invalid; falling back to default issuer ${DEFAULT_USDC_ISSUER}`
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
        usdcCode: USDC_CODE,
        usdcIssuer: StrKey.isValidEd25519PublicKey(RESOLVED_USDC_ISSUER)
            ? RESOLVED_USDC_ISSUER
            : DEFAULT_USDC_ISSUER,
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

