# website-check

An agent skill that checks whether a website is ready for launch: robots.txt, sitemap.xml, canonical, noindex, Open Graph image, favicon set, web manifest, llms.txt, JSON-LD, redirects (http/www), HSTS, compression, analytics. Works against a live URL or a local build folder (Astro projects are detected automatically), and ships fix recipes for Astro.

The skill text and report are in Russian; any capable model handles that fine and can answer the user in their own language.

## Install (instructions for an AI agent)

If a user gave you this repository link and asked you to install the skill, do exactly this:

1. **Check Node.js ≥ 18:** `node -v`. The script has zero dependencies — do not run `npm install`.
2. **Clone into the skills directory** — the folder name must be `website-check`:

   | Agent | Command |
   |---|---|
   | Claude Code (all projects) | `git clone https://github.com/konser80/skill-website-check.git ~/.claude/skills/website-check` |
   | Claude Code (one project) | `git clone https://github.com/konser80/skill-website-check.git .claude/skills/website-check` |
   | Codex CLI, Gemini CLI, Copilot CLI, others reading `~/.agents/skills` | `git clone https://github.com/konser80/skill-website-check.git ~/.agents/skills/website-check` |

   If the target folder already exists, run `git -C <folder> pull` instead of cloning.
   No git? Download `https://github.com/konser80/skill-website-check/archive/refs/heads/master.zip` and unpack it so that `SKILL.md` sits directly in `<skills dir>/website-check/`.

3. **Verify:** `node <skills dir>/website-check/check.mjs https://astro.build` should print a grouped report ending with `Итого: ❌ must … · ⚠️ should … · 💡 nice …`. Network access is required for live checks.
4. **Tell the user** the skill is installed and that the agent may need a restart (Claude Code: start a new session) to pick it up. Then they can say “check my site https://…” / «проверь сайт …».

## Usage

Ask the agent in plain words: “check the site example.com before launch”, “run website-check on ./my-site”, «проверь sitemap и og:image». The agent runs the script, reviews the judgment calls (OG image, title quality, llms.txt contents), and reports ❌ must / ⚠️ should / 💡 nice. Fixes are applied only when you ask for them.

The script can also be run by hand:

```bash
node check.mjs https://example.com            # live site
node check.mjs ./my-astro-site                # built project (runs against dist/; run `npm run build` first)
node check.mjs ./dist --site https://example.com
node check.mjs https://example.com --json     # machine-readable
```

Exit code is `1` if any ❌ must check fails — usable in CI.

## Files

- `SKILL.md` — instructions for the agent
- `check.mjs` — the checker (Node ≥ 18, no dependencies)
- `astro-fixes.md` — fix recipes: robots endpoint, single `/sitemap.xml` with `@astrojs/sitemap`, `<head>` meta, icons, llms.txt, JSON-LD, 404, trailing slash, nginx

## Update

```bash
git -C ~/.claude/skills/website-check pull
```
