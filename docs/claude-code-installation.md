# Claude Code Installation Guide

mem-oracle plugin for Claude Code - Documentation indexer that auto-injects relevant doc snippets into your coding context.

## Installation

### Via Claude Code Plugin Marketplace

```
> /plugin marketplace add jagjeevanak/mem-oracle
> /plugin install mem-oracle
```

Restart Claude Code after installation.

### Manual Installation

Clone the repository and install:

```bash
git clone https://github.com/jagjeevanak/mem-oracle.git
cd mem-oracle
bun install
```

## Requirements

- **Bun**: JavaScript runtime
- **Node.js**: 18.0.0 or higher
- **Claude Code**: Latest version with plugin support

## Configuration

Settings are configured via the plugin manifest. Default values:

| Setting | Default | Description |
|---------|---------|-------------|
| `worker_port` | `7432` | Worker service port |
| `top_k` | `5` | Number of snippets to retrieve |
| `auto_index` | `true` | Auto-index detected doc URLs |
| `min_score` | `0.5` | Minimum similarity score |

## Plugin Hooks

The Claude Code plugin implements these lifecycle hooks:

- **Install**: Installs dependencies and sets up data directory
- **SessionStart**: Starts the worker service
- **UserPromptSubmit**: Retrieves relevant docs based on prompt
- **PreToolUse**: Pre-tool execution processing
- **PostToolUse**: Post-tool execution processing
- **SessionEnd**: Keeps worker alive for next session

## Usage

Once installed, the plugin automatically:

1. **Starts worker service** on session start
2. **Detects documentation URLs** in your prompts
3. **Indexes documentation** when URLs are detected
4. **Injects relevant snippets** into context

### Indexing Documentation

Include a documentation URL in your prompt:

```
How do I use the App Router? https://nextjs.org/docs/app
```

### Using the Search Skill

The plugin includes a `docs-search` skill for searching indexed documentation.

## Troubleshooting

### Check worker status

```bash
curl http://localhost:7432/health
```

### View logs

```bash
tail -f ~/.mem-oracle/worker.log
```

### Manual worker start

```bash
cd /path/to/mem-oracle
bun run worker
```
