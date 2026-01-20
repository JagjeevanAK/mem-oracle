# OpenCode Installation Guide

mem-oracle plugin for OpenCode - Documentation indexer that auto-injects relevant doc snippets into your coding context.

## Installation

### Option 1: Copy to Project (Recommended)

Copy the plugin, skills, and commands to your project:

```bash
# From your project root
mkdir -p .opencode/plugin .opencode/skills .opencode/command

# Copy the plugin file
cp /path/to/mem-oracle/.opencode/plugin/mem-oracle.ts .opencode/plugin/

# Copy the skills
cp -r /path/to/mem-oracle/.opencode/skills/docs-search .opencode/skills/

# Copy the commands
cp /path/to/mem-oracle/.opencode/command/*.md .opencode/command/
```

### Option 2: Global Installation

Copy to your global OpenCode config:

```bash
mkdir -p ~/.config/opencode/plugin ~/.config/opencode/skills ~/.config/opencode/command

# Copy plugin
cp /path/to/mem-oracle/.opencode/plugin/mem-oracle.ts ~/.config/opencode/plugin/

# Copy skills
cp -r /path/to/mem-oracle/.opencode/skills/docs-search ~/.config/opencode/skills/

# Copy commands
cp /path/to/mem-oracle/.opencode/command/*.md ~/.config/opencode/command/
```

### Option 3: Clone Repository

Clone the repo and symlink:

```bash
git clone https://github.com/jagjeevanak/mem-oracle.git ~/.mem-oracle-plugin

# For project-level
mkdir -p .opencode/plugin .opencode/skills .opencode/command
ln -s ~/.mem-oracle-plugin/.opencode/plugin/mem-oracle.ts .opencode/plugin/
ln -s ~/.mem-oracle-plugin/.opencode/skills/docs-search .opencode/skills/
for f in ~/.mem-oracle-plugin/.opencode/command/*.md; do ln -s "$f" .opencode/command/; done

# Or for global
mkdir -p ~/.config/opencode/plugin ~/.config/opencode/skills ~/.config/opencode/command
ln -s ~/.mem-oracle-plugin/.opencode/plugin/mem-oracle.ts ~/.config/opencode/plugin/
ln -s ~/.mem-oracle-plugin/.opencode/skills/docs-search ~/.config/opencode/skills/
for f in ~/.mem-oracle-plugin/.opencode/command/*.md; do ln -s "$f" ~/.config/opencode/command/; done
```

## Requirements

- **Bun**: JavaScript runtime (auto-installs dependencies)
- **Node.js**: 18.0.0 or higher
- **OpenCode**: Latest version with plugin support

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEM_ORACLE_PORT` | `7432` | Worker service port |
| `MEM_ORACLE_DATA_DIR` | `~/.mem-oracle` | Data storage directory |
| `MEM_ORACLE_TOP_K` | `5` | Number of snippets to retrieve |
| `MEM_ORACLE_AUTO_INDEX` | `true` | Auto-index detected doc URLs |

## Usage

Once installed, the plugin automatically:

1. **Starts worker service** on plugin initialization
2. **Detects documentation URLs** in your queries (e.g., `https://nextjs.org/docs`)
3. **Indexes documentation** when URLs are detected
4. **Retrieves relevant snippets** based on your context

### Indexing Documentation

Include a documentation URL in your query:

```
How do I use the App Router? https://nextjs.org/docs/app
```

Or use the `@docs` syntax:

```
@docs nextjs.org /docs/app
```

### Manual Indexing via API

```bash
curl -X POST http://localhost:7432/index \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://nextjs.org", "seedSlug": "/docs/app"}'
```

### Retrieve Documentation

```bash
curl -X POST http://localhost:7432/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "how to use server components", "topK": 5}'
```

## Plugin Hooks

The plugin implements these OpenCode hooks:

- **`event`**: Handles session lifecycle events
- **`tool.execute.before`**: Pre-tool execution (includes .env protection)
- **`tool.execute.after`**: Post-tool execution processing

## Skills

mem-oracle includes a `docs-search` skill that the agent can use to search indexed documentation.

**Location**: `.opencode/skills/docs-search/SKILL.md`

The skill teaches the agent how to:
- Check if the worker is running
- Search indexed documentation
- Index new documentation sites
- Present results with source URLs

OpenCode automatically discovers skills in:
- Project: `.opencode/skills/`
- Global: `~/.config/opencode/skills/`

## Slash Commands

mem-oracle includes these slash commands you can use in OpenCode:

| Command | Description |
|---------|-------------|
| `/reindex <url>` | Re-index a documentation site with fresh content |
| `/docs-status` | Check status of all indexed documentation |
| `/docs-search <query>` | Search through indexed documentation |
| `/refresh-all` | Refresh all stale docsets (older than 24h) |

**Usage examples:**

```
/reindex https://nextjs.org/docs
/docs-status
/docs-search how to use server components
/refresh-all
```

OpenCode automatically discovers commands in:
- Project: `.opencode/command/`
- Global: `~/.config/opencode/command/`

## Troubleshooting

### Worker not starting

Check logs at `~/.mem-oracle/worker.log`:

```bash
tail -f ~/.mem-oracle/worker.log
```

### Health check

```bash
curl http://localhost:7432/health
```

### Manual worker start

```bash
cd /path/to/mem-oracle
bun run src/index.ts worker
```

## Data Storage

All data is stored in `~/.mem-oracle/`:

```
~/.mem-oracle/
├── cache/          # Fetched page cache
├── vectors/        # Vector embeddings
├── worker.pid      # Worker process ID
└── worker.log      # Worker logs
```
