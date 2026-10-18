# instant-db Marketing Plan

## Status
v1 — July 2026. Owner: Uri. Companion doc: `homepage-copy.md`.

---

## 1. Positioning

**One-liner:** A real database for Claude. Talk to it once, it remembers forever.

**Category:** We are *not* competing in "AI memory" (crowded, vague, vector-flavored). We position as the boring-on-purpose alternative: **it's just SQLite**. No embeddings, no "memory layer," no retrieval pipeline that hallucinates your grocery list. Rows, columns, a file you can download.

**The wedge:** Claude's biggest daily annoyance for power users is amnesia between chats. Every competitor answer to this is either (a) a RAG product or (b) a note-taking integration. Nobody says "your assistant should just have a database." That sentence is obvious to a tinkerer the moment they hear it — which is exactly what a wedge should feel like.

**Why we win with this audience:** Tinkerers distrust marketing and love inspectable primitives. SQLite is the most trusted piece of software on earth. Our pitch is verifiable in 90 seconds of reading source code.

## 2. Audience

One audience, two wallets:

### Persona A: The self-hoster ("I'll run it myself, thanks")
- Runs Claude Code daily, has a homelab or at least a dotfiles repo
- Will `git clone` before reading the docs
- **Value to us:** GitHub stars, word of mouth, bug reports, HN comments defending us. Self-hosters are the marketing department.
- **Message:** "Free forever, MIT, runs on your laptop in 2 minutes. Most of you should do this." Saying this *out loud* is the whole trust strategy.

### Persona B: The convenience payer ("I could self-host, but…")
- Same person as A, two months later, standing in a grocery line
- The trigger that converts A → B is **mobile/web access**: local MCP servers are processes on your laptop; Claude on your phone and claude.ai can only talk to remote MCP servers with OAuth. Running your own public, OAuth'd, multi-device MCP endpoint is a weekend project with a pager attached.
- **Message:** "So why pay? One word: your phone." (This is the actual conversion story of our first paying user — the founder.)

### Explicit non-audience (for now)
Non-technical users. The current onboarding is good enough for them to succeed, but the *marketing* voice targets tinkerers; broad consumer positioning would dilute the differentiation and we can't support that volume yet.

## 3. Differentiation strategy

The AI-tools landing page has become a uniform: gradient hero, "Supercharge your workflow," logo wall, three-tier pricing. Our differentiation is to be the site that obviously wasn't made by that machine:

1. **Radical honesty as an aesthetic.** We tell people how to not pay us, above the fold of the pricing section. We say "free while in beta" instead of inventing tiers we haven't shipped. We never claim a feature that isn't merged.
2. **One idea per screen, huge type** (dumb.co energy). The page reads like a manifesto, not a brochure. Screenshot-able sentences — every section header should work as a standalone tweet.
3. **Show the artifact.** A real conversation transcript and a real terminal block instead of product screenshots with drop shadows.
4. **Voice:** dry, technical, self-aware. Jokes land *because* the claims are verifiable. Never punch at competitors by name; punch at the category ("memory layers").

## 4. Message architecture (what we say, in order)

1. **Problem, visceral:** "Claude forgets everything." (Everyone who uses Claude daily has felt this today.)
2. **Solution, concrete:** a real transcript — "track my climbing sends" → schema → three weeks later, answer from phone.
3. **Trust, technical:** "It's just SQLite." File you can download, open, leave with.
4. **Generosity:** self-host instructions, complete, on the marketing page itself.
5. **Conversion:** "So why pay? Your phone." Remote OAuth explained in one paragraph.
6. **Social proof via specificity:** what people track (sourdough, climbing, kid's allowance, homelab uptime) — specific beats testimonials we don't have.
7. **FAQ that answers the skeptic's actual questions:** lock-in, shutdown risk, security, "why not just use Notion."

## 5. Channels (ranked by expected ROI)

| # | Channel | Play | Cost |
|---|---------|------|------|
| 1 | **GitHub repo** | README is landing page #2 — same voice, self-host quickstart at top, cloud CTA at bottom. Pin the repo, add topics (`mcp`, `claude`, `sqlite`) | hours |
| 2 | **MCP directories** | Submit to the registries tinkerers actually browse: official MCP registry, Smithery, PulseMCP, Glama, mcp.so. Low effort, permanent, high-intent traffic | 1 hr total |
| 3 | **Show HN** | "Show HN: instant-db — give Claude a real database (it's just SQLite)". The honest self-host section is engineered to survive HN comment sections. Founder answers comments all day. Do this only after onboarding is friction-free and a dozen F&F users have succeeded | free |
| 4 | **Reddit** | r/ClaudeAI (the "how do I make Claude remember" question appears weekly — answer it, genuinely, with both self-host and cloud paths), r/mcp, r/selfhosted (self-host angle only — that community punishes cloud pitches) | free, ongoing |
| 5 | **X/dev Twitter** | Build-in-public thread format: the "works from my phone in a grocery line" demo video is the hero asset. 30-second screen recording, no music, no jump cuts | free |
| 6 | **SEO / content** | Three posts that answer real searches: "make Claude remember things between chats", "remote MCP server with OAuth (the missing guide)" — this one earns backlinks from every MCP developer who hits the same wall — and "MCP + SQLite: the simplest persistent memory" | days |
| 7 | **Newsletters** | Pitch TLDR AI / Bytes / Console after HN traction, not before | free |

**Anti-channels (explicitly skip):** paid ads (wrong audience, wrong budget), influencer sponsorships (trust-destroying for this persona), Product Hunt (wrong crowd for tinkerers, launch energy better spent on HN).

## 6. Launch sequence

- **Phase 0 (now):** Friends & family. Fix onboarding friction. Collect the specific things people track — this becomes homepage copy. Get the WorkOS→dashboard flow flawless.
- **Phase 1 (repo public + page live):** New homepage ships, README rewritten in same voice, MCP directory submissions, start answering Reddit threads. Goal: 25 connected users (measured by `/api/status` connected flips).
- **Phase 2 (Show HN):** After metering ships and free-tier limits exist (so a traffic spike can't bankrupt the Fly bill). Demo video ready. Goal: 100 GitHub stars, 100 signups, 40% activation.
- **Phase 3 (content drip):** One SEO post per 2 weeks, build-in-public threads for each feature (export, billing). Convert the billing launch itself into content ("we're turning on payments — here's exactly why our own founder pays").

## 7. Pricing framing (page copy rule, not a billing spec)

Until Stripe ships (see `usage-metering-billing.md`): **"Free while in beta. Cloud will be ~$10/mo when billing ships. Self-hosting is free forever — that's a license, not a promo."** Never show a pricing table with tiers that don't exist. When billing ships, the price change is itself a launch moment ("we start charging Tuesday; here's what's grandfathered").

## 8. Metrics

| Metric | Source | Target (90 days post-HN) |
|--------|--------|--------------------------|
| GitHub stars | GitHub | 500 |
| Signups (WorkOS accounts) | WorkOS | 300 |
| **Activation: connected a Claude client** | `.mcp-last-seen` markers / `/api/status` | 50% of signups |
| Retention: active in week 4 | last-seen timestamps | 25% of activated |
| Self-host installs | (unmeasurable, by design — we don't phone home) | n/a, and say so proudly |
| Free → paid (post-billing) | Stripe | 5% of active |

Activation is the metric that matters — a signup who never connects Claude got zero value. The onboarding page's live connection detection exists precisely to move this number.

## 9. Voice & tone guide

- Short declaratives. One idea per sentence.
- Technical words are fine; marketing words are not. Say "OAuth," never "enterprise-grade security." Say "a .sqlite file," never "your data, unlocked."
- Self-deprecation over hype: "It's a database. Claude does the typing."
- Honesty is the brand. If a claim isn't shipped, it doesn't go on the page. If something is easy to self-host, say so.
- Swearing: no. Irreverence: yes.
- **Litmus test:** would a skeptical HN commenter screenshot this sentence to mock it? Rewrite until the screenshot would only make us look good.
