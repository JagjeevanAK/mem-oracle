---
description: Search indexed documentation for relevant information
allowed-tools:
  - Bash
argument-hint: <search query>
---

Search through indexed documentation for relevant information.

Run this command to search for: $ARGUMENTS

```bash
curl -s -X POST http://127.0.0.1:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "$ARGUMENTS", "topK": 5}'
```

Present results with:
- Title and section heading
- Relevant content snippet  
- Source URL for reference
- Relevance score
