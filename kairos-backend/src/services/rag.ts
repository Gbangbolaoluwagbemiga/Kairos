/**
 * Lightweight RAG: embed local markdown corpus with Gemini, retrieve by cosine similarity,
 * inject excerpts into the user turn (no separate vector DB).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { collectRemoteSourceUrls, fetchUrlAsPlainText } from "./rag-fetch.js";

export interface RagSource {
    source: string;
    score: number;
    excerpt: string;
    /** Original HTTPS URL when this chunk came from a live fetch */
    url?: string;
}

export interface RagAugmentation {
    prefixText: string;
    sources: RagSource[];
}

type IndexedChunk = {
    source: string;
    text: string;
    vec: Float32Array;
    url?: string;
};

/** Gemini Developer API: use `gemini-embedding-001` (not `text-embedding-004`, which is not exposed for embedContent on this API). */
function getEmbedModel(): string {
    return (process.env.KAIROS_RAG_EMBED_MODEL || "gemini-embedding-001").trim();
}

const DEFAULT_CORPUS_DIR = "rag-corpus";

function isRagDisabled(): boolean {
    const v = (process.env.KAIROS_RAG || "1").trim().toLowerCase();
    return v === "0" || v === "false" || v === "off";
}

function l2Normalize(values: number[]): Float32Array {
    let s = 0;
    for (const x of values) s += x * x;
    const inv = 1 / Math.sqrt(s || 1);
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = values[i] * inv;
    return out;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}

/** One retrieval slot per canonical page/file — avoids duplicate "open" links for the same page. */
function sourceDedupeKey(c: IndexedChunk): string {
    if (c.url) {
        try {
            const u = new URL(c.url);
            u.hash = "";
            u.search = "";
            const path = (u.pathname || "/").replace(/\/$/, "") || "/";
            return `url:${u.hostname.toLowerCase()}${path}`;
        } catch {
            return `url:${c.url}`;
        }
    }
    return `file:${c.source}`;
}

/**
 * When strict (default), only run RAG for questions about Kairos / deployment / x402 / docs —
 * not for generic market or Stellar questions (avoids the same web docs surfacing every time).
 * Set KAIROS_RAG_STRICT=0 to always attempt vector retrieval.
 */
function ragIntentMatchesUserQuery(q: string): boolean {
    if ((process.env.KAIROS_RAG_STRICT || "1").trim() === "0") return true;
    const s = q.toLowerCase();
    const checks: RegExp[] = [
        /\bkairos\b/,
        /\bx402\b/,
        /\b(soroban|stellar)\s+(agent\s+)?registry\b/,
        /\bagent\s+registry\b/,
        /\bAGENT_REGISTRY\b/i,
        /\b(railway|docker)\b.*\bkairos\b|\bkairos\b.*\b(railway|docker)\b/,
        /\bdeploy(ing|ment)?\b.*\bkairos\b/,
        /\bkairos\b.*\b(deploy|backend|env|environment)\b/,
        /\bmicropayment\b/,
        /\btrustline\b.*\b(usdc|kairos|x402|agent|treasury|circle)\b|\b(usdc|kairos|x402).*\btrustline\b/i,
        /\btreasury\b.*\b(pay|payment|agent)\b/,
        /\bpay(ing)?\s+agents?\b/,
        /\bgemini\s+api\s+key\b/,
        /\bhow\s+(does|do)\s+kairos\b/,
        /\bwhat\s+is\s+kairos\b/,
        /\bkairos\s+documentation\b/,
    ];
    return checks.some((re) => re.test(s));
}

function chunkMarkdown(text: string, maxLen = 900, minLen = 48): string[] {
    const parts = text.split(/\n{2,}/);
    const chunks: string[] = [];
    let buf = "";
    const pushBuf = () => {
        const t = buf.trim();
        if (t.length >= minLen) chunks.push(t);
        buf = "";
    };

    for (const p of parts) {
        const para = p.trim();
        if (!para) continue;
        if (para.length > maxLen) {
            pushBuf();
            for (let i = 0; i < para.length; i += maxLen - 100) {
                const slice = para.slice(i, i + maxLen).trim();
                if (slice.length >= minLen) chunks.push(slice);
            }
            continue;
        }
        if (buf.length + para.length + 2 <= maxLen) {
            buf = buf ? `${buf}\n\n${para}` : para;
        } else {
            pushBuf();
            buf = para;
        }
    }
    pushBuf();
    return chunks;
}

let ragClient: GoogleGenAI | null = null;
let indexPromise: Promise<IndexedChunk[] | null> | null = null;

function getRagClient(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) return null;
    if (!ragClient) ragClient = new GoogleGenAI({ apiKey: key });
    return ragClient;
}

async function listCorpusFiles(): Promise<string[]> {
    const extra = (process.env.KAIROS_RAG_FILES || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const roots = new Set<string>();
    const cwd = process.cwd();
    roots.add(path.join(cwd, process.env.KAIROS_RAG_DIR?.trim() || DEFAULT_CORPUS_DIR));

    const files: string[] = [];
    for (const dir of roots) {
        try {
            const names = await readdir(dir);
            for (const n of names) {
                if (n.endsWith(".md")) files.push(path.join(dir, n));
            }
        } catch {
            // missing dir is OK
        }
    }
    for (const rel of extra) {
        const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
        files.push(abs);
    }
    return [...new Set(files)];
}

async function loadChunksFromDisk(): Promise<Array<{ source: string; text: string; url?: string }>> {
    const paths = await listCorpusFiles();
    const out: Array<{ source: string; text: string; url?: string }> = [];
    for (const fp of paths) {
        try {
            const raw = await readFile(fp, "utf8");
            const base = path.basename(fp);
            // Skip URL list files — handled by loadChunksFromRemote
            if (base === "sources.urls") continue;
            for (const text of chunkMarkdown(raw)) {
                out.push({ source: base, text });
            }
        } catch {
            console.warn(`[RAG] skip unreadable corpus file: ${fp}`);
        }
    }
    return out;
}

async function loadChunksFromRemote(): Promise<Array<{ source: string; text: string; url?: string }>> {
    const urls = await collectRemoteSourceUrls(process.cwd());
    if (urls.length === 0) return [];

    const out: Array<{ source: string; text: string; url?: string }> = [];
    let ok = 0;
    for (const u of urls) {
        const meta = await fetchUrlAsPlainText(u);
        if (!meta) continue;
        ok++;
        for (const text of chunkMarkdown(meta.text)) {
            out.push({ source: `web · ${meta.label}`, text, url: meta.url });
        }
        // Be polite to origin servers when indexing many URLs
        await new Promise((r) => setTimeout(r, Number(process.env.KAIROS_RAG_FETCH_GAP_MS || 250)));
    }
    console.log(`[RAG] remote: ${ok}/${urls.length} URLs OK → ${out.length} chunks`);
    return out;
}

async function embedTexts(
    ai: GoogleGenAI,
    texts: string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const res = await ai.models.embedContent({
        model: getEmbedModel(),
        contents: texts,
        config: { taskType },
    });
    const list = res.embeddings || [];
    return list.map((e) => l2Normalize(e.values || []));
}

async function buildIndex(ai: GoogleGenAI): Promise<IndexedChunk[] | null> {
    const [localPieces, remotePieces] = await Promise.all([loadChunksFromDisk(), loadChunksFromRemote()]);
    const pieces = [...localPieces, ...remotePieces];
    if (pieces.length === 0) {
        console.warn(
            "[RAG] no corpus chunks (add .md under rag-corpus/, set KAIROS_RAG_URLS / sources.urls, or KAIROS_RAG_FILES)"
        );
        return null;
    }

    const batchSize = Math.max(1, Math.min(16, Number(process.env.KAIROS_RAG_EMBED_BATCH || 12)));
    const indexed: IndexedChunk[] = [];

    for (let i = 0; i < pieces.length; i += batchSize) {
        const batch = pieces.slice(i, i + batchSize);
        const vecs = await embedTexts(
            ai,
            batch.map((b) => b.text),
            "RETRIEVAL_DOCUMENT"
        );
        for (let j = 0; j < batch.length; j++) {
            indexed.push({
                source: batch[j].source,
                text: batch[j].text,
                vec: vecs[j],
                url: batch[j].url,
            });
        }
    }

    console.log(
        `[RAG] indexed ${indexed.length} chunks (${localPieces.length} local + ${remotePieces.length} remote text splits)`
    );
    return indexed;
}

function ensureIndex(ai: GoogleGenAI): Promise<IndexedChunk[] | null> {
    if (!indexPromise) {
        indexPromise = buildIndex(ai).catch((e) => {
            console.error("[RAG] index build failed:", e);
            return null;
        });
    }
    return indexPromise;
}

/**
 * Build / wait for the embedding index in the background so the first chat query
 * does not pay cold-start latency inside the per-request RAG budget.
 */
export function warmRagIndex(): void {
    if (isRagDisabled()) return;
    const ai = getRagClient();
    if (!ai) return;
    void ensureIndex(ai)
        .then((idx) => {
            if (idx?.length) console.log(`[RAG] corpus index ready (${idx.length} chunks)`);
        })
        .catch(() => undefined);
}

/**
 * Returns a prefix block for the current user turn and structured sources for the API/UI.
 * Null means RAG was skipped or nothing relevant was found.
 */
export async function retrieveRagAugmentation(userPrompt: string): Promise<RagAugmentation | null> {
    if (isRagDisabled()) return null;

    const trimmed = (userPrompt || "").trim();
    if (trimmed.length < 8) return null;

    if (!ragIntentMatchesUserQuery(trimmed)) {
        return null;
    }

    const ai = getRagClient();
    if (!ai) return null;

    // Cold-start index building can take several seconds (many embed calls). It must NOT
    // share the same wall-clock budget as query embedding + scoring, or RAG almost always loses to timeout.
    const index = await ensureIndex(ai);
    if (!index || index.length === 0) return null;

    const budgetMs = Math.max(400, Number(process.env.KAIROS_RAG_BUDGET_MS || 2200));

    const retrieveOnly = async (): Promise<RagAugmentation | null> => {
        const [qVec] = await embedTexts(ai, [trimmed], "RETRIEVAL_QUERY");
        if (!qVec || qVec.length === 0) return null;

        const minScore = Number(process.env.KAIROS_RAG_MIN_SCORE || 0.32);
        const poolLimit = Math.max(8, Math.min(100, Number(process.env.KAIROS_RAG_TOP_K || 24)));
        const maxInPrompt = Math.max(1, Math.min(5, Number(process.env.KAIROS_RAG_MAX_CHUNKS || 3)));

        const ranked = index
            .map((c) => ({ c, score: cosineSim(qVec, c.vec) }))
            .filter((x) => x.score >= minScore)
            .sort((a, b) => b.score - a.score);

        if (ranked.length === 0) return null;

        // Scan a pool of top matches, then keep the best chunk per canonical URL/file so citations are not duplicated.
        const pool = ranked.slice(0, Math.min(poolLimit, ranked.length));

        const bestPerKey = new Map<string, { c: IndexedChunk; score: number }>();
        for (const x of pool) {
            const key = sourceDedupeKey(x.c);
            const prev = bestPerKey.get(key);
            if (!prev || x.score > prev.score) bestPerKey.set(key, x);
        }

        let diverse = [...bestPerKey.values()].sort((a, b) => b.score - a.score);

        // “What is Kairos?”-style questions are about the product; don’t inject arXiv / Gemini
        // embedding guide chunks just because vectors are loosely similar to “AI”.
        const productKairosQuestion =
            /\b(what|who)\s+(is|'s)\s+kairos\b|\bexplain\s+kairos\b|\bkairos\s+buddy\b|\babout\s+kairos\b|\btell\s+me\s+about\s+kairos\b/i.test(
                trimmed
            );
        if (productKairosQuestion) {
            const peripheral = (x: { c: IndexedChunk }) => {
                const u = x.c.url || "";
                return (
                    u.includes("arxiv.org") ||
                    (u.includes("ai.google.dev") && u.includes("embeddings"))
                );
            };
            const focused = diverse.filter((x) => !peripheral(x));
            if (focused.length > 0) diverse = focused;
        }

        const picked = diverse.slice(0, maxInPrompt);
        const lines: string[] = [
            "### Retrieved knowledge (internal)",
            "Use the excerpts below. Each **[Source N]** is a **different page or file** (same URL is not repeated). Cite with **[Source N]** when you use them. Live market data still requires your tools.",
            "",
        ];

        const sources: RagSource[] = [];
        picked.forEach((x, i) => {
            const n = i + 1;
            const linkLine = x.c.url ? `\nCanonical URL: ${x.c.url}` : "";
            lines.push(`**[Source ${n}]** (${x.c.source})${linkLine}`);
            lines.push(x.c.text);
            lines.push("");
            const excerpt = x.c.text.length > 220 ? `${x.c.text.slice(0, 217)}…` : x.c.text;
            sources.push({
                source: x.c.source,
                score: Math.round(x.score * 1000) / 1000,
                excerpt,
                url: x.c.url,
            });
        });

        return { prefixText: lines.join("\n"), sources };
    };

    const raced = await Promise.race([
        retrieveOnly()
            .then((r) => ({ kind: "done" as const, r }))
            .catch((e) => {
                console.error("[RAG] retrieve failed:", e);
                return { kind: "done" as const, r: null };
            }),
        new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), budgetMs)),
    ]);

    if (raced.kind === "timeout") {
        console.warn(`[RAG] query embed/score timed out after ${budgetMs}ms`);
        return null;
    }

    return raced.r;
}
