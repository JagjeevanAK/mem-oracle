---
description: Check the status of indexed documentation
allowed-tools:
  - Bash
---

Check the status of all indexed documentation sets.

Run this command to check what documentation has been indexed:

```bash
curl -s http://127.0.0.1:7432/status
```

Present the results showing:
- Docset name and base URL
- Total pages indexed vs pending
- Current status (ready/indexing/error)
- Last updated timestamp
