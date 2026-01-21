// Worker HTTP service using Bun.serve

import { loadConfig } from "../config";
import { routeRequest } from "./router";
import { getOrchestrator } from "../crawler/orchestrator";
import { getMetadataStore } from "../storage/metadata";

export interface WorkerServer {
  stop(): void;
  port: number;
  hostname: string;
}

async function resumePendingIndexing(): Promise<void> {
  const metadataStore = getMetadataStore();
  const orchestrator = getOrchestrator();
  
  const docsets = await metadataStore.listDocsets();
  
  for (const docset of docsets) {
    if (docset.status === "indexing") {
      const status = await metadataStore.getIndexStatus(docset.id);
      if (status && status.pendingPages > 0) {
        console.log(`Resuming indexing for ${docset.name}: ${status.pendingPages} pages pending`);
        orchestrator.resumeBackgroundCrawl(docset.id);
      }
    }
  }
}

export async function startWorkerServer(): Promise<WorkerServer> {
  const config = await loadConfig();
  const { port, host } = config.worker;

  const server = Bun.serve({
    port,
    hostname: host,
    fetch: routeRequest,
  });

  console.log(`mem-oracle worker listening on http://${host}:${port}`);
  
  // Resume any pending indexing jobs
  resumePendingIndexing().catch(err => {
    console.error("Failed to resume pending indexing:", err);
  });
  
  return {
    stop: () => server.stop(),
    port: server.port ?? port,
    hostname: server.hostname ?? host,
  };
}

// CLI entry point
if (import.meta.main) {
  startWorkerServer().catch(console.error);
}
