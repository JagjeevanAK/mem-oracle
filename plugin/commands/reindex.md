---
description: Re-index already indexed documentation (all or one)
allowed-tools:
  - Bash
argument-hint: [documentation URL | baseUrl | docsetId]
---

Re-index documentation that is already indexed.

If `$ARGUMENTS` is empty: re-index **all** docsets (stale ones by default).

```bash
curl -s -X POST http://127.0.0.1:7432/refresh-all \
  -H "Content-Type: application/json" \
  -d '{"force": false, "maxAge": 24}'
```

If `$ARGUMENTS` is provided:
- If it looks like a URL (starts with `http`), extract its **origin** (scheme + host) as `baseUrl` and refresh that docset.
- Otherwise treat it as a `docsetId`.

```bash
# Refresh by full docs URL (use origin as baseUrl)
curl -s -X POST http://127.0.0.1:7432/refresh \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://nextjs.org", "force": true}'

# Refresh by baseUrl (origin)
curl -s -X POST http://127.0.0.1:7432/refresh \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://nextjs.org", "force": true}'

# Refresh by docsetId
curl -s -X POST http://127.0.0.1:7432/refresh \
  -H "Content-Type: application/json" \
  -d '{"docsetId": "DOCSET_ID", "force": true}'
```

If the docset is not found, instruct the user to run `/mem-oracle:index <documentation URL>` first.

Report refresh results and then show `/status`.
