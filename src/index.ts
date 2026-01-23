// mem-oracle - Documentation indexer and retrieval for Claude Code

// Re-export all types
export * from "./types";

// Config
export { loadConfig, saveConfig, getDataDir, DEFAULT_CONFIG } from "./config";

// Storage
export * from "./storage";

// Crawler
export * from "./crawler";

// Embedding
export * from "./embedding";

// Worker
export * from "./worker";

// Plugin hooks
export * from "./plugin";

// MCP
export * from "./mcp";

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "worker":
    case "serve": {
      const { startWorkerServer } = await import("./worker");
      await startWorkerServer();
      break;
    }

    case "mcp": {
      const { startMcpServer } = await import("./mcp");
      await startMcpServer();
      break;
    }

    case "index": {
      const url = args[1];
      if (!url) {
        console.error("Usage: mem-oracle index <url>");
        console.error("Example: mem-oracle index https://nextjs.org/docs/getting-started");
        process.exit(1);
      }

      const { parseDocUrl } = await import("./plugin");
      const { getOrchestrator } = await import("./crawler");
      const { loadConfig } = await import("./config");

      await loadConfig();

      const parsed = parseDocUrl(url);
      if (!parsed) {
        console.error("Invalid URL format");
        process.exit(1);
      }

      console.log(`Indexing ${parsed.baseUrl}${parsed.seedSlug}...`);

      const orchestrator = getOrchestrator();
      const docset = await orchestrator.indexDocset(parsed, true);
      const status = await orchestrator.getIndexStatus(docset.id);

      console.log(`\nDocset: ${docset.name} (${docset.id})`);
      console.log(`Status: ${status.status}`);
      console.log(`Pages indexed: ${status.indexedPages}/${status.totalPages}`);
      console.log(`Chunks: ${status.totalChunks}`);

      console.log("\nBackground indexing continues... Press Ctrl+C to stop.");
      break;
    }

    case "search": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: mem-oracle search <query>");
        process.exit(1);
      }

      const { getOrchestrator } = await import("./crawler");
      const { loadConfig } = await import("./config");

      await loadConfig();

      const orchestrator = getOrchestrator();
      const results = await orchestrator.search({ query, topK: 5 });

      if (results.length === 0) {
        console.log("No results found.");
      } else {
        for (const result of results) {
          console.log(`\n--- ${result.title || result.url} ---`);
          if (result.heading) console.log(`Section: ${result.heading}`);
          console.log(`Score: ${(result.score * 100).toFixed(1)}%`);
          console.log(`URL: ${result.url}`);
          console.log("");
          console.log(result.content.slice(0, 500) + (result.content.length > 500 ? "..." : ""));
        }
      }
      break;
    }

    case "status": {
      const { getOrchestrator } = await import("./crawler");
      const { loadConfig } = await import("./config");

      await loadConfig();

      const orchestrator = getOrchestrator();
      const docsets = await orchestrator.listDocsets();

      if (docsets.length === 0) {
        console.log("No docsets indexed yet.");
      } else {
        for (const docset of docsets) {
          const status = await orchestrator.getIndexStatus(docset.id);
          console.log(`\n${docset.name} (${docset.baseUrl})`);
          console.log(`  ID: ${docset.id}`);
          console.log(`  Status: ${status.status}`);
          console.log(`  Pages: ${status.indexedPages}/${status.totalPages} indexed`);
          console.log(`  Pending: ${status.pendingPages}, Errors: ${status.errorPages}, Skipped: ${status.skippedPages}`);
          console.log(`  Chunks: ${status.totalChunks}`);
        }
      }
      break;
    }

    default:
      console.log("mem-oracle - Documentation indexer for Claude Code");
      console.log("");
      console.log("Usage: mem-oracle <command> [options]");
      console.log("");
      console.log("Commands:");
      console.log("  worker, serve     Start the worker HTTP service");
      console.log("  mcp              Start the MCP server (stdio)");
      console.log("  index <url>      Index a documentation URL");
      console.log("  search <query>   Search indexed documentation");
      console.log("  status           Show indexing status");
      console.log("");
      console.log("Examples:");
      console.log("  mem-oracle worker");
      console.log("  mem-oracle index https://nextjs.org/docs/getting-started");
      console.log("  mem-oracle search \"how to use server components\"");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
