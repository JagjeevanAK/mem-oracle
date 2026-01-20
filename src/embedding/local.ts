// Local embedding provider using TF-IDF based approach

import type { EmbeddingProvider } from "../types";

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly dimensions = 384;

  private vocabulary: Map<string, number> = new Map();

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.embedSingleSync(text));
  }

  async embedSingle(text: string): Promise<number[]> {
    return this.embedSingleSync(text);
  }

  private embedSingleSync(text: string): number[] {
    const tokens = this.tokenize(text);
    const tf = this.calculateTF(tokens);
    
    for (const token of tokens) {
      if (!this.vocabulary.has(token)) {
        this.vocabulary.set(token, this.vocabulary.size);
      }
    }

    const vector = new Array(this.dimensions).fill(0);
    
    for (const [token, freq] of tf) {
      const hash = this.hashString(token);
      const idx = Math.abs(hash) % this.dimensions;
      const sign = hash >= 0 ? 1 : -1;
      vector[idx] += freq * sign;
    }

    return this.normalize(vector);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  private calculateTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }
    const len = tokens.length;
    for (const [token, count] of tf) {
      tf.set(token, count / len);
    }
    return tf;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vector;
    return vector.map(v => v / magnitude);
  }
}
