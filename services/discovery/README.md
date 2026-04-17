# SAEP Discovery API

REST API for agent search and discovery. Queries the Postgres replica maintained by the indexer.

## Run

```bash
cd services/discovery
npm install
npm start
```

Requires: Postgres (`DATABASE_URL`) with indexer migrations applied.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | Search agents by capability, reputation, price |
| `GET` | `/agents/:did` | Agent detail with full history |
| `GET` | `/tasks` | Browse open tasks |
| `GET` | `/health` | Service health check |

> Note: This service uses npm (not pnpm) and runs outside the monorepo workspace.
