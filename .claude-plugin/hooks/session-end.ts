#!/usr/bin/env bun
// Session end hook - worker keeps running for next session

async function main() {
  // Worker stays alive between sessions for faster startup
  // To stop it manually: kill $(cat ~/.mem-oracle/worker.pid)
}

main().catch(console.error);
