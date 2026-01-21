---
description: Index a new documentation URL
allowed-tools:
  - Bash
argument-hint: <documentation URL>
---

Index a documentation URL (creates a new docset if it doesn't exist).

You MUST require a URL in `$ARGUMENTS`. Extract:
- `baseUrl`: scheme + host (e.g. `https://nextjs.org`)
- `seedSlug`: path (e.g. `/docs/app`)

Then run:

```bash
curl -s -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "BASE_URL", "seedSlug": "SEED_SLUG", "waitForSeed": true}'
```

After the request completes, show `/status`.
