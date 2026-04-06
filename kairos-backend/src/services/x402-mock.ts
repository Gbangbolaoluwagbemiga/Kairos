/**
 * 🛠️ Kairos: Robust x402 Mock Client
 * This file replaces the private @circlefin/x402-batching dependency.
 * It provides the full interface expected by the backend services.
 */

export class GatewayClient {
    public address: string = "GDPLB5SCKEZPSF7YZMTMIQY3JX4QVQVZMBWZZ7S7GNC5WUJ4H7HEE7O";
    public chainName: string = "Stellar Testnet";
    private config: any;

    constructor(config: any) {
        this.config = config;
        // In a real app, this would derive from the private key
        console.log("🛡️ [x402 Mock] GatewayClient initialized", config);
    }

    async getBalances(): Promise<any> {
        return {
            wallet: { formatted: "100.00", symbol: "USDC" },
            gateway: { 
                formattedAvailable: "50.00", 
                formattedLocked: "0.00",
                symbol: "USDC" 
            }
        };
    }

    async deposit(amount: string): Promise<any> {
        console.log(`🛡️ [x402 Mock] Depositing ${amount} USDC to Gateway`);
        return { depositTxHash: "0x_mock_deposit_" + Math.random().toString(36).substring(7) };
    }

    async pay<T = any>(url: string, options?: any): Promise<any> {
        console.log(`🛡️ [x402 Mock] Gasless payment to ${url}`);
        return {
            success: true,
            formattedAmount: "0.03",
            transactionHash: "0x_mock_pay_" + Math.random().toString(36).substring(7),
            data: {} as T
        };
    }

    async supports(url: string): Promise<boolean> {
        return true;
    }

    async withdraw(amount: string, options?: any): Promise<any> {
        console.log(`🛡️ [x402 Mock] Withdrawing ${amount} USDC from Gateway`);
        return { mintTxHash: "0x_mock_withdraw_" + Math.random().toString(36).substring(7) };
    }

    // Legacy method for compatibility
    async getBalance(address: string): Promise<string> {
        return "100.00";
    }

    async sendPayment(params: any): Promise<string> {
        return "0x_mock_tx_" + Math.random().toString(36).substring(7);
    }
}

// --- Server-side Mocks ---

export class BatchFacilitatorClient {
    constructor(config?: any) {
        console.log("🛡️ [x402 Mock] BatchFacilitatorClient initialized", config);
    }

    async getStatus(): Promise<any> {
        return { status: "active", batchesProcessed: 42 };
    }

    async processBatch(): Promise<any> {
        return { success: true, batchId: "batch_" + Date.now() };
    }

    async verify(payload: any, requirements: any): Promise<any> {
        console.log("🛡️ [x402 Mock] Verifying signature...");
        return { isValid: true, payer: "GAX..." };
    }

    async settle(payload: any, requirements: any): Promise<any> {
        console.log("🛡️ [x402 Mock] Settling payment...");
        return { success: true, id: "settlement_" + Date.now() };
    }
}

export function createGatewayMiddleware(config: any): any {
    console.log("🛡️ [x402 Mock] createGatewayMiddleware initialized", config);
    // Return an object with .require() that returns pass-through middleware
    return {
        require: (price: string) => {
            return (req: any, res: any, next: any) => {
                // In mock mode, all payments are "approved"
                next();
            };
        },
    };
}

// --- Types ---
export interface PaymentParams {
    to: string;
    amount: string;
    symbol: string;
}

