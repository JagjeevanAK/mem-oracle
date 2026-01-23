// Worker HTTP service using Bun.serve

import { existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadConfig } from "../config";
import { routeRequest } from "./router";
import { getOrchestrator } from "../crawler/orchestrator";
import { getMetadataStore } from "../storage/metadata";
import { getActiveSessionCount } from "./routes/session";

export interface WorkerServer {
  stop(): void;
  port: number;
  hostname: string;
}

const DATA_DIR = process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle");
const PID_FILE = join(DATA_DIR, "worker.pid");
const INSTALL_SOURCE = process.env.MEM_ORACLE_INSTALL_SOURCE;
const PLUGIN_ROOT = process.env.MEM_ORACLE_PLUGIN_ROOT;
const IDLE_CHECK_MS = Number.parseInt(process.env.MEM_ORACLE_IDLE_CHECK_MS || "15000", 10);
let isIdleCheckRunning = false;

function clearPidFile(): void {
  try {
    writeFileSync(PID_FILE, "");
  } catch {
    // Ignore cleanup errors
  }
}

function cleanupDataDir(): void {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to cleanup data dir:", error);
  }
}

function shutdownWorker(reason: string, removeData: boolean): void {
  console.error(reason);
  clearPidFile();
  if (removeData) {
    cleanupDataDir();
  }
  process.exit(0);
}

async function hasActiveIndexing(): Promise<boolean> {
  try {
    const orchestrator = getOrchestrator();
    const docsets = await orchestrator.listDocsets();
    
    for (const docset of docsets) {
      if (docset.status !== "indexing") {
        continue;
      }
      const indexStatus = await orchestrator.getIndexStatus(docset.id);
      if ((indexStatus?.pendingPages ?? 0) > 0) {
        return true;
      }
    }
  } catch (error) {
    console.error("Failed to check indexing status:", error);
  }
  return false;
}

function startIdleShutdownWatcher(): void {
  if (!INSTALL_SOURCE || !Number.isFinite(IDLE_CHECK_MS) || IDLE_CHECK_MS <= 0) {
    return;
  }
  const interval = setInterval(() => {
    if (isIdleCheckRunning) {
      return;
    }
    isIdleCheckRunning = true;
    void (async () => {
      if (INSTALL_SOURCE === "claude-code" && PLUGIN_ROOT && !existsSync(PLUGIN_ROOT)) {
        shutdownWorker("[mem-oracle] Plugin removed, cleaning up data", true);
        return;
      }
      
      const sessionCount = getActiveSessionCount();
      if (sessionCount > 0) {
        return;
      }
      
      if (await hasActiveIndexing()) {
        return;
      }
      
      shutdownWorker("[mem-oracle] Idle shutdown: no active sessions", false);
    })()
      .catch(error => {
        console.error("Idle shutdown check failed:", error);
      })
      .finally(() => {
        isIdleCheckRunning = false;
      });
  }, IDLE_CHECK_MS);

  process.on("exit", () => {
    clearInterval(interval);
    clearPidFile();
  });
  process.on("SIGTERM", () => {
    shutdownWorker("[mem-oracle] Received SIGTERM, shutting down", false);
  });
  process.on("SIGINT", () => {
    shutdownWorker("[mem-oracle] Received SIGINT, shutting down", false);
  });
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
  
  startIdleShutdownWatcher();
  
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
