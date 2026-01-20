---
description: Refresh all stale documentation (older than 24 hours)
---

# Refresh All Documentation

Refresh all indexed documentation that is older than the specified age.

## Instructions

Run this command to refresh all stale docsets:

```bash
curl -s -X POST http://127.0.0.1:7432/refresh-all \
  -H "Content-Type: application/json" \
  -d '{"maxAge": 24}'
```

To force refresh everything regardless of age:

```bash
curl -s -X POST http://127.0.0.1:7432/refresh-all \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

## Response Format

Report:
- Total number of docsets
- How many were refreshed
- Which ones were skipped (still fresh)
