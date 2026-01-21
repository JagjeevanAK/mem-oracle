// Config loading from ~/.mem-oracle/config.json

import { homedir } from "os";
import { join } from "path";
import type { MemOracleConfig, EmbeddingConfig, VectorStoreConfig, WorkerConfig, CrawlerConfig } from "../types";

const DEFAULT_DATA_DIR = join(homedir(), ".mem-oracle");

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "local",
  model: "all-MiniLM-L6-v2",
  batchSize: 32,
};

const DEFAULT_VECTOR_STORE_CONFIG: VectorStoreConfig = {
  provider: "local",
  collectionPrefix: "mem-oracle",
};

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  port: 7432,
  host: "127.0.0.1",
};

const DEFAULT_CRAWLER_CONFIG: CrawlerConfig = {
  concurrency: 3,
  requestDelay: 500,
  timeout: 30000,
  maxPages: 1000,
  userAgent: "mem-oracle/1.0 (docs indexer)",
};

const DEFAULT_HYBRID_CONFIG = {
  enabled: true,
  alpha: 0.65,
  vectorTopK: 20,
  keywordTopK: 20,
  minKeywordScore: 0,
};

const DEFAULT_CONFIG: MemOracleConfig = {
  dataDir: DEFAULT_DATA_DIR,
  embedding: DEFAULT_EMBEDDING_CONFIG,
  vectorStore: DEFAULT_VECTOR_STORE_CONFIG,
  worker: DEFAULT_WORKER_CONFIG,
  crawler: DEFAULT_CRAWLER_CONFIG,
  hybrid: DEFAULT_HYBRID_CONFIG,
};

let cachedConfig: MemOracleConfig | null = null;

export async function loadConfig(): Promise<MemOracleConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = join(DEFAULT_DATA_DIR, "config.json");
  
  try {
    const configFile = Bun.file(configPath);
    if (await configFile.exists()) {
      const userConfig = await configFile.json();
      cachedConfig = mergeConfig(DEFAULT_CONFIG, userConfig);
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch {
    console.warn(`Failed to load config from ${configPath}, using defaults`);
    cachedConfig = { ...DEFAULT_CONFIG };
  }

  await ensureDataDir(cachedConfig.dataDir);
  
  return cachedConfig;
}

export function getConfigSync(): MemOracleConfig {
  if (!cachedConfig) {
    return { ...DEFAULT_CONFIG };
  }
  return cachedConfig;
}

function mergeConfig(defaults: MemOracleConfig, user: Partial<MemOracleConfig>): MemOracleConfig {
  return {
    dataDir: user.dataDir ?? defaults.dataDir,
    embedding: { ...defaults.embedding, ...user.embedding },
    vectorStore: { ...defaults.vectorStore, ...user.vectorStore },
    worker: { ...defaults.worker, ...user.worker },
    crawler: { ...defaults.crawler, ...user.crawler },
    hybrid: { ...defaults.hybrid, ...user.hybrid },
  };
}

async function ensureDataDir(dataDir: string): Promise<void> {
  const dirs = [
    dataDir,
    join(dataDir, "cache"),
    join(dataDir, "vectors"),
    join(dataDir, "db"),
  ];
  
  for (const dir of dirs) {
    try {
      await Bun.$`mkdir -p ${dir}`.quiet();
    } catch {
      // Directory might already exist
    }
  }
}

export async function saveConfig(config: MemOracleConfig): Promise<void> {
  const configPath = join(config.dataDir, "config.json");
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

export function getDataDir(): string {
  return cachedConfig?.dataDir ?? DEFAULT_DATA_DIR;
}

export { DEFAULT_CONFIG, DEFAULT_DATA_DIR };
