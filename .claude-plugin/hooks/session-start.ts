#!/usr/bin/env bun
// Session start hook - ensures worker service is running

const WORKER_URL = process.env.MEM_ORACLE_WORKER_URL || "http://127.0.0.1:7432";

async function main() {
  try {
    const response = await fetch(`${WORKER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      console.error("[mem-oracle] Worker service is running");
    } else {
      console.error("[mem-oracle] Worker service returned non-ok status");
    }
  } catch {
    console.error("[mem-oracle] Worker service not running. Start with: bun run worker");
  }
}

main().catch(console.error);
