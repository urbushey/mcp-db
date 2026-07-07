import { createRoot } from "react-dom/client";
import { useState, useEffect, useCallback } from "react";

// ---- Types ----

type User = { sub: string; email: string; name?: string };
type DbInfo = { name: string; description: string | null; tableCount: number; sizeBytes: number };

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
      className="ml-2 px-3 py-1 text-xs rounded-md bg-white/10 hover:bg-white/20 transition-colors font-medium"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

// ---- Landing Page ----

function Landing() {
  const mcpUrl = getMcpUrl();
  const error = new URLSearchParams(window.location.search).get("error");

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg tracking-tight">mcp-db</span>
        <a
          href="/dashboard"
          className="text-sm text-zinc-400 hover:text-white transition-colors"
        >
          Dashboard →
        </a>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 max-w-xl mx-auto w-full">
        {error && (
          <div className="w-full mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            Authentication error: {error.replace(/_/g, " ")}
          </div>
        )}

        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-3 leading-tight">
            Your AI keeps track of your data
          </h1>
          <p className="text-zinc-400 text-lg">
            Connect mcp-db to Claude. Talk to your databases in plain language.
            Never think about SQL.
          </p>
        </div>

        {/* Install steps */}
        <div className="w-full mb-10">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-5">
            3-step install
          </h2>
          <ol className="space-y-4">
            {[
              {
                n: 1,
                title: "Open Claude Settings → Integrations",
                detail: "Works on claude.ai (web, iOS, Android) and Claude Desktop.",
              },
              {
                n: 2,
                title: "Add MCP Server — paste this URL",
                detail: null,
                url: mcpUrl,
              },
              {
                n: 3,
                title: "Authorize — Claude will prompt you to log in",
                detail: "A browser window opens for sign-in. Takes about 30 seconds.",
              },
            ].map((step) => (
              <li key={step.n} className="flex gap-4 items-start">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                  {step.n}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{step.title}</p>
                  {step.detail && <p className="text-zinc-500 text-xs mt-0.5">{step.detail}</p>}
                  {step.url && (
                    <div className="mt-2 flex items-center bg-zinc-900 border border-white/10 rounded-lg px-3 py-2">
                      <code className="text-xs text-zinc-300 flex-1 truncate">{step.url}</code>
                      <CopyButton text={step.url} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* After install */}
        <div className="w-full bg-zinc-900 border border-white/10 rounded-xl p-5">
          <p className="text-sm font-semibold mb-3">Then ask Claude:</p>
          <ul className="space-y-2">
            {[
              '"Create a database to track my meals"',
              '"Log breakfast: oatmeal and coffee"',
              '"Show me what I ate this week"',
            ].map((prompt) => (
              <li key={prompt} className="text-sm text-zinc-400 font-mono bg-zinc-950 rounded px-3 py-2">
                {prompt}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-8 text-zinc-600 text-sm text-center">
          Already connected?{" "}
          <a href="/dashboard" className="text-zinc-400 hover:text-white transition-colors underline underline-offset-2">
            View your dashboard →
          </a>
        </p>
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

// ---- Dashboard ----

function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [databases, setDatabases] = useState<DbInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

        const dbRes = await fetch("/api/databases");
        if (!dbRes.ok) throw new Error("Failed to load databases");
        const dbs = (await dbRes.json()) as DbInfo[];
        setDatabases(dbs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
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

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <a href="/" className="font-semibold text-lg tracking-tight hover:text-zinc-300 transition-colors">
          mcp-db
        </a>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400 hidden sm:block">{user?.email}</span>
          <a
            href="/auth/logout"
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Sign out
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10 space-y-8">
        {/* Status + MCP URL */}
        <section className="bg-zinc-900 border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
            <span className="text-sm font-medium text-emerald-400">Connected</span>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1.5 font-medium uppercase tracking-wider">MCP Endpoint</p>
            <div className="flex items-center bg-zinc-950 border border-white/10 rounded-lg px-3 py-2">
              <code className="text-xs text-zinc-300 flex-1 truncate">{mcpUrl}</code>
              <CopyButton text={mcpUrl} />
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              Add this URL to Claude Settings → Integrations → MCP Server
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
            <div className="bg-zinc-900 border border-white/10 rounded-xl p-8 text-center">
              <p className="text-zinc-400 mb-2 text-sm">No databases yet</p>
              <p className="text-zinc-600 text-xs">
                Ask Claude: <span className="font-mono">"Create a database to track my meals"</span>
              </p>
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
