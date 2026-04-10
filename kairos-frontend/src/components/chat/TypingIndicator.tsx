export function TypingIndicator() {
  return (
    <div className="flex gap-3 max-w-3xl mx-auto w-full px-4 animate-fade-in">
      {/* Bot avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 via-purple-600 to-blue-500 flex items-center justify-center shadow-[0_0_16px_hsl(258_85%_65%/0.3)]">
        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2" />
        </svg>
      </div>

      {/* Typing bubble */}
      <div className="flex items-center gap-4">
        {/* Dots */}
        <div className="glass-card px-4 py-3 flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary/60"
              style={{ animation: `typing-dot 1.2s ease-in-out ${i * 0.15}s infinite` }}
            />
          ))}
        </div>

        {/* Agent wave visualization */}
        <div className="hidden sm:flex items-center gap-0.5 h-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-primary/30"
              style={{
                height: '100%',
                animation: `agent-wave 1s ease-in-out ${i * 0.1}s infinite`,
              }}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground/60">Agents working...</span>
      </div>
    </div>
  );
}
