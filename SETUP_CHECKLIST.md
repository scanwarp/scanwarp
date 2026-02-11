# GitHub Repository Setup Checklist

Quick checklist for completing the ScanWarp repository setup.

## ✅ Completed (Automated)

- [x] README shortened to 65 lines (punchy and scannable)
- [x] Detailed docs moved to `docs/` folder
- [x] CONTRIBUTING.md added (48 lines)
- [x] `.claude` removed from repo and added to .gitignore
- [x] Git tag `v0.1.0` created and pushed
- [x] Issue templates added (bug report, feature request)

## 🔧 Manual Steps Required

Complete these in GitHub settings:

### 1. Add Topics/Tags (2 minutes)

Go to: https://github.com/scanwarp/scanwarp → **About** → **⚙️ Settings icon** → **Topics**

Add these topics:
```
monitoring
open-source
ai
developer-tools
mcp
vercel
vibe-coding
observability
typescript
devops
```

### 2. Add Website URL (30 seconds)

Go to: https://github.com/scanwarp/scanwarp → **About** → **⚙️ Settings icon** → **Website**

Add:
```
https://scanwarp.com
```

(or leave empty until the website is live)

### 3. Create GitHub Release (2 minutes)

Go to: https://github.com/scanwarp/scanwarp/releases → **Draft a new release**

- **Choose a tag:** v0.1.0 (already exists)
- **Release title:** v0.1.0 — Initial Release
- **Description:**

```markdown
## ScanWarp v0.1.0 — Initial Release

**Your AI writes your code. ScanWarp keeps it running.**

### Features

- 🔍 **Monitoring Engine** — Health checks every 60s
- 🤖 **AI Diagnosis** — Claude explains issues in plain English
- 🔗 **Provider Integrations** — Vercel, Stripe, GitHub, Supabase
- 📢 **Notifications** — Discord/Slack alerts with fix prompts
- 🛠️ **CLI Tool** — `npx scanwarp init` for 30-second setup
- 🔌 **MCP Server** — Direct integration with Cursor/Claude Code
- ✅ **E2E Tests** — Comprehensive test suite

### Quick Start

\`\`\`bash
npx scanwarp init
\`\`\`

### Documentation

- [API Reference](docs/api.md)
- [MCP Integration](docs/mcp.md)
- [Notifications](docs/notifications.md)
- [Self-Hosting](docs/self-hosting.md)

### Installation

\`\`\`bash
# Self-host with Docker
docker compose up -d
npx scanwarp init --server http://localhost:3000
\`\`\`

---

**Full Changelog:** https://github.com/scanwarp/scanwarp/commits/v0.1.0
```

Click **Publish release**

### 4. Upload Social Preview Image (1 minute)

Go to: https://github.com/scanwarp/scanwarp/settings → **Social preview**

Upload your social preview image (PNG, 1280x640px recommended)

If you don't have an image yet, you can:
- Create one with Figma/Canva
- Use GitHub's auto-generated preview
- Skip for now and add later

### 5. Enable Discussions (30 seconds)

Go to: https://github.com/scanwarp/scanwarp/settings → **General** → **Features**

Check:
- [x] **Discussions** — For questions and community

### 6. Add Description (30 seconds)

Go to: https://github.com/scanwarp/scanwarp → **About** → **⚙️ Settings icon** → **Description**

Add:
```
Production monitoring for AI-first developers. Auto-diagnoses issues with Claude AI.
```

## 📋 Optional (Can Wait)

- [ ] Set up GitHub Pages for documentation site
- [ ] Add Open Graph meta tags
- [ ] Create Discord server and update links
- [ ] Register scanwarp.com domain
- [ ] Set up sponsorship/funding links
- [ ] Add code coverage badges
- [ ] Set up dependabot for dependency updates

## ✨ Priority Order

Do these **right now** (10 minutes total):
1. Add topics/tags
2. Add website URL
3. Create v0.1.0 release
4. Upload social preview image
5. Enable Discussions

The rest can wait until you have actual traffic/users.

---

**Status:** All automated tasks complete ✅
**Next:** Complete manual steps in GitHub settings (10 minutes)
