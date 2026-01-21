---
description: Search indexed documentation for relevant information
allowed-tools:
  - Bash
---

# Search Documentation

Search through indexed documentation for relevant information.

## Usage

```
/docs-search how to use server components
```

## Execution

```bash
curl -s -X POST http://127.0.0.1:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "$ARGUMENTS", "topK": 5}'
```

## Response Format

Present results with:
- Title and section heading
- Relevant content snippet
- Source URL for reference
- Relevance score
