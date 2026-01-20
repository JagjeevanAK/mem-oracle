---
description: Check the status of all indexed documentation
---

# Documentation Status

Check the status of all indexed documentation sets.

## Instructions

Run this command to check the status:

```bash
curl -s http://127.0.0.1:7432/status
```

## Response Format

Present the results in a readable table or list showing:
- Docset name and base URL
- Total pages indexed
- Pending/error pages  
- Last updated timestamp
- Current status (ready/indexing/error)

If the worker is not running, inform the user and suggest starting it.
