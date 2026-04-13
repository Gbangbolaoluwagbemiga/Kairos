/**
 * "searchWeb" helper.
 *
 * - If `BRAVE_SEARCH_API_KEY` is set, we use Brave Search API for real web results.
 * - Otherwise we fall back to a best-effort Groq answer (no live browsing).
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

const BRAVE_SEARCH_API_KEY = (process.env.BRAVE_SEARCH_API_KEY || "").trim();
const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

type BraveWebResult = {
    title?: string;
    url?: string;
    description?: string;
    extra_snippets?: string[];
};

function clampText(s: string, max: number) {
    const t = (s || "").trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
}

async function braveWebSearch(query: string): Promise<SearchResult | null> {
    if (!BRAVE_SEARCH_API_KEY) return null;

    const q = (query || "").trim();
    if (!q) return null;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    try {
        const buildUrl = (opts: { extraSnippets: boolean }) => {
            const url = new URL(BRAVE_WEB_SEARCH_URL);
            url.searchParams.set("q", q);
            url.searchParams.set("count", "8");
            url.searchParams.set("safesearch", "moderate");
            if (opts.extraSnippets) url.searchParams.set("extra_snippets", "true");
            return url.toString();
        };

        const fetchBrave = async (endpoint: string) =>
            await fetch(endpoint, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    "X-Subscription-Token": BRAVE_SEARCH_API_KEY,
                },
                signal: controller.signal,
            });

        let res = await fetchBrave(buildUrl({ extraSnippets: true }));
        if (res.status === 400) {
            // Some keys/plans reject extra_snippets — retry without it.
            res = await fetchBrave(buildUrl({ extraSnippets: false }));
        }

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[Search][Brave] HTTP ${res.status} — ${clampText(body, 220)}`);
            return null;
        }

        const data: any = await res.json();
        const results: BraveWebResult[] = data?.web?.results || data?.results || [];
        if (!Array.isArray(results) || results.length === 0) {
            console.warn("[Search][Brave] Empty results");
            return null;
        }

        const mapped = results
            .map((r) => {
                const title = String(r.title || "").trim();
                const urlStr = String(r.url || "").trim();
                const desc = String(r.description || "").trim();
                const extra = Array.isArray(r.extra_snippets) ? r.extra_snippets.map((x) => String(x || "").trim()).filter(Boolean) : [];
                const snippet = clampText([desc, ...extra].filter(Boolean).join(" — "), 900);
                if (!title || !urlStr) return null;
                return { title, url: urlStr, content: snippet };
            })
            .filter(Boolean) as SearchResult["results"];

        if (mapped.length === 0) return null;

        // Summarize strictly from retrieved snippets (prevents hallucinated “sources”).
        const completion = await groqChatComplete({
            messages: [
                {
                    role: "system",
                    content: [
                        "You are Kairos (crypto + Stellar).",
                        "",
                        "You will be given a user query and a set of web search snippets with URLs.",
                        "Write a concise answer grounded ONLY in those snippets.",
                        "",
                        "Rules:",
                        "- Do not invent facts, prices, dates, or URLs that are not supported by the snippets.",
                        "- If snippets are insufficient, say what is missing and ask 1 targeted follow-up question.",
                        "- Prefer bullet points. Keep it ~8–14 lines unless the user asked for more.",
                        "- Do not mention API keys, Brave, Groq, or internal tooling.",
                    ].join("\n"),
                },
                {
                    role: "user",
                    content: [
                        `Query: ${q}`,
                        "",
                        "Snippets:",
                        ...mapped.slice(0, 8).map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.url}\n${r.content || ""}`),
                    ].join("\n\n"),
                },
            ],
            tools: undefined,
            toolChoice: "none",
            temperature: 0.2,
            maxTokens: 750,
            timeoutMs: 18_000,
        });

        const answer = (completion.content || "").trim();
        if (!answer) return null;

        return { query: q, answer, results: mapped.slice(0, 8) };
    } catch (e: any) {
        console.warn("[Search][Brave] Failed:", e?.message || String(e));
        return null;
    } finally {
        clearTimeout(t);
    }
}

/**
 * Web search:
 * - Brave (live) when configured
 * - Groq fallback otherwise
 */
export async function searchWeb(query: string): Promise<SearchResult | null> {
    try {
        const brave = await braveWebSearch(query);
        if (brave) {
            console.log(`[Search] ✅ Brave web search: "${(query || "").slice(0, 80)}..." (${brave.results.length} results)`);
            return brave;
        }

        console.log(`[Search] 🧠 Groq fallback answer: "${query}"...`);
        const completion = await groqChatComplete({
            messages: [
                {
                    role: "system",
                    content:
                        [
                            "You are a crypto market assistant.",
                            "",
                            "CRITICAL:",
                            "- You do NOT have live web browsing in this call. Never claim you checked current prices/news.",
                            "- Still be decisive and helpful: give concrete options and a plan.",
                            "",
                            "If the user asks 'what coin should I buy' / 'what coin can I buy' / 'best coins to buy':",
                            "- Ask ONE clarifying question only if absolutely required; otherwise provide a shortlist.",
                            "- Provide a simple shortlist of 3-5 liquid coins with 1-line rationale each.",
                            "- Offer a conservative/moderate/aggressive split and a DCA plan.",
                            "- Include a brief risk disclaimer (1 line).",
                            "",
                            "Keep it concise (10-16 lines).",
                        ].join("\n"),
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
        // No live web in fallback mode — keep sources empty to avoid misleading citations.
        return { query, answer: text, results: [] };
    } catch (error: any) {
        console.error("[Search] Error:", error.message ?? error);
        return null;
    }
}
