# Agent Instructions — Beaconator-web

PWA personal para monitorear PRs de GitHub y tickets de Jira.

## Deploy Instructions

Pending deploy tasks. Do NOT deploy until the user explicitly asks.

### Frontend — Cloudflare Pages
- Static site, no build step needed (vanilla JS, no bundler)
- Deploy command: `npx wrangler pages deploy . --project-name=beaconator`
- Or push to a Git repo connected to Cloudflare Pages for auto-deploy
- Custom domain: configure in Cloudflare Pages dashboard after deploy

### Worker — Jira Proxy
- Deploy command: `cd worker && npx wrangler deploy`
- After deploying the frontend to Pages, update `ALLOWED_ORIGIN` in the Cloudflare dashboard (or `wrangler.toml`) to the Pages URL (e.g. `https://beaconator.pages.dev`)
- `wrangler.toml` vars:
  - `ALLOWED_ORIGIN` — set to the Pages URL after deploy (currently `http://localhost:3000` for dev)
  - `RATE_LIMIT_MODE` — `global` (default) or `ip`
  - `RATE_LIMIT_GLOBAL_MAX` — max requests per window (default: 60)
  - `RATE_LIMIT_WINDOW_SECONDS` — window duration (default: 60)

### Post-deploy verification
- Test Jira panel still works (CORS headers correct)
- Test origin validation blocks requests from other sites
- Verify rate limiting kicks in at threshold
