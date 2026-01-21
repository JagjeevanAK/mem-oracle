---
description: Check the status of indexed documentation
allowed-tools:
  - Bash
---

# Documentation Status

Check the status of all indexed documentation sets.

## Execution

```bash
curl -s http://127.0.0.1:7432/status | jq .
```

If jq is not available, use:

```bash
curl -s http://127.0.0.1:7432/status
```

## Response Format

Present the results in a readable format showing:
- Docset name and base URL
- Total pages indexed
- Pending/error pages
- Last updated timestamp
- Current status (ready/indexing/error)
