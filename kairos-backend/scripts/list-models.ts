import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("❌ No GEMINI_API_KEY found in .env");
        process.exit(1);
    }

    console.log("🔍 Fetching available models for your API key...");

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        const res = await fetch(url);
        const data: any = await res.json();

        if (data.models) {
            console.log("\n✅ AVAILABLE MODELS:");
            console.log("-------------------");
            data.models.forEach((m: any) => {
                const supportsGenerate = m.supportedGenerationMethods.includes("generateContent");
                if (supportsGenerate) {
                    console.log(`- ${m.name.replace("models/", "")} (${m.displayName})`);
                }
            });
            console.log("-------------------");
            console.log("\n💡 Tip: Use the model names above in your config.ts");
        } else {
            console.error("❌ No models found. Response:", JSON.stringify(data, null, 2));
        }
    } catch (err: any) {
        console.error("❌ Request failed:", err.message);
    }
}

listModels().catch((err) => console.error(err.message));
