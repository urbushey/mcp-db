# Homepage copy — single-page scroller

Voice: see `marketing-plan.md` §9. One idea per screen. Every H1 must work as a standalone tweet.
Rule: nothing on this page describes an unshipped feature.

---

## Nav (sticky, minimal)

`instant-db` · links: **Self-host** (anchor) · **GitHub** · **Sign in →**

---

## Screen 1 — Problem

# CLAUDE FORGETS EVERYTHING.

Every chat starts from zero. Your workout log. Your reading list.
The name of your sourdough starter. Gone.

**instant-db is a real database for Claude.**
Talk to it once. It remembers forever.

[ Give Claude a memory → ]   [ Read the source ]

<sub>Free while in beta · MIT-licensed · it's just SQLite</sub>

---

## Screen 2 — Show, don't tell (styled transcript)

### THIS IS THE WHOLE PRODUCT.

> **You:** track my climbing sends — grade, gym, flash or not
>
> **Claude:** `create_database("climbing")` ✓ — I'll log grade, gym, attempts, and date.
>
> **You** (three weeks later, from your phone, in line for coffee): what's my hardest send this month?
>
> **Claude:** V6 at Movement, flashed on the 14th. You're two grades up from May.

No schema. No SQL. No app to check. You talk, Claude does the typing.

---

## Screen 3 — Trust

# IT'S JUST SQLITE.

No vector store. No embeddings pipeline. No "memory layer"
that half-remembers your grocery list as a vibe.

Rows. Columns. A `.sqlite` file with your name on it.
Open it in anything. Take it anywhere. It'll outlive us — SQLite files
from 2004 still open fine, and that's the format your data lives in.

---

## Screen 4 — Generosity (self-host)

# SELF-HOST IT. SERIOUSLY.

This is not a trick. The server is MIT-licensed and runs on your laptop
in about two minutes. If you live in Claude Code or Claude Desktop,
you may never need us:

```
git clone https://github.com/urbushey/mcp-db
cd mcp-db && bun install
claude mcp add instant-db -- bun run src/index.ts
```

That's the entire install. Your data never leaves your machine.
We put this on the homepage because you'd have found it anyway.

---

## Screen 5 — Conversion

# SO WHY PAY? ONE WORD: YOUR PHONE.

A local MCP server is a process on your laptop. Claude on your phone
— and claude.ai in any browser — can only talk to **remote** MCP servers,
and remote servers need real OAuth.

That's the part that's genuinely annoying to build: a public HTTPS
endpoint, an OAuth flow Claude's mobile apps accept, per-user isolation,
and a machine that's awake when you think of something at 11pm.

**instant-db Cloud is that, done.** Paste one URL into Claude's settings.
Sign in once. Same databases on your laptop, your phone, and claude.ai.

The founder self-hosted for months. The day remote auth worked from his
phone is the day he'd have started paying. That's the product.

[ Get your URL → ]

<sub>Free while in beta. ~$10/mo when billing ships. Self-hosting stays free forever — that's a license, not a promo.</sub>

---

## Screen 6 — Specificity grid ("what people track")

### A DATABASE FOR EVERYTHING YOU'D NEVER BUILD A DATABASE FOR.

- 🧗 climbing sends by grade and gym
- 🍞 sourdough feeds and rise times
- 🏋️ every set, rep, and PR
- 📚 books started vs. actually finished
- 🐛 which tomato varieties survived July
- 🏠 homelab uptime incidents
- 💸 the kid's allowance ledger
- 🍷 wines you liked before you forgot them
- ⛽ fuel economy per fill-up

If you can say it, Claude can track it.

---

## Screen 7 — FAQ (the skeptic section)

### QUESTIONS A REASONABLE PERSON WOULD ASK.

**Is my data locked in?**
It's a SQLite file. The most portable database format in existence. Cloud data export lands before we charge anyone a dollar — that's a hard rule in our billing spec, which is public, in the repo.

**What if you shut down?**
You self-host the same MIT-licensed server the cloud runs, and your data is standard SQLite. Worst case, you lose convenience, not data.

**Why not just use Notion / a spreadsheet?**
Because you won't open it. The point is telling Claude mid-conversation and moving on with your life.

**Who can see my data?**
Cloud data lives in per-user isolated storage, over TLS, behind OAuth. It's a beta run by one person — read the code and threat-model accordingly. Paranoid? Self-host. We'll help.

**What's an MCP server?**
The plug-in standard for Claude (and other AI clients). instant-db speaks it over stdio locally or HTTP remotely.

---

## Footer

# GIVE CLAUDE A MEMORY.

[ Get started free → ]   [ GitHub ]

`instant-db` · built on Bun + SQLite · MIT · made by a person, not a platform
