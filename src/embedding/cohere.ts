// Cohere embedding provider

import type { EmbeddingProvider, EmbeddingConfig } from "../types";

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly name = "cohere";
  readonly dimensions = 1024;
  
  private apiKey: string;
  private model: string;
  private apiBase: string;
  private batchSize: number;

  constructor(config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error("Cohere API key is required");
    }
    
    this.apiKey = config.apiKey;
    this.model = config.model || "embed-english-v3.0";
    this.apiBase = config.apiBase || "https://api.cohere.ai/v1";
    this.batchSize = config.batchSize || 96;
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
    const response = await fetch(`${this.apiBase}/embed`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        texts,
        model: this.model,
        input_type: "search_document",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    return data.embeddings;
  }
}
