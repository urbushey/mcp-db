import { createRoot } from "react-dom/client";
import { useState, useEffect, useCallback, useRef } from "react";

// ---- Types ----

type User = { sub: string; email: string; name?: string };
type DbInfo = { name: string; description: string | null; tableCount: number; sizeBytes: number };
type Status = { connected: boolean; lastSeen: number | null; dbCount: number };

// ---- Utilities ----

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMcpUrl(): string {
  return `${window.location.origin}/mcp`;
}

// ---- CopyButton ----

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard errors */
    }
  }, [text]);

  return (
    <button
      onClick={copy}
      className="ml-2 px-3 py-1 text-xs rounded-md bg-white/10 hover:bg-white/20 transition-colors font-medium flex-shrink-0"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function CopyBox({ text }: { text: string }) {
  return (
    <div className="flex items-center bg-zinc-950 border border-white/10 rounded-lg px-3 py-2">
      <code className="text-xs text-zinc-300 flex-1 truncate">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

// ---- Per-client setup instructions ----

type ClientGuide = {
  id: string;
  label: string;
  steps: Array<{ text: string; copy?: string }>;
  note?: string;
};

function buildClientGuides(mcpUrl: string): ClientGuide[] {
  return [
    {
      id: "web",
      label: "claude.ai",
      steps: [
        { text: "Open claude.ai and click your initials (bottom-left) → Settings → Connectors" },
        { text: "Click “Add custom connector”" },
        { text: "Paste this URL and click Add:", copy: mcpUrl },
        { text: "Click “Connect” next to instant-db, then sign in when the login window appears" },
      ],
      note: "Takes about a minute. Once connected here, it works in every claude.ai chat.",
    },
    {
      id: "mobile",
      label: "iPhone / Android",
      steps: [
        { text: "Set it up on claude.ai in any browser first (see the claude.ai tab — one minute)" },
        { text: "Open the Claude app — connectors sync to your phone automatically" },
        { text: "In a chat, tap the sliders icon next to the message box and make sure instant-db is on" },
      ],
      note: "No app configuration needed — connecting on claude.ai covers your phone too.",
    },
    {
      id: "desktop",
      label: "Claude Desktop",
      steps: [
        { text: "Open Claude Desktop → Settings → Connectors" },
        { text: "Click “Add custom connector”" },
        { text: "Paste this URL and click Add:", copy: mcpUrl },
        { text: "Click “Connect” and sign in when prompted" },
      ],
    },
    {
      id: "code",
      label: "Claude Code",
      steps: [
        { text: "Run this in your terminal:", copy: `claude mcp add --transport http instant-db ${mcpUrl}` },
        { text: "Start claude and run /mcp, then pick instant-db to sign in" },
      ],
    },
  ];
}

function ClientSetupTabs({ mcpUrl }: { mcpUrl: string }) {
  const guides = buildClientGuides(mcpUrl);
  const [active, setActive] = useState(guides[0]!.id);
  const guide = guides.find((g) => g.id === active) ?? guides[0]!;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {guides.map((g) => (
          <button
            key={g.id}
            onClick={() => setActive(g.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              g.id === active
                ? "bg-white text-zinc-950"
                : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <ol className="space-y-3">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold mt-0.5">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-300">{step.text}</p>
              {step.copy && (
                <div className="mt-2">
                  <CopyBox text={step.copy} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {guide.note && <p className="mt-4 text-xs text-zinc-500">{guide.note}</p>}
    </div>
  );
}

// ---- Starter prompts ----

const STARTER_PROMPTS = [
  "Create a database to track my meals",
  "Track my workouts — exercises, sets, reps, and weight",
  "Keep a reading list for me: title, author, status, and my rating",
];

function StarterPrompts({ title = "Now say this to Claude:" }: { title?: string }) {
  return (
    <div>
      <p className="text-sm font-semibold mb-3">{title}</p>
      <ul className="space-y-2">
        {STARTER_PROMPTS.map((prompt) => (
          <li
            key={prompt}
            className="flex items-center text-sm text-zinc-300 font-mono bg-zinc-950 border border-white/10 rounded-lg px-3 py-2"
          >
            <span className="flex-1 min-w-0 truncate">"{prompt}"</span>
            <CopyButton text={prompt} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-zinc-500">
        Copy one, paste it into any Claude chat, and watch your first database appear below.
      </p>
    </div>
  );
}

// ---- Live connection status (polls /api/status until Claude connects) ----

function useConnectionStatus(pollMs = 3000) {
  const [status, setStatus] = useState<Status | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const wasConnected = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const next = (await res.json()) as Status;
          if (!cancelled) {
            if (wasConnected.current === false && next.connected) setJustConnected(true);
            wasConnected.current = next.connected;
            setStatus(next);
            if (next.connected) return; // Connected — stop polling.
          }
        }
      } catch {
        /* transient network error — keep polling */
      }
      if (!cancelled) timer = setTimeout(poll, pollMs);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return { status, justConnected };
}

// ---- Landing Page ----

function Landing() {
  const error = new URLSearchParams(window.location.search).get("error");

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg tracking-tight">instant-db</span>
        <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white transition-colors">
          Sign in →
        </a>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 max-w-xl mx-auto w-full">
        {error && (
          <div className="w-full mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            Authentication error: {error.replace(/_/g, " ")}
          </div>
        )}

        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-3 leading-tight">Give Claude a memory</h1>
          <p className="text-zinc-400 text-lg">
            Track meals, workouts, expenses — anything — just by talking to Claude. Your data
            persists across every chat and every device. No SQL, no spreadsheets, no setup.
          </p>
        </div>

        <a
          href="/auth/login"
          className="mb-4 px-8 py-3 bg-white text-zinc-950 rounded-full font-semibold text-sm hover:bg-zinc-200 transition-colors"
        >
          Get started — it's free
        </a>
        <p className="text-zinc-600 text-xs mb-12">
          Two minutes from here to your first database. We'll walk you through it.
        </p>

        {/* How it works */}
        <div className="w-full mb-10">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-5">
            How it works
          </h2>
          <ol className="space-y-4">
            {[
              { n: 1, title: "Create your free account", detail: "One click — sign in with the button above." },
              { n: 2, title: "Add instant-db to Claude", detail: "Paste one URL into Claude's settings. We show you exactly where, for every device." },
              { n: 3, title: "Just talk", detail: '"Track my workouts." Claude builds the database and remembers everything, forever.' },
            ].map((step) => (
              <li key={step.n} className="flex gap-4 items-start">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                  {step.n}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{step.title}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Works everywhere */}
        <div className="w-full bg-zinc-900 border border-white/10 rounded-xl p-5 text-center">
          <p className="text-sm text-zinc-400">
            Works with <span className="text-zinc-200">claude.ai</span>,{" "}
            <span className="text-zinc-200">Claude on iPhone &amp; Android</span>,{" "}
            <span className="text-zinc-200">Claude Desktop</span>, and{" "}
            <span className="text-zinc-200">Claude Code</span>.
          </p>
        </div>
      </main>

      <footer className="border-t border-white/10 px-6 py-4 text-center text-zinc-600 text-xs">
        <a
          href="https://github.com/urbushey/mcp-db"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-400 transition-colors"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

// ---- Onboarding (dashboard, before Claude has ever connected) ----

function OnboardingChecklist({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">One step left</h1>
        <p className="text-zinc-400 text-sm">
          Your account is ready. Now connect Claude — pick your device below and follow along.
          This page updates by itself the moment Claude connects.
        </p>
      </div>

      <section className="bg-zinc-900 border border-white/10 rounded-xl p-5">
        <ClientSetupTabs mcpUrl={mcpUrl} />
      </section>

      {/* Live status */}
      <div className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-5 py-4">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
        </span>
        <div>
          <p className="text-sm font-medium text-amber-300">Waiting for Claude to connect…</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            After you authorize in Claude, send it any message that uses your data — this turns
            green automatically.
          </p>
        </div>
      </div>

      <section className="bg-zinc-900 border border-white/10 rounded-xl p-5">
        <StarterPrompts title="Once connected, say this to Claude:" />
      </section>
    </div>
  );
}

// ---- Dashboard ----

function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [databases, setDatabases] = useState<DbInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, justConnected } = useConnectionStatus();
  const mcpUrl = getMcpUrl();

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/me");
        if (meRes.status === 401) {
          // Not logged in — send to login
          window.location.href = "/auth/login";
          return;
        }
        if (!meRes.ok) throw new Error("Failed to load user");
        const me = (await meRes.json()) as User;
        setUser(me);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  // Refresh the database list whenever connected (first connect, or new
  // databases created since the last poll).
  useEffect(() => {
    if (!status?.connected) return;
    let cancelled = false;
    async function loadDbs() {
      try {
        const dbRes = await fetch("/api/databases");
        if (dbRes.ok && !cancelled) setDatabases((await dbRes.json()) as DbInfo[]);
      } catch {
        /* ignore */
      }
    }
    void loadDbs();
    const timer = setInterval(loadDbs, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status?.connected]);

  if (loading || (user && status === null)) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/" className="text-sm text-zinc-400 hover:text-white">← Back to home</a>
        </div>
      </div>
    );
  }

  const connected = status?.connected ?? false;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <a href="/" className="font-semibold text-lg tracking-tight hover:text-zinc-300 transition-colors">
          instant-db
        </a>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400 hidden sm:block">{user?.email}</span>
          <a href="/auth/logout" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
            Sign out
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10 space-y-8">
        {!connected ? (
          <OnboardingChecklist mcpUrl={mcpUrl} />
        ) : (
          <>
            {justConnected && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-4">
                <p className="text-emerald-300 font-semibold text-sm">🎉 Claude is connected!</p>
                <p className="text-zinc-400 text-xs mt-1">
                  You're all set — everything Claude stores shows up below, on every device.
                </p>
              </div>
            )}

            {/* Status + MCP URL */}
            <section className="bg-zinc-900 border border-white/10 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
                <span className="text-sm font-medium text-emerald-400">Connected</span>
                {status?.lastSeen && (
                  <span className="text-xs text-zinc-600 ml-1">
                    · last request {new Date(status.lastSeen).toLocaleString()}
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1.5 font-medium uppercase tracking-wider">MCP Endpoint</p>
                <CopyBox text={mcpUrl} />
                <p className="text-xs text-zinc-600 mt-2">
                  Add this to another device any time — same steps, same data.
                </p>
              </div>
            </section>

            {/* Databases */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Your Databases</h2>
                {databases.length > 0 && (
                  <span className="text-xs text-zinc-500">{databases.length} total</span>
                )}
              </div>

              {databases.length === 0 ? (
                <div className="bg-zinc-900 border border-white/10 rounded-xl p-6">
                  <StarterPrompts />
                </div>
              ) : (
                <ul className="space-y-2">
                  {databases.map((db) => (
                    <li
                      key={db.name}
                      className="bg-zinc-900 border border-white/10 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{db.name}</p>
                        {db.description && (
                          <p className="text-zinc-500 text-xs mt-0.5 truncate">{db.description}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 text-xs text-zinc-500 space-y-0.5">
                        <p>{db.tableCount} {db.tableCount === 1 ? "table" : "tables"}</p>
                        <p>{formatBytes(db.sizeBytes)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Prompts */}
            {databases.length > 0 && (
              <section className="bg-zinc-900 border border-white/10 rounded-xl p-5">
                <p className="text-sm font-medium mb-3 text-zinc-400">Try asking Claude</p>
                <ul className="space-y-2">
                  {[
                    '"List my databases"',
                    '"Add a new entry to my [database name]"',
                    '"Show me everything in [database name] from this week"',
                  ].map((p) => (
                    <li key={p} className="text-xs text-zinc-500 font-mono">
                      {p}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---- Router ----

function App() {
  const path = window.location.pathname;
  if (path === "/dashboard") return <Dashboard />;
  return <Landing />;
}

// ---- Mount ----

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
