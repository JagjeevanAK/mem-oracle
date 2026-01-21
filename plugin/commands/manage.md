---
description: mem-oracle documentation manager - index, search, and manage docs
allowed-tools:
  - Bash
argument-hint: "[action] [args]"
---

# mem-oracle - Documentation Manager

Available actions:
1. **status** - Show all indexed documentation and their status
2. **index <url>** - Index a new documentation URL
3. **reindex [url]** - Reindex all docs, or a specific one if URL given
4. **search <query>** - Search across indexed documentation
5. **delete <url>** - Delete an indexed docset

## Usage

If `$ARGUMENTS` is empty or "help", show this menu and ask user what they want to do.

If `$ARGUMENTS` starts with an action keyword, execute it:

### status
```bash
curl -s http://127.0.0.1:7432/status
```
Present results as a table showing: name, base URL, status, pages indexed, last updated.

### index <url>
Extract baseUrl (origin) and seedSlug (path) from the URL, then:
```bash
curl -s -X POST http://127.0.0.1:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "ORIGIN", "seedSlug": "PATH", "waitForSeed": true}'
```

### reindex [url]
If no URL given, reindex ALL:
```bash
curl -s -X POST http://127.0.0.1:7432/refresh-all \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```
If URL given, extract origin and reindex that one:
```bash
curl -s -X POST http://127.0.0.1:7432/refresh \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "ORIGIN", "force": true}'
```

### search <query>
```bash
curl -s -X POST http://127.0.0.1:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "QUERY", "topK": 5}'
```
Present results with title, heading, snippet, URL, and score.

### delete <url>
First get docset ID from status, then:
```bash
curl -s -X DELETE "http://127.0.0.1:7432/docset/DOCSET_ID"
```

## Interactive Mode

If user just types `/mem-oracle` with no args, present a friendly menu:

```
mem-oracle - Documentation Manager

What would you like to do?
1. View indexed docs status
2. Index new documentation
3. Reindex existing docs
4. Search documentation
5. Delete a docset

Type a number (1-5) or an action like "index https://..."
```

Then wait for user input and execute the corresponding action.
