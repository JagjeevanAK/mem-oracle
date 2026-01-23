# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.4] - 2026-01-24

### Added

- **Pages listing API** - New `/pages/:docsetId` endpoint to list and filter pages by status
- **Retry with exponential backoff** - New retry mechanism for embedding API calls with jitter and Retry-After header support

### Changed

- **Concurrent crawling** - Improved orchestrator with proper concurrency control using `CrawlRunnerState`
- **HTTP error handling** - 401/403/404 responses now mark pages as "skipped" instead of "error"
- **Rate limiting** - Better fetch slot management with configurable request delays

### Fixed

- Embedding providers now use retry logic for transient failures (429, 500, 502, 503, 504)

## [1.0.0] - 2026-01-20

### Added

- Initial release of mem-oracle
- **Core Features**
  - Seed-first indexing with background crawling
  - Local SQLite metadata storage
  - Disk-based vector store with cosine similarity search
  - Content caching with ETag/Last-Modified support

- **Embedding Providers**
  - Local TF-IDF based embeddings (no API required)
  - OpenAI embeddings support
  - Voyage AI embeddings support
  - Cohere embeddings support

- **Worker Service**
  - HTTP API on port 7432
  - `/index` - Index documentation sites
  - `/retrieve` - Search indexed documentation
  - `/status` - Get indexing status
  - `/health` - Health check endpoint

- **Claude Code Plugin**
  - `.claude-plugin` directory with lifecycle hooks
  - Auto-injection of relevant documentation into prompts
  - `docs-search` skill for manual queries

- **MCP Server**
  - `search_docs` - Search indexed documentation
  - `index_docs` - Index new documentation sites
  - `index_status` - Get indexing status
  - `get_snippets` - Retrieve specific chunks

- **CLI Commands**
  - `bun run worker` - Start worker service
  - `bun run mcp` - Start MCP server
  - `mem-oracle index <url>` - Index documentation
  - `mem-oracle search <query>` - Search documentation
  - `mem-oracle status` - Show indexing status
