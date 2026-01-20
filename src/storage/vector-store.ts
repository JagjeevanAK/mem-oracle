// Local vector store using disk-based JSON storage

import { join } from "path";
import type { VectorStoreAdapter, EmbeddingVector, SearchResult } from "../types";
import { getDataDir } from "../config";

interface StoredVector {
  id: string;
  vector: number[];
  metadata: {
    docsetId: string;
    pageId: string;
    chunkId: string;
    url: string;
    title: string | null;
    heading: string | null;
    content: string;
  };
}

interface VectorIndex {
  vectors: StoredVector[];
  dimensions: number;
}

export class LocalVectorStore implements VectorStoreAdapter {
  readonly name = "local";
  private indices: Map<string, VectorIndex> = new Map();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(getDataDir(), "vectors");
  }

  async init(namespace: string): Promise<void> {
    if (this.indices.has(namespace)) {
      return;
    }

    const indexPath = this.getIndexPath(namespace);
    const indexFile = Bun.file(indexPath);
    
    if (await indexFile.exists()) {
      try {
        const data = await indexFile.json() as VectorIndex;
        this.indices.set(namespace, data);
        return;
      } catch {
        console.warn(`Failed to load vector index for ${namespace}, starting fresh`);
      }
    }

    this.indices.set(namespace, { vectors: [], dimensions: 0 });
  }

  async upsert(namespace: string, vectors: EmbeddingVector[]): Promise<void> {
    await this.init(namespace);
    const index = this.indices.get(namespace)!;

    for (const vector of vectors) {
      if (index.dimensions === 0) {
        index.dimensions = vector.vector.length;
      }

      const existingIdx = index.vectors.findIndex(v => v.id === vector.id);
      
      const storedVector: StoredVector = {
        id: vector.id,
        vector: vector.vector,
        metadata: vector.metadata,
      };

      if (existingIdx >= 0) {
        index.vectors[existingIdx] = storedVector;
      } else {
        index.vectors.push(storedVector);
      }
    }

    await this.saveIndex(namespace);
  }

  async search(namespace: string, queryVector: number[], topK: number, minScore = 0): Promise<SearchResult[]> {
    await this.init(namespace);
    const index = this.indices.get(namespace)!;

    if (index.vectors.length === 0) {
      return [];
    }

    const scored = index.vectors.map(stored => ({
      stored,
      score: cosineSimilarity(queryVector, stored.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    
    return scored
      .filter(s => s.score >= minScore)
      .slice(0, topK)
      .map(s => ({
        chunkId: s.stored.metadata.chunkId,
        pageId: s.stored.metadata.pageId,
        docsetId: s.stored.metadata.docsetId,
        url: s.stored.metadata.url,
        title: s.stored.metadata.title,
        heading: s.stored.metadata.heading,
        content: s.stored.metadata.content,
        score: s.score,
      }));
  }

  async delete(namespace: string, ids: string[]): Promise<void> {
    await this.init(namespace);
    const index = this.indices.get(namespace)!;
    
    const idSet = new Set(ids);
    index.vectors = index.vectors.filter(v => !idSet.has(v.id));
    
    await this.saveIndex(namespace);
  }

  async clear(namespace: string): Promise<void> {
    this.indices.set(namespace, { vectors: [], dimensions: 0 });
    
    const indexPath = this.getIndexPath(namespace);
    try {
      await Bun.$`rm -f ${indexPath}`.quiet();
    } catch {
      // File might not exist
    }
  }

  private getIndexPath(namespace: string): string {
    const sanitized = namespace.replace(/[^a-zA-Z0-9-_]/g, "_");
    return join(this.dataDir, `${sanitized}.json`);
  }

  private async saveIndex(namespace: string): Promise<void> {
    const index = this.indices.get(namespace);
    if (!index) return;

    const indexPath = this.getIndexPath(namespace);
    await Bun.write(indexPath, JSON.stringify(index));
  }

  async getStats(namespace: string): Promise<{ vectorCount: number; dimensions: number }> {
    await this.init(namespace);
    const index = this.indices.get(namespace)!;
    return {
      vectorCount: index.vectors.length,
      dimensions: index.dimensions,
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

let vectorStore: LocalVectorStore | null = null;

export function getVectorStore(): LocalVectorStore {
  if (!vectorStore) {
    vectorStore = new LocalVectorStore();
  }
  return vectorStore;
}
