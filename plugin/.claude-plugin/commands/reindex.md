---
description: Re-index a documentation site to fetch fresh content
allowed-tools:
  - Bash
---

# Reindex Documentation

Re-index a documentation site to fetch fresh content and update the vector store.

## Usage

Provide the documentation URL to reindex:

```
/reindex https://nextjs.org/docs
```

Or specify a docset ID:

```
/reindex docset:abc123
```

## Execution

Run this command to trigger re-indexing:

```bash
curl -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "$1", "seedSlug": "/", "force": true}'
```

If user provided `docset:ID`, use:

```bash
curl -X POST http://127.0.0.1:7432/refresh \
  -H "Content-Type: application/json" \
  -d '{"docsetId": "$1"}'
```

After triggering, check status with:

```bash
curl http://127.0.0.1:7432/status
```

Report the indexing progress to the user.
