// Worker HTTP service using Bun.serve

import { loadConfig } from "../config";
import { routeRequest } from "./router";

export interface WorkerServer {
  stop(): void;
  port: number;
  hostname: string;
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
