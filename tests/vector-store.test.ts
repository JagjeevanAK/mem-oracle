import { describe, test, expect, beforeEach } from "bun:test";
import { LocalVectorStore } from "../src/storage/vector-store";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("LocalVectorStore", () => {
  let store: LocalVectorStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mem-oracle-test-"));
    store = new LocalVectorStore(tempDir);
  });

  test("should initialize namespace", async () => {
    await store.init("test-namespace");
    const stats = await store.getStats("test-namespace");
    
    expect(stats.vectorCount).toBe(0);
  });

  test("should upsert vectors", async () => {
    await store.init("test");
    
    await store.upsert("test", [
      {
        id: "vec1",
        vector: [1, 0, 0],
        metadata: {
          docsetId: "doc1",
          pageId: "page1",
          chunkId: "chunk1",
          url: "https://example.com",
          title: "Test",
          heading: null,
          content: "Test content",
        },
      },
    ]);

    const stats = await store.getStats("test");
    expect(stats.vectorCount).toBe(1);
  });

  test("should search vectors by similarity", async () => {
    await store.init("test");
    
    await store.upsert("test", [
      {
        id: "vec1",
        vector: [1, 0, 0],
        metadata: {
          docsetId: "doc1",
          pageId: "page1",
          chunkId: "chunk1",
          url: "https://example.com/1",
          title: "Doc 1",
          heading: null,
          content: "First document",
        },
      },
      {
        id: "vec2",
        vector: [0, 1, 0],
        metadata: {
          docsetId: "doc1",
          pageId: "page2",
          chunkId: "chunk2",
          url: "https://example.com/2",
          title: "Doc 2",
          heading: null,
          content: "Second document",
        },
      },
    ]);

    const results = await store.search("test", [1, 0, 0], 1, 0);
    
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe("chunk1");
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  test("should delete vectors", async () => {
    await store.init("test");
    
    await store.upsert("test", [
      {
        id: "vec1",
        vector: [1, 0, 0],
        metadata: {
          docsetId: "doc1",
          pageId: "page1",
          chunkId: "chunk1",
          url: "https://example.com",
          title: "Test",
          heading: null,
          content: "Content",
        },
      },
    ]);

    await store.delete("test", ["vec1"]);
    
    const stats = await store.getStats("test");
    expect(stats.vectorCount).toBe(0);
  });

  test("should clear namespace", async () => {
    await store.init("test");
    
    await store.upsert("test", [
      {
        id: "vec1",
        vector: [1, 0, 0],
        metadata: {
          docsetId: "doc1",
          pageId: "page1",
          chunkId: "chunk1",
          url: "https://example.com",
          title: "Test",
          heading: null,
          content: "Content",
        },
      },
    ]);

    await store.clear("test");
    
    const stats = await store.getStats("test");
    expect(stats.vectorCount).toBe(0);
  });
});
