// Voyage AI embedding provider

import type { EmbeddingProvider, EmbeddingConfig } from "../types";
import { fetchWithRetry } from "./retry";

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = "voyage";
  readonly dimensions: number;
  
  private apiKey: string;
  private model: string;
  private apiBase: string;
  private batchSize: number;

  constructor(config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error("Voyage API key is required");
    }
    
    this.apiKey = config.apiKey;
    this.model = config.model || "voyage-2";
    this.apiBase = config.apiBase || "https://api.voyageai.com/v1";
    this.batchSize = config.batchSize || 32;
    this.dimensions = 1024;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetchWithRetry(`${this.apiBase}/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map(d => d.embedding);
  }
}
