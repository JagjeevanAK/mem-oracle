---
description: Index or re-index a documentation URL
allowed-tools:
  - Bash
argument-hint: <documentation URL>
---

Index or re-index a documentation URL.

If `$ARGUMENTS` contains a URL, extract the base URL and path, then run:

```bash
curl -s -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "BASE_URL", "seedSlug": "PATH", "waitForSeed": true}'
```

For example, for `https://nextjs.org/docs/app`:
- baseUrl: `https://nextjs.org`
- seedSlug: `/docs/app`

Report the indexing status after the request completes.
