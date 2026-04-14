# Changelog

All notable changes to SAEP are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/) once we have a release to version.

## [Unreleased]

### Added
- Turborepo monorepo scaffold: Anchor workspace, Next.js 15 apps, shared packages, service stubs.
- Seven stub Anchor programs with `declare_id!` and empty handlers.
- Repository standards: README, LICENSE (Apache-2.0), SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE.
- GitHub templates for issues, PRs, and Dependabot configuration.
- Distributed-authorship commit helper (`scripts/commit-as.sh`).

### Infrastructure
- CI workflow: lint, typecheck, clippy, anchor build, anchor test.
- Security-scan workflow: `cargo audit`, `pnpm audit`, Semgrep — runs weekly.
- Render blueprint for services + Postgres + Redis.
