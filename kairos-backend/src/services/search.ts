/**
 * Web search using @google/genai with Google Search grounding.
 * Uses the new SDK (already installed for RAG embeddings) — completely
 * isolated from the main @google/generative-ai chat session so it
 * cannot crash the primary response flow.
 */

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export interface SearchResult {
    query: string;
    answer: string;
    results: Array<{
        title: string;
        url: string;
        content: string;
    }>;
}

/**
 * Search the web using Gemini Google Search grounding via the new @google/genai SDK.
 * Returns null on any failure — callers must handle gracefully.
 */
export async function searchWeb(query: string): Promise<SearchResult | null> {
    if (!GEMINI_API_KEY) {
        console.error("[Search] GEMINI_API_KEY is not set");
        return null;
    }

    try {
        console.log(`[Search] 🔍 Google Search grounding: "${query}"...`);

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        const response = await Promise.race([
            ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: query,
                config: {
                    tools: [{ googleSearch: {} }],
                },
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("search_timeout")), 15000)
            ),
        ]);

        const text = response.text ?? "";

        // Extract grounding citations
        const sources: Array<{ title: string; url: string; content: string }> = [];
        const chunks = (response as any).candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        for (const chunk of chunks) {
            if (chunk.web) {
                sources.push({
                    title: chunk.web.title || chunk.web.uri || "Web",
                    url: chunk.web.uri || "",
                    content: chunk.web.title || "",
                });
            }
        }
        if (!sources.length) {
            sources.push({ title: "Gemini Search", url: "", content: text });
        }

        return { query, answer: text, results: sources };
    } catch (error: any) {
        console.error("[Search] Error:", error.message ?? error);
        return null;
    }
}
