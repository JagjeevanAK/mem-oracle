---
description: Re-index a documentation site to fetch fresh content
---

# Reindex Documentation

Re-index a documentation site to fetch fresh content and update the vector store.

## Instructions

The user wants to re-index documentation. The argument `$ARGUMENTS` contains either:
- A URL like `https://nextjs.org/docs`
- Or a docset reference like `docset:abc123`

## Steps

1. First check if the worker is running:

```bash
curl -s http://127.0.0.1:7432/health
```

2. If the argument is a URL, trigger re-indexing with force:

```bash
curl -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "$ARGUMENTS", "seedSlug": "/", "force": true}'
```

3. If the argument starts with `docset:`, extract the ID and refresh:

```bash
curl -X POST http://127.0.0.1:7432/refresh \
  -H "Content-Type: application/json" \
  -d '{"docsetId": "THE_ID", "force": true}'
```

4. Check the status and report progress:

```bash
curl -s http://127.0.0.1:7432/status
```

Report the indexing progress to the user.
