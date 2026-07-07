import { createRoot } from "react-dom/client";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";

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

// ---- Landing Page (single-page scroller — copy source: SPECS/homepage-copy.md) ----

const GITHUB_URL = "https://github.com/urbushey/mcp-db";

function BigTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[0.95] ${className}`}>
      {children}
    </h2>
  );
}

function CtaButton({ href, children, inverted = false }: { href: string; children: ReactNode; inverted?: boolean }) {
  return (
    <a
      href={href}
      className={`inline-block px-8 py-4 rounded-full font-bold text-base transition-colors ${
        inverted
          ? "bg-zinc-950 text-white hover:bg-zinc-800"
          : "bg-white text-zinc-950 hover:bg-emerald-300"
      }`}
    >
      {children}
    </a>
  );
}

const TRACK_EXAMPLES = [
  ["🧗", "climbing sends by grade and gym"],
  ["🍞", "sourdough feeds and rise times"],
  ["🏋️", "every set, rep, and PR"],
  ["📚", "books started vs. actually finished"],
  ["🍅", "which tomato varieties survived July"],
  ["🏠", "homelab uptime incidents"],
  ["💸", "the kid's allowance ledger"],
  ["🍷", "wines you liked before you forgot them"],
  ["⛽", "fuel economy per fill-up"],
] as const;

const FAQ = [
  {
    q: "Is my data locked in?",
    a: "It's a SQLite file. The most portable database format in existence. Cloud data export lands before we charge anyone a dollar — that's a hard rule in our billing spec, which is public, in the repo.",
  },
  {
    q: "What if you shut down?",
    a: "You self-host the same MIT-licensed server the cloud runs, and your data is standard SQLite. Worst case, you lose convenience, not data.",
  },
  {
    q: "Why not just use Notion / a spreadsheet?",
    a: "Because you won't open it. The point is telling Claude mid-conversation and moving on with your life.",
  },
  {
    q: "Who can see my data?",
    a: "Cloud data lives in per-user isolated storage, over TLS, behind OAuth. It's a beta run by one person — read the code and threat-model accordingly. Paranoid? Self-host. We'll help.",
  },
  {
    q: "What's an MCP server?",
    a: "The plug-in standard for Claude (and other AI clients). instant-db speaks it over stdio locally or HTTP remotely.",
  },
] as const;

function Landing() {
  const error = new URLSearchParams(window.location.search).get("error");

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Sticky nav */}
      <header className="sticky top-0 z-50 bg-zinc-950/90 backdrop-blur border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <span className="font-black text-lg tracking-tight">instant-db</span>
        <nav className="flex items-center gap-5 text-sm">
          <a href="#self-host" className="text-zinc-400 hover:text-white transition-colors hidden sm:block">
            Self-host
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white transition-colors">
            GitHub
          </a>
          <a href="/dashboard" className="text-white font-semibold hover:text-emerald-300 transition-colors">
            Sign in →
          </a>
        </nav>
      </header>

      {error && (
        <div className="max-w-3xl mx-auto mt-6 px-4 py-3 mx-6 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          Authentication error: {error.replace(/_/g, " ")}
        </div>
      )}

      {/* Screen 1 — Problem */}
      <section className="min-h-[92vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight leading-[0.95] max-w-4xl">
          CLAUDE FORGETS EVERYTHING.
        </h1>
        <p className="mt-8 text-lg sm:text-xl text-zinc-400 max-w-xl leading-relaxed">
          Every chat starts from zero. Your workout log. Your reading list. The name of your
          sourdough starter. Gone.
        </p>
        <p className="mt-6 text-xl sm:text-2xl font-bold max-w-xl">
          instant-db is a real database for Claude.
          <br />
          Talk to it once. It remembers forever.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <CtaButton href="/auth/login">Give Claude a memory →</CtaButton>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 rounded-full font-bold text-base border border-white/20 hover:border-white/60 transition-colors"
          >
            Read the source
          </a>
        </div>
        <p className="mt-6 text-xs text-zinc-600 tracking-wide">
          Free while in beta · MIT-licensed · it's just SQLite
        </p>
      </section>

      {/* Screen 2 — Transcript */}
      <section className="px-6 py-24 border-t border-white/10">
        <div className="max-w-2xl mx-auto">
          <p className="text-sm font-black tracking-widest text-emerald-400 uppercase mb-10">
            This is the whole product.
          </p>
          <div className="space-y-4 font-mono text-sm sm:text-base">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl rounded-bl-sm px-5 py-4">
              <p className="text-zinc-500 text-xs mb-1">you</p>
              <p>track my climbing sends — grade, gym, flash or not</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl rounded-br-sm px-5 py-4 ml-6 sm:ml-12">
              <p className="text-emerald-400/60 text-xs mb-1">claude</p>
              <p>
                <span className="inline-block bg-zinc-950 border border-white/10 rounded px-2 py-0.5 text-xs text-emerald-300 mr-2">
                  create_database("climbing") ✓
                </span>
                I'll log grade, gym, attempts, and date.
              </p>
            </div>
            <div className="bg-zinc-900 border border-white/10 rounded-2xl rounded-bl-sm px-5 py-4">
              <p className="text-zinc-500 text-xs mb-1">you · three weeks later · from your phone, in line for coffee</p>
              <p>what's my hardest send this month?</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl rounded-br-sm px-5 py-4 ml-6 sm:ml-12">
              <p className="text-emerald-400/60 text-xs mb-1">claude</p>
              <p>V6 at Movement, flashed on the 14th. You're two grades up from May.</p>
            </div>
          </div>
          <p className="mt-10 text-zinc-400 text-lg">
            No schema. No SQL. No app to check. You talk, Claude does the typing.
          </p>
        </div>
      </section>

      {/* Screen 3 — Trust (inverted) */}
      <section className="bg-white text-zinc-950 px-6 py-32">
        <div className="max-w-3xl mx-auto">
          <BigTitle>IT'S JUST SQLITE.</BigTitle>
          <p className="mt-8 text-lg sm:text-xl leading-relaxed text-zinc-700 max-w-2xl">
            No vector store. No embeddings pipeline. No "memory layer" that half-remembers your
            grocery list as a vibe.
          </p>
          <p className="mt-6 text-lg sm:text-xl leading-relaxed text-zinc-700 max-w-2xl">
            Rows. Columns. A <code className="bg-zinc-100 border border-zinc-300 rounded px-1.5 py-0.5 text-base">.sqlite</code> file
            with your name on it. Open it in anything. Take it anywhere. It'll outlive us — SQLite
            files from 2004 still open fine, and that's the format your data lives in.
          </p>
        </div>
      </section>

      {/* Screen 4 — Self-host */}
      <section id="self-host" className="px-6 py-32 border-t border-white/10">
        <div className="max-w-3xl mx-auto">
          <BigTitle>
            SELF-HOST IT. <span className="text-emerald-400">SERIOUSLY.</span>
          </BigTitle>
          <p className="mt-8 text-lg text-zinc-400 leading-relaxed max-w-2xl">
            This is not a trick. The server is MIT-licensed and runs on your laptop in about two
            minutes. If you live in Claude Code or Claude Desktop, you may never need us:
          </p>
          <div className="mt-8 bg-zinc-900 border border-white/10 rounded-xl p-5 font-mono text-sm text-zinc-300 overflow-x-auto">
            <p><span className="text-zinc-600">$</span> git clone {GITHUB_URL}</p>
            <p><span className="text-zinc-600">$</span> cd mcp-db && bun install</p>
            <p><span className="text-zinc-600">$</span> claude mcp add instant-db -- bun run src/index.ts</p>
          </div>
          <p className="mt-8 text-lg text-zinc-400 leading-relaxed max-w-2xl">
            That's the entire install. Your data never leaves your machine. We put this on the
            homepage because you'd have found it anyway.
          </p>
        </div>
      </section>

      {/* Screen 5 — Conversion */}
      <section className="px-6 py-32 border-t border-white/10 bg-zinc-900/40">
        <div className="max-w-3xl mx-auto">
          <BigTitle>
            SO WHY PAY?
            <br />
            ONE WORD: <span className="text-emerald-400">YOUR PHONE.</span>
          </BigTitle>
          <div className="mt-8 space-y-6 text-lg text-zinc-400 leading-relaxed max-w-2xl">
            <p>
              A local MCP server is a process on your laptop. Claude on your phone — and claude.ai
              in any browser — can only talk to <span className="text-white font-semibold">remote</span> MCP
              servers, and remote servers need real OAuth.
            </p>
            <p>
              That's the part that's genuinely annoying to build: a public HTTPS endpoint, an OAuth
              flow Claude's mobile apps accept, per-user isolation, and a machine that's awake when
              you think of something at 11pm.
            </p>
            <p className="text-white font-semibold">
              instant-db Cloud is that, done. Paste one URL into Claude's settings. Sign in once.
              Same databases on your laptop, your phone, and claude.ai.
            </p>
            <p>
              The founder self-hosted for months. The day remote auth worked from his phone is the
              day he'd have started paying. That's the product.
            </p>
          </div>
          <div className="mt-10">
            <CtaButton href="/auth/login">Get your URL →</CtaButton>
          </div>
          <p className="mt-6 text-xs text-zinc-600 max-w-2xl">
            Free while in beta. ~$10/mo when billing ships. Self-hosting stays free forever — that's
            a license, not a promo.
          </p>
        </div>
      </section>

      {/* Screen 6 — Specificity grid */}
      <section className="px-6 py-32 border-t border-white/10">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm font-black tracking-widest text-emerald-400 uppercase mb-10">
            A database for everything you'd never build a database for.
          </p>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TRACK_EXAMPLES.map(([emoji, label]) => (
              <li key={label} className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-4 text-sm text-zinc-300 flex items-start gap-3">
                <span className="text-lg leading-none">{emoji}</span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-lg text-zinc-400">If you can say it, Claude can track it.</p>
        </div>
      </section>

      {/* Screen 7 — FAQ */}
      <section className="px-6 py-32 border-t border-white/10">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm font-black tracking-widest text-emerald-400 uppercase mb-10">
            Questions a reasonable person would ask.
          </p>
          <dl className="space-y-10">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <dt className="text-xl font-bold mb-2">{q}</dt>
                <dd className="text-zinc-400 leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="px-6 py-32 border-t border-white/10 text-center">
        <BigTitle className="max-w-3xl mx-auto">GIVE CLAUDE A MEMORY.</BigTitle>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <CtaButton href="/auth/login">Get started free →</CtaButton>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 rounded-full font-bold text-base border border-white/20 hover:border-white/60 transition-colors"
          >
            GitHub
          </a>
        </div>
        <p className="mt-16 text-xs text-zinc-600">
          instant-db · built on Bun + SQLite · MIT · made by a person, not a platform
        </p>
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
