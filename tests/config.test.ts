import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DATA_DIR = join(tmpdir(), "mem-oracle-config-test");

describe("config validation", () => {
  let originalHome: string | undefined;
  
  beforeEach(async () => {
    originalHome = process.env.HOME;
    await Bun.$`rm -rf ${TEST_DATA_DIR}`.quiet().nothrow();
    await Bun.$`mkdir -p ${TEST_DATA_DIR}`.quiet();
  });
  
  afterEach(async () => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    await Bun.$`rm -rf ${TEST_DATA_DIR}`.quiet().nothrow();
  });

  test("rejects invalid embedding provider", async () => {
    const configPath = join(TEST_DATA_DIR, "config.json");
    await Bun.write(configPath, JSON.stringify({
      embedding: { provider: "invalid-provider" }
    }));
    
    const { ConfigValidationError, EMBEDDING_PROVIDERS } = await import("../src/config");
    
    const { z } = await import("zod/v4");
    const schema = z.object({
      embedding: z.object({
        provider: z.enum(EMBEDDING_PROVIDERS),
      }).partial().optional(),
    }).strict();
    
    const result = schema.safeParse({ embedding: { provider: "invalid-provider" } });
    expect(result.success).toBe(false);
  });

  test("rejects invalid vectorStore provider", async () => {
    const { VECTOR_STORE_PROVIDERS } = await import("../src/config");
    const { z } = await import("zod/v4");
    
    const schema = z.object({
      vectorStore: z.object({
        provider: z.enum(VECTOR_STORE_PROVIDERS),
      }).partial().optional(),
    }).strict();
    
    const result = schema.safeParse({ vectorStore: { provider: "mongodb" } });
    expect(result.success).toBe(false);
  });

  test("rejects hybrid.alpha outside 0-1 range", async () => {
    const { z } = await import("zod/v4");
    
    const schema = z.object({
      hybrid: z.object({
        alpha: z.number().min(0).max(1),
      }).partial().optional(),
    });
    
    const tooHigh = schema.safeParse({ hybrid: { alpha: 1.5 } });
    expect(tooHigh.success).toBe(false);
    
    const tooLow = schema.safeParse({ hybrid: { alpha: -0.1 } });
    expect(tooLow.success).toBe(false);
    
    const valid = schema.safeParse({ hybrid: { alpha: 0.65 } });
    expect(valid.success).toBe(true);
  });

  test("rejects crawler.concurrency outside valid range", async () => {
    const { z } = await import("zod/v4");
    
    const schema = z.object({
      crawler: z.object({
        concurrency: z.number().int().min(1).max(50),
      }).partial().optional(),
    });
    
    const tooHigh = schema.safeParse({ crawler: { concurrency: 100 } });
    expect(tooHigh.success).toBe(false);
    
    const tooLow = schema.safeParse({ crawler: { concurrency: 0 } });
    expect(tooLow.success).toBe(false);
    
    const valid = schema.safeParse({ crawler: { concurrency: 5 } });
    expect(valid.success).toBe(true);
  });

  test("rejects worker.port outside valid range", async () => {
    const { z } = await import("zod/v4");
    
    const schema = z.object({
      worker: z.object({
        port: z.number().int().min(1).max(65535),
      }).partial().optional(),
    });
    
    const tooHigh = schema.safeParse({ worker: { port: 70000 } });
    expect(tooHigh.success).toBe(false);
    
    const tooLow = schema.safeParse({ worker: { port: 0 } });
    expect(tooLow.success).toBe(false);
    
    const valid = schema.safeParse({ worker: { port: 8080 } });
    expect(valid.success).toBe(true);
  });

  test("rejects unknown top-level fields", async () => {
    const { z } = await import("zod/v4");
    
    const schema = z.object({
      dataDir: z.string().optional(),
    }).strict();
    
    const result = schema.safeParse({ unknownField: "value" });
    expect(result.success).toBe(false);
  });

  test("accepts valid partial config", async () => {
    const { EMBEDDING_PROVIDERS, VECTOR_STORE_PROVIDERS } = await import("../src/config");
    const { z } = await import("zod/v4");
    
    const EmbeddingConfigSchema = z.object({
      provider: z.enum(EMBEDDING_PROVIDERS),
      model: z.string().optional(),
      apiKey: z.string().optional(),
      batchSize: z.number().int().min(1).max(1000).optional(),
    });
    
    const VectorStoreConfigSchema = z.object({
      provider: z.enum(VECTOR_STORE_PROVIDERS),
      collectionPrefix: z.string().optional(),
    });
    
    const schema = z.object({
      dataDir: z.string().optional(),
      embedding: EmbeddingConfigSchema.partial().optional(),
      vectorStore: VectorStoreConfigSchema.partial().optional(),
    }).strict();
    
    const result = schema.safeParse({
      dataDir: "/custom/path",
      embedding: { provider: "openai", model: "text-embedding-3-small" },
      vectorStore: { provider: "qdrant" }
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid URL for embedding.apiBase", async () => {
    const { z } = await import("zod/v4");
    
    const schema = z.object({
      embedding: z.object({
        apiBase: z.url().optional(),
      }).optional(),
    });
    
    const invalid = schema.safeParse({ embedding: { apiBase: "not-a-url" } });
    expect(invalid.success).toBe(false);
    
    const valid = schema.safeParse({ embedding: { apiBase: "https://api.example.com" } });
    expect(valid.success).toBe(true);
  });
});
