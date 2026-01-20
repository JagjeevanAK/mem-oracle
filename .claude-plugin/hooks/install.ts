#!/usr/bin/env bun
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { mkdir } from "fs/promises";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".mem-oracle");

function getPluginRoot(): string {
  return dirname(dirname(dirname(new URL(import.meta.url).pathname)));
}

async function installDependencies(): Promise<void> {
  const pluginRoot = getPluginRoot();
  const nodeModules = join(pluginRoot, "node_modules");

  if (existsSync(nodeModules)) {
    console.error("[mem-oracle] Dependencies already installed");
    return;
  }

  console.error("[mem-oracle] Installing dependencies...");

  try {
    execSync("bun install", {
      cwd: pluginRoot,
      stdio: "inherit",
    });
    console.error("[mem-oracle] Dependencies installed successfully");
  } catch (error) {
    console.error("[mem-oracle] Failed to install dependencies:", error);
    throw error;
  }
}

async function setupDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(join(DATA_DIR, "cache"), { recursive: true });
  await mkdir(join(DATA_DIR, "vectors"), { recursive: true });
  console.error("[mem-oracle] Data directory initialized at:", DATA_DIR);
}

async function main() {
  console.error("[mem-oracle] Running installation...");

  await installDependencies();
  await setupDataDir();

  console.error("[mem-oracle] Installation complete");
  console.error("[mem-oracle] The worker will auto-start on next session");
}

main().catch((err) => {
  console.error("[mem-oracle] Installation failed:", err);
  process.exit(1);
});
