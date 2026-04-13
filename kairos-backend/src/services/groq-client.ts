type GroqRole = "system" | "user" | "assistant" | "tool";

export type GroqChatMessage =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content?: string; tool_calls?: GroqToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

export type GroqTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
};

export type GroqToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

export type GroqChatCompletion = {
    content: string;
    toolCalls: GroqToolCall[];
};

function assertConfigured(): { apiKey: string; baseUrl: string; model: string } {
    const apiKey = (process.env.GROQ_API_KEY || "").trim();
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    const baseUrl = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
    const model = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
    return { apiKey, baseUrl, model };
}

export async function groqChatComplete(args: {
    messages: GroqChatMessage[];
    tools?: GroqTool[];
    toolChoice?: "auto" | "none";
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
}): Promise<GroqChatCompletion> {
    const { apiKey, baseUrl, model } = assertConfigured();
    const timeoutMs = Math.max(2500, Number(args.timeoutMs || 20000));

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const body: any = {
            model,
            messages: args.messages,
            temperature: args.temperature ?? 0.2,
            max_tokens: args.maxTokens ?? 900,
        };
        if (args.tools?.length) {
            body.tools = args.tools;
            body.tool_choice = args.toolChoice ?? "auto";
        }

        const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`[Groq] HTTP ${resp.status}: ${text || resp.statusText}`);
        }

        const json = (await resp.json()) as any;
        const msg = json?.choices?.[0]?.message;
        const content = String(msg?.content || "");
        const toolCalls: GroqToolCall[] = Array.isArray(msg?.tool_calls)
            ? msg.tool_calls.map((tc: any) => ({
                  id: String(tc.id),
                  type: "function",
                  function: {
                      name: String(tc.function?.name || ""),
                      arguments: String(tc.function?.arguments || "{}"),
                  },
              }))
            : [];
        return { content, toolCalls };
    } finally {
        clearTimeout(t);
    }
}

