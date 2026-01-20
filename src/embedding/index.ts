// Embedding providers - barrel export

import type { EmbeddingProvider, EmbeddingConfig } from "../types";
import { loadConfig } from "../config";

// Provider implementations
export { LocalEmbeddingProvider } from "./local";
export { OpenAIEmbeddingProvider } from "./openai";
export { VoyageEmbeddingProvider } from "./voyage";
export { CohereEmbeddingProvider } from "./cohere";

// Lazy imports for tree-shaking
async function loadProvider(provider: string): Promise<new (config: EmbeddingConfig) => EmbeddingProvider> {
  switch (provider) {
    case "openai": {
      const { OpenAIEmbeddingProvider } = await import("./openai");
      return OpenAIEmbeddingProvider;
    }
    case "voyage": {
      const { VoyageEmbeddingProvider } = await import("./voyage");
      return VoyageEmbeddingProvider;
    }
    case "cohere": {
      const { CohereEmbeddingProvider } = await import("./cohere");
      return CohereEmbeddingProvider;
    }
    case "local":
    default: {
      const { LocalEmbeddingProvider } = await import("./local");
      return LocalEmbeddingProvider;
    }
  }
}

/**
 * Create an embedding provider from config
 */
export function createEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider {
  const cfg = config ?? { provider: "local" };
  
  // Synchronous creation for known providers
  switch (cfg.provider) {
    case "openai": {
      const { OpenAIEmbeddingProvider } = require("./openai");
      return new OpenAIEmbeddingProvider(cfg);
    }
    case "voyage": {
      const { VoyageEmbeddingProvider } = require("./voyage");
      return new VoyageEmbeddingProvider(cfg);
    }
    case "cohere": {
      const { CohereEmbeddingProvider } = require("./cohere");
      return new CohereEmbeddingProvider(cfg);
    }
    case "local":
    default: {
      const { LocalEmbeddingProvider } = require("./local");
      return new LocalEmbeddingProvider();
    }
  }
}

// Singleton instance (lazy loaded with config)
let embeddingProvider: EmbeddingProvider | null = null;

/**
 * Get the configured embedding provider singleton
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!embeddingProvider) {
    const config = await loadConfig();
    embeddingProvider = createEmbeddingProvider(config.embedding);
  }
  return embeddingProvider;
}

/**
 * Reset the embedding provider (useful for testing)
 */
export function resetEmbeddingProvider(): void {
  embeddingProvider = null;
}
