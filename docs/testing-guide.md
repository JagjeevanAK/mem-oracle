# Testing Guide for mem-oracle Claude Code Plugin

This guide will help you test the mem-oracle plugin after installation in Claude Code.

## Quick Verification

### 1. Check Worker Service Status

The plugin should automatically start the worker service when you start a Claude Code session. Verify it's running:

```bash
curl http://localhost:7432/health
```

You should see a response indicating the service is healthy. If not, check the logs:

```bash
tail -f ~/.mem-oracle/worker.log
```

### 2. Check Plugin Status

Use the built-in command to check documentation status:

```
/docs-status
```

This will show you all indexed documentation sets and their status.

## Testing Workflows

### Test 1: Auto-Index Documentation

The plugin automatically detects documentation URLs in your prompts and indexes them. Try this:

**In Claude Code, send a prompt like:**
```
How do I use Next.js App Router? https://nextjs.org/docs/app
```

The plugin will:
1. Detect the URL
2. Start indexing the documentation
3. Wait for the seed page to be indexed
4. Retrieve relevant snippets based on your question
5. Inject them into the context

**What to look for:**
- Check the status: `/docs-status` should show a new docset for `nextjs.org`
- The response should include relevant documentation snippets at the top

### Test 2: Search Indexed Documentation

After indexing some docs, test the search functionality:

**Option A: Use the command**
```
/docs-search how to use server components
```

**Option B: Ask a question naturally**
```
How do I use server components in Next.js?
```

The plugin will automatically retrieve relevant snippets from indexed documentation.

### Test 3: Manual Indexing

You can also manually trigger indexing by including a URL in your prompt:

```
Index this documentation: https://react.dev/learn
```

Or use the reindex command:
```
/reindex https://react.dev/learn
```

### Test 4: Multiple Documentation Sets

Test indexing multiple documentation sources:

1. First prompt:
```
How do I use Next.js? https://nextjs.org/docs
```

2. Second prompt:
```
How do I use React? https://react.dev/learn
```

3. Then ask a question that could match either:
```
How do I create a component?
```

The plugin should search across all indexed docsets and return relevant results.

## Verification Steps

### Check Worker Logs

Monitor the worker service logs to see indexing activity:

```bash
tail -f ~/.mem-oracle/worker.log
```

You should see:
- Worker starting up
- Indexing requests
- Pages being fetched and processed
- Embeddings being generated

### Check Data Directory

Verify that data is being stored:

```bash
ls -la ~/.mem-oracle/
```

You should see:
- `cache/` - Cached HTML content
- `vectors/` - Vector embeddings
- `metadata.db` - SQLite database with metadata
- `worker.pid` - Worker process ID
- `worker.log` - Worker logs

### Test API Endpoints Directly

You can test the worker API directly:

**Health check:**
```bash
curl http://localhost:7432/health
```

**Index documentation:**
```bash
curl -X POST http://localhost:7432/index \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://nextjs.org",
    "seedSlug": "/docs/getting-started",
    "name": "Next.js Docs",
    "waitForSeed": true
  }'
```

**Search documentation:**
```bash
curl -X POST http://localhost:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "query": "how to use server components",
    "topK": 5
  }'
```

**Check status:**
```bash
curl http://localhost:7432/status
```

## Expected Behavior

### When It Works Correctly

1. **Session Start**: Worker service starts automatically (check logs)
2. **URL Detection**: URLs in prompts are detected and indexed
3. **Context Injection**: Relevant documentation snippets appear in responses
4. **Commands Work**: `/docs-search` and `/docs-status` return results
5. **Background Indexing**: Additional pages are indexed in the background

### Common Issues

**Worker not starting:**
- Check if Bun is installed: `bun --version`
- Check logs: `~/.mem-oracle/worker.log`
- Verify port 7432 is not in use: `lsof -i :7432`

**No results returned:**
- Ensure documentation is indexed: `/docs-status`
- Wait for indexing to complete (seed page is indexed immediately)
- Check if query matches indexed content

**Auto-indexing not working:**
- Verify `auto_index` setting is `true` in plugin settings
- Check that URLs are properly formatted in prompts
- Review worker logs for indexing errors

## Advanced Testing

### Test with Different Embedding Providers

If you've configured API-based embeddings (OpenAI, Voyage, Cohere), test that they work:

1. Check your config: `~/.mem-oracle/config.json`
2. Index a small docset
3. Verify embeddings are generated (check logs)
4. Test search quality

### Test Performance

1. Index a large documentation site (e.g., full Next.js docs)
2. Monitor indexing speed in logs
3. Test search latency
4. Check memory usage

### Test Error Handling

1. Try indexing an invalid URL
2. Try searching with no indexed docs
3. Stop the worker and see how the plugin handles it
4. Test with network issues

## Troubleshooting

If something doesn't work:

1. **Check worker status**: `curl http://localhost:7432/health`
2. **View logs**: `tail -f ~/.mem-oracle/worker.log`
3. **Restart worker**: The plugin should auto-restart, or manually:
   ```bash
   cd /path/to/mem-oracle
   bun run worker
   ```
4. **Check plugin installation**: Verify the plugin is listed in Claude Code settings
5. **Verify dependencies**: Ensure `bun install` completed successfully

## Success Criteria

Your plugin is working correctly if:

✅ Worker service starts automatically on session start  
✅ URLs in prompts trigger automatic indexing  
✅ Relevant documentation snippets appear in responses  
✅ `/docs-search` command returns results  
✅ `/docs-status` shows indexed docsets  
✅ Background indexing continues after seed page  
✅ Multiple docsets can be indexed and searched  
