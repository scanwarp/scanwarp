# Contributing to ScanWarp

Thanks for your interest! We welcome contributions of all kinds.

## Getting Started

```bash
# Clone your fork
git clone https://github.com/your-username/scanwarp.git
cd scanwarp

# Install dependencies
pnpm install

# Start infrastructure
docker compose up -d

# Build all packages
pnpm build

# Run in dev mode
pnpm dev
```

Server runs on http://localhost:3000

## Running Tests

```bash
# End-to-end test suite
pnpm test:e2e
```

Requires Docker and ports 3000, 4000, 5432 available.

## Making Changes

1. **Fork** the repo on GitHub
2. **Create a branch** for your feature: `git checkout -b feat/my-feature`
3. **Make your changes** following our code style (see below)
4. **Test** your changes with `pnpm test:e2e`
5. **Push** to your fork and **open a PR** against `main`

## Code Style

- **TypeScript** — Strict mode, no `any` unless absolutely necessary
- **No ORMs** — Use raw SQL with `postgres.js`
- **ESLint** — Run `pnpm lint` before committing
- **Formatting** — We use Prettier (automatic on save)

## PR Guidelines

- Keep PRs focused on a single feature or fix
- Write clear commit messages
- Update docs if you change APIs
- Add tests for new features
- Link to related issues

## Questions?

- **Bugs/Features** → [GitHub Issues](https://github.com/scanwarp/scanwarp/issues)
- **Questions** → [GitHub Discussions](https://github.com/scanwarp/scanwarp/discussions)
- **Security** → Email security@scanwarp.com (coming soon)

We review PRs regularly and aim to respond within 48 hours. Thanks for contributing! 🚀
