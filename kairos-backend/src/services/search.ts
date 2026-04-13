/**
 * "searchWeb" helper.
 *
 * Previously this used Gemini Google Search grounding. After migrating to Groq,
 * we keep the same interface but return a best-effort answer from Groq's model
 * (no live web browsing). Callers must handle null gracefully.
 */

import { groqChatComplete } from "./groq-client.js";

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
 * Best-effort "web search" via Groq (no grounding).
 * Returns null on any failure — callers must handle gracefully.
 */
export async function searchWeb(query: string): Promise<SearchResult | null> {
    try {
        console.log(`[Search] 🧠 Groq best-effort answer: "${query}"...`);
        const completion = await groqChatComplete({
            messages: [
                {
                    role: "system",
                    content:
                        "You are a crypto/tech research assistant. Answer succinctly. If you are unsure, say so. Do not claim you performed live web browsing. Provide 2-4 likely pointers (site names) as suggestions if helpful.",
                },
                { role: "user", content: query },
            ],
            tools: undefined,
            toolChoice: "none",
            temperature: 0.2,
            maxTokens: 700,
            timeoutMs: 15000,
        });

        const text = completion.content || "";
        const sources: Array<{ title: string; url: string; content: string }> = [];
        if (text) sources.push({ title: "Groq (no live web)", url: "", content: text.slice(0, 220) });
        return { query, answer: text, results: sources };
    } catch (error: any) {
        console.error("[Search] Error:", error.message ?? error);
        return null;
    }
}
