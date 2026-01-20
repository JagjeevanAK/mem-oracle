// OpenAI embedding provider

import type { EmbeddingProvider, EmbeddingConfig } from "../types";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions: number;
  
  private apiKey: string;
  private model: string;
  private apiBase: string;
  private batchSize: number;

  constructor(config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error("OpenAI API key is required");
    }
    
    this.apiKey = config.apiKey;
    this.model = config.model || "text-embedding-3-large";
    this.apiBase = config.apiBase || "https://api.openai.com/v1";
    this.batchSize = config.batchSize || 32;
    
    this.dimensions = this.model.includes("3-large") ? 3072 : 
                      this.model.includes("3-small") ? 1536 : 1536;
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
    const response = await fetch(`${this.apiBase}/embeddings`, {
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
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map(d => d.embedding);
  }
}
