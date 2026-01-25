# Mem-Oracle

#### Local documentation oracle that indexes web docs and injects relevant context into Claude Code sessions.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.5.8-green.svg)](package.json)

[Quick Start](#quick-start) • [Documentation](https://mem-oracle.vercel.app/docs) • [License](#license)


## Quick Start

```sh
# Step 1: Add Marketplace
> /plugin marketplace add jagjeevanak/mem-oracle
# Step 2: Install Plugin
> /plugin install mem-oracle
```

Restart Claude Code. That's it!

**Key Features:**

- **Auto-Indexing** - Index any documentation site with a single command
- **Semantic Search** - Find relevant docs using natural language queries
- **Context Injection** - Relevant snippets auto-injected into prompts
- **Local Storage** - SQLite + disk-based vector store (no external dependencies)
- **Pluggable Embeddings** - Local TF-IDF, OpenAI, Voyage, or Cohere
- **MCP Server** - Explicit tool calls for search/index operations


## Documentation

Full documentation available at **[mem-oracle.vercel.app/docs](https://mem-oracle.vercel.app/docs)**

- [Getting Started](https://mem-oracle.vercel.app/docs/getting-started)
- [Installation](https://mem-oracle.vercel.app/docs/installation)
- [Configuration](https://mem-oracle.vercel.app/docs/configuration)
- [CLI Reference](https://mem-oracle.vercel.app/docs/cli)
- [API Reference](https://mem-oracle.vercel.app/docs/api)
- [MCP Server](https://mem-oracle.vercel.app/docs/mcp)
- [Architecture](https://mem-oracle.vercel.app/docs/architecture)
- [Troubleshooting](https://mem-oracle.vercel.app/docs/troubleshooting)


## License

MIT - See [LICENSE](LICENSE) for details.

