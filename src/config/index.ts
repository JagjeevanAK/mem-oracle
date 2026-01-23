// Config loading from ~/.mem-oracle/config.json

import { homedir } from "os";
import { join } from "path";
import { z } from "zod/v4";
import type { MemOracleConfig, EmbeddingConfig, VectorStoreConfig, WorkerConfig, CrawlerConfig, HybridSearchConfig, RetrievalConfig } from "../types";

const DEFAULT_DATA_DIR = join(homedir(), ".mem-oracle");

const EMBEDDING_PROVIDERS = ["local", "openai", "voyage", "cohere"] as const;
const VECTOR_STORE_PROVIDERS = ["local", "qdrant", "pinecone"] as const;

const EmbeddingConfigSchema = z.object({
  provider: z.enum(EMBEDDING_PROVIDERS, {
    error: `Invalid embedding provider. Must be one of: ${EMBEDDING_PROVIDERS.join(", ")}`,
  }),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  apiBase: z.url({ message: "embedding.apiBase must be a valid URL" }).optional(),
  batchSize: z.number().int().min(1, "embedding.batchSize must be at least 1").max(1000, "embedding.batchSize must be at most 1000").optional(),
});

const VectorStoreConfigSchema = z.object({
  provider: z.enum(VECTOR_STORE_PROVIDERS, {
    error: `Invalid vectorStore provider. Must be one of: ${VECTOR_STORE_PROVIDERS.join(", ")}`,
  }),
  url: z.url({ message: "vectorStore.url must be a valid URL" }).optional(),
  apiKey: z.string().optional(),
  collectionPrefix: z.string().optional(),
});

const WorkerConfigSchema = z.object({
  port: z.number().int().min(1, "worker.port must be at least 1").max(65535, "worker.port must be at most 65535"),
  host: z.string().min(1, "worker.host cannot be empty"),
});

const CrawlerConfigSchema = z.object({
  concurrency: z.number().int().min(1, "crawler.concurrency must be at least 1").max(50, "crawler.concurrency must be at most 50"),
  requestDelay: z.number().int().min(0, "crawler.requestDelay cannot be negative").max(60000, "crawler.requestDelay must be at most 60000ms"),
  timeout: z.number().int().min(1000, "crawler.timeout must be at least 1000ms").max(120000, "crawler.timeout must be at most 120000ms"),
  maxPages: z.number().int().min(1, "crawler.maxPages must be at least 1").max(100000, "crawler.maxPages must be at most 100000"),
  userAgent: z.string().min(1, "crawler.userAgent cannot be empty"),
});

const HybridSearchConfigSchema = z.object({
  enabled: z.boolean(),
  alpha: z.number().min(0, "hybrid.alpha must be between 0 and 1").max(1, "hybrid.alpha must be between 0 and 1"),
  vectorTopK: z.number().int().min(1, "hybrid.vectorTopK must be at least 1").max(1000, "hybrid.vectorTopK must be at most 1000").optional(),
  keywordTopK: z.number().int().min(1, "hybrid.keywordTopK must be at least 1").max(1000, "hybrid.keywordTopK must be at most 1000").optional(),
  minKeywordScore: z.number().min(0, "hybrid.minKeywordScore cannot be negative").optional(),
});

const RetrievalConfigSchema = z.object({
  maxChunksPerPage: z.number().int().min(1, "retrieval.maxChunksPerPage must be at least 1").max(20, "retrieval.maxChunksPerPage must be at most 20"),
  maxTotalChars: z.number().int().min(1000, "retrieval.maxTotalChars must be at least 1000").max(500000, "retrieval.maxTotalChars must be at most 500000"),
  formatSnippets: z.boolean(),
  snippetMaxChars: z.number().int().min(100, "retrieval.snippetMaxChars must be at least 100").max(10000, "retrieval.snippetMaxChars must be at most 10000"),
});

const UserConfigSchema = z.object({
  dataDir: z.string().optional(),
  embedding: EmbeddingConfigSchema.partial().optional(),
  vectorStore: VectorStoreConfigSchema.partial().optional(),
  worker: WorkerConfigSchema.partial().optional(),
  crawler: CrawlerConfigSchema.partial().optional(),
  hybrid: HybridSearchConfigSchema.partial().optional(),
  retrieval: RetrievalConfigSchema.partial().optional(),
}).strict();

type ValidatedUserConfig = z.infer<typeof UserConfigSchema>;

class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly invalidFields: string[],
    public readonly details: string[]
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function formatZodError(error: z.ZodError): { invalidFields: string[]; details: string[] } {
  const invalidFields: string[] = [];
  const details: string[] = [];

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    invalidFields.push(path || "(root)");
    details.push(path ? `${path}: ${issue.message}` : issue.message);
  }

  return { invalidFields, details };
}

function validateUserConfig(userConfig: unknown, configPath: string): z.infer<typeof UserConfigSchema> {
  const result = UserConfigSchema.safeParse(userConfig);
  
  if (!result.success) {
    const { invalidFields, details } = formatZodError(result.error);
    const message = [
      `Invalid config in ${configPath}:`,
      "",
      "Validation errors:",
      ...details.map((d) => `  - ${d}`),
      "",
      `Invalid fields: ${invalidFields.join(", ")}`,
    ].join("\n");
    
    throw new ConfigValidationError(message, invalidFields, details);
  }
  
  return result.data;
}

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

const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  enabled: true,
  alpha: 0.65,
  vectorTopK: 20,
  keywordTopK: 20,
  minKeywordScore: 0,
};

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  maxChunksPerPage: 3,
  maxTotalChars: 32000,
  formatSnippets: true,
  snippetMaxChars: 2000,
};

const DEFAULT_CONFIG: MemOracleConfig = {
  dataDir: DEFAULT_DATA_DIR,
  embedding: DEFAULT_EMBEDDING_CONFIG,
  vectorStore: DEFAULT_VECTOR_STORE_CONFIG,
  worker: DEFAULT_WORKER_CONFIG,
  crawler: DEFAULT_CRAWLER_CONFIG,
  hybrid: DEFAULT_HYBRID_CONFIG,
  retrieval: DEFAULT_RETRIEVAL_CONFIG,
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
      const rawConfig = await configFile.json();
      const userConfig = validateUserConfig(rawConfig, configPath);
      cachedConfig = mergeConfig(DEFAULT_CONFIG, userConfig);
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw err;
    }
    if (err instanceof SyntaxError) {
      throw new ConfigValidationError(
        `Invalid JSON in ${configPath}: ${err.message}`,
        ["(json)"],
        [err.message]
      );
    }
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

function mergeConfig(defaults: MemOracleConfig, user: ValidatedUserConfig): MemOracleConfig {
  return {
    dataDir: user.dataDir ?? defaults.dataDir,
    embedding: { ...defaults.embedding, ...user.embedding } as EmbeddingConfig,
    vectorStore: { ...defaults.vectorStore, ...user.vectorStore } as VectorStoreConfig,
    worker: { ...defaults.worker, ...user.worker } as WorkerConfig,
    crawler: { ...defaults.crawler, ...user.crawler } as CrawlerConfig,
    hybrid: { ...defaults.hybrid, ...user.hybrid } as HybridSearchConfig,
    retrieval: { ...defaults.retrieval, ...user.retrieval } as RetrievalConfig,
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

export function resetConfigCache(): void {
  cachedConfig = null;
}

export function validateConfig(config: unknown): ValidatedUserConfig {
  return validateUserConfig(config, "(inline)");
}

export { 
  DEFAULT_CONFIG, 
  DEFAULT_DATA_DIR, 
  ConfigValidationError,
  EMBEDDING_PROVIDERS,
  VECTOR_STORE_PROVIDERS,
};
