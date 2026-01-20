---
name: docs-search
description: Search indexed documentation for relevant information. Use when the user asks about libraries, frameworks, APIs, or needs code examples from official docs.
---

# docs-search

Search indexed documentation for relevant information using mem-oracle.

## When to Use

Use this skill when the user asks about:
- How to use a specific library, framework, or API
- Documentation for a package or tool
- Best practices from official docs
- Code examples from documentation
- Configuration or setup guides

## How to Use

1. First check if the worker is running by making a health check
2. Use the retrieve endpoint to search for relevant documentation
3. Present the results with source URLs

## API Endpoints

**Base URL**: `http://127.0.0.1:7432`

### Health Check

```bash
curl http://127.0.0.1:7432/health
```

### Search Documentation

```bash
curl -X POST http://127.0.0.1:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "your search query", "topK": 5}'
```

### Index New Documentation

To index a new documentation site:

```bash
curl -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://docs.example.com", "seedSlug": "/getting-started"}'
```

### Check Indexing Status

```bash
curl http://127.0.0.1:7432/status
```

## Example Queries

- "How do I use server components in Next.js?"
- "What are the best practices for React hooks?"
- "How to configure TypeScript paths?"
- "Explain Tailwind CSS dark mode setup"

## Response Format

Results include:
- `title`: Page title
- `heading`: Section heading (if available)
- `content`: Relevant text snippet
- `url`: Source documentation URL
- `score`: Relevance score (0-1)

## Indexing Documentation URLs

When you encounter a documentation URL in the conversation, you can index it:

```bash
# Index Next.js docs
curl -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://nextjs.org", "seedSlug": "/docs/app"}'

# Index React docs
curl -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://react.dev", "seedSlug": "/reference"}'
```

## Troubleshooting

If the worker is not responding:

1. Check if it's running: `curl http://127.0.0.1:7432/health`
2. View logs: `tail -f ~/.mem-oracle/worker.log`
3. Start manually: `cd /path/to/mem-oracle && bun run worker`
