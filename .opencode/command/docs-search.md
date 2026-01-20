---
description: Search indexed documentation for relevant information
---

# Search Documentation

Search through indexed documentation for relevant information.

## Instructions

The user's search query is: `$ARGUMENTS`

Execute this search:

```bash
curl -s -X POST http://127.0.0.1:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "$ARGUMENTS", "topK": 5}'
```

## Response Format

Present the search results clearly:
- Show the title and section heading
- Include the relevant content snippet
- Provide the source URL for reference
- Mention the relevance score

If no results are found, suggest:
1. Check if documentation is indexed with `/docs-status`
2. Index new docs with `/reindex <url>`
