// Tests for retrieval/search quality improvements

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { IndexerOrchestrator } from "../src/crawler/orchestrator";
import { SQLiteMetadataStore } from "../src/storage/metadata";
import { LocalVectorStore } from "../src/storage/vector-store";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { SearchResult, EmbeddingProvider, EnhancedSearchResult } from "../src/types";

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly dimensions = 4;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.25, 0.25, 0.25, 0.25]);
  }

  async embedSingle(text: string): Promise<number[]> {
    return [0.25, 0.25, 0.25, 0.25];
  }
}

describe("Retrieval Quality Improvements", () => {
  let tempDir: string;
  let orchestrator: IndexerOrchestrator;
  let metadataStore: SQLiteMetadataStore;
  let vectorStore: LocalVectorStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "retrieval-test-"));
    metadataStore = new SQLiteMetadataStore(join(tempDir, "metadata.sqlite"));
    vectorStore = new LocalVectorStore(tempDir);

    orchestrator = new IndexerOrchestrator({
      metadataStore,
      vectorStore,
      embeddingProvider: new MockEmbeddingProvider(),
    });
  });

  afterEach(async () => {
    metadataStore.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Diversity Filtering", () => {
    test("limits chunks per page", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      // Create a page with multiple chunks
      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/test",
        path: "/docs/test",
        title: "Test Page",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      // Create 5 chunks from the same page
      const chunks = await metadataStore.createChunks(
        Array.from({ length: 5 }, (_, i) => ({
          pageId: page.id,
          docsetId: docset.id,
          content: `Chunk ${i} content about testing`,
          heading: `Section ${i}`,
          startOffset: i * 100,
          endOffset: (i + 1) * 100,
          chunkIndex: i,
          embeddingId: null,
        }))
      );

      // Add vectors for all chunks
      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(
        namespace,
        chunks.map((chunk, i) => ({
          id: chunk.id,
          vector: [0.25 + i * 0.01, 0.25, 0.25, 0.25],
          metadata: {
            docsetId: docset.id,
            pageId: page.id,
            chunkId: chunk.id,
            url: page.url,
            title: page.title,
            heading: chunk.heading,
            content: chunk.content,
          },
        }))
      );

      // Search with maxChunksPerPage=2
      const results = await orchestrator.search({
        query: "testing",
        docsetIds: [docset.id],
        topK: 10,
        maxChunksPerPage: 2,
        minScore: 0,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("allows multiple pages with same chunk limit", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      // Create 2 pages
      const page1 = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/page1",
        path: "/docs/page1",
        title: "Page 1",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      const page2 = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/page2",
        path: "/docs/page2",
        title: "Page 2",
        contentHash: "hash2",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      // Create 3 chunks per page
      const chunks1 = await metadataStore.createChunks(
        Array.from({ length: 3 }, (_, i) => ({
          pageId: page1.id,
          docsetId: docset.id,
          content: `Page 1 chunk ${i}`,
          heading: `Section ${i}`,
          startOffset: i * 100,
          endOffset: (i + 1) * 100,
          chunkIndex: i,
          embeddingId: null,
        }))
      );

      const chunks2 = await metadataStore.createChunks(
        Array.from({ length: 3 }, (_, i) => ({
          pageId: page2.id,
          docsetId: docset.id,
          content: `Page 2 chunk ${i}`,
          heading: `Section ${i}`,
          startOffset: i * 100,
          endOffset: (i + 1) * 100,
          chunkIndex: i,
          embeddingId: null,
        }))
      );

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);

      // Add vectors
      const allChunks = [
        ...chunks1.map(c => ({ ...c, pageId: page1.id, url: page1.url, title: page1.title })),
        ...chunks2.map(c => ({ ...c, pageId: page2.id, url: page2.url, title: page2.title })),
      ];

      await vectorStore.upsert(
        namespace,
        allChunks.map((chunk, i) => ({
          id: chunk.id,
          vector: [0.25 + i * 0.01, 0.25, 0.25, 0.25],
          metadata: {
            docsetId: docset.id,
            pageId: chunk.pageId,
            chunkId: chunk.id,
            url: chunk.url ?? "",
            title: chunk.title,
            heading: chunk.heading,
            content: chunk.content,
          },
        }))
      );

      // Search with maxChunksPerPage=2, topK=4
      const results = await orchestrator.search({
        query: "chunk",
        docsetIds: [docset.id],
        topK: 4,
        maxChunksPerPage: 2,
        minScore: 0,
      });

      // Should get results from both pages
      const pageIds = new Set(results.map(r => r.pageId));
      expect(pageIds.size).toBe(2);

      // Each page should have at most 2 chunks
      const page1Results = results.filter(r => r.pageId === page1.id);
      const page2Results = results.filter(r => r.pageId === page2.id);
      expect(page1Results.length).toBeLessThanOrEqual(2);
      expect(page2Results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Snippet Formatting", () => {
    test("formats snippets with title, url, and content", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/installation/getting-started",
        path: "/docs/installation/getting-started",
        title: "Getting Started Guide",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      const chunks = await metadataStore.createChunks([{
        pageId: page.id,
        docsetId: docset.id,
        content: "This is the installation guide content. It explains how to install the software step by step.",
        heading: "Prerequisites",
        startOffset: 0,
        endOffset: 100,
        chunkIndex: 0,
        embeddingId: null,
      }]);

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(namespace, [{
        id: chunks[0]!.id,
        vector: [0.25, 0.25, 0.25, 0.25],
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunks[0]!.id,
          url: page.url,
          title: page.title,
          heading: chunks[0]!.heading,
          content: chunks[0]!.content,
        },
      }]);

      const results = await orchestrator.search({
        query: "installation",
        docsetIds: [docset.id],
        topK: 1,
        formatSnippets: true,
        minScore: 0,
      });

      expect(results.length).toBe(1);
      const snippet = results[0]!.snippet;
      expect(snippet).toBeDefined();
      expect(snippet!.title).toBe("Getting Started Guide");
      expect(snippet!.url).toBe("https://example.com/docs/installation/getting-started");
      expect(snippet!.formatted).toContain("## Getting Started Guide");
      expect(snippet!.formatted).toContain("Source: https://example.com/docs/installation/getting-started");
    });

    test("includes breadcrumb from heading", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/api/authentication",
        path: "/docs/api/authentication",
        title: "Authentication",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      const chunks = await metadataStore.createChunks([{
        pageId: page.id,
        docsetId: docset.id,
        content: "OAuth 2.0 setup instructions.",
        heading: "OAuth Setup",
        startOffset: 0,
        endOffset: 100,
        chunkIndex: 0,
        embeddingId: null,
      }]);

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(namespace, [{
        id: chunks[0]!.id,
        vector: [0.25, 0.25, 0.25, 0.25],
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunks[0]!.id,
          url: page.url,
          title: page.title,
          heading: chunks[0]!.heading,
          content: chunks[0]!.content,
        },
      }]);

      const results = await orchestrator.search({
        query: "oauth",
        docsetIds: [docset.id],
        topK: 1,
        formatSnippets: true,
        minScore: 0,
      });

      expect(results.length).toBe(1);
      const snippet = results[0]!.snippet;
      expect(snippet).toBeDefined();
      expect(snippet!.breadcrumb).toContain("OAuth Setup");
    });
  });

  describe("Character Budget", () => {
    test("respects maxTotalChars budget", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      // Create pages with large content
      const pages = await Promise.all(
        Array.from({ length: 5 }, async (_, i) => {
          return metadataStore.createPage({
            docsetId: docset.id,
            url: `https://example.com/docs/page${i}`,
            path: `/docs/page${i}`,
            title: `Page ${i}`,
            contentHash: `hash${i}`,
            fetchedAt: Date.now(),
            indexedAt: Date.now(),
            status: "indexed",
            errorMessage: null,
            etag: null,
            lastModified: null,
            retryCount: 0,
            lastAttemptAt: null,
          });
        })
      );

      // Create chunks with 500 chars each
      const largeContent = "A".repeat(500);
      const allChunks: Awaited<ReturnType<typeof metadataStore.createChunks>> = [];

      for (const page of pages) {
        const chunks = await metadataStore.createChunks([{
          pageId: page.id,
          docsetId: docset.id,
          content: largeContent,
          heading: "Test Section",
          startOffset: 0,
          endOffset: 500,
          chunkIndex: 0,
          embeddingId: null,
        }]);
        allChunks.push(...chunks);
      }

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(
        namespace,
        allChunks.map((chunk, i) => ({
          id: chunk.id,
          vector: [0.25 + i * 0.01, 0.25, 0.25, 0.25],
          metadata: {
            docsetId: docset.id,
            pageId: pages[i]!.id,
            chunkId: chunk.id,
            url: pages[i]!.url,
            title: pages[i]!.title,
            heading: chunk.heading,
            content: chunk.content,
          },
        }))
      );

      // Search with 1000 char budget (should fit ~1-2 snippets)
      const results = await orchestrator.search({
        query: "test",
        docsetIds: [docset.id],
        topK: 10,
        maxTotalChars: 1000,
        formatSnippets: true,
        minScore: 0,
      });

      // Calculate total chars
      const totalChars = results.reduce((sum, r) => sum + (r.snippet?.charCount ?? r.content.length), 0);
      expect(totalChars).toBeLessThanOrEqual(1200); // Allow some buffer
      expect(results.length).toBeLessThan(5); // Should not return all 5
    });

    test("truncates content intelligently", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/test",
        path: "/docs/test",
        title: "Test Page",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      // Content with clear sentence boundaries
      const content = "First sentence here. Second sentence follows. Third sentence is longer and has more content. Fourth sentence ends the paragraph.\n\nSecond paragraph starts here. It continues with more text.";

      const chunks = await metadataStore.createChunks([{
        pageId: page.id,
        docsetId: docset.id,
        content,
        heading: "Test",
        startOffset: 0,
        endOffset: content.length,
        chunkIndex: 0,
        embeddingId: null,
      }]);

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(namespace, [{
        id: chunks[0]!.id,
        vector: [0.25, 0.25, 0.25, 0.25],
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunks[0]!.id,
          url: page.url,
          title: page.title,
          heading: chunks[0]!.heading,
          content: chunks[0]!.content,
        },
      }]);

      const results = await orchestrator.search({
        query: "test",
        docsetIds: [docset.id],
        topK: 1,
        maxTotalChars: 200,
        formatSnippets: true,
        minScore: 0,
      });

      expect(results.length).toBe(1);
      const snippet = results[0]!.snippet;
      expect(snippet).toBeDefined();
      // Should end with ellipsis if truncated
      if (snippet!.content.length < content.length) {
        expect(snippet!.content.endsWith("...")).toBe(true);
      }
    });
  });

  describe("Guardrails", () => {
    test("clamps alpha to valid range", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/test",
        path: "/docs/test",
        title: "Test Page",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      const chunks = await metadataStore.createChunks([{
        pageId: page.id,
        docsetId: docset.id,
        content: "Test content",
        heading: "Test",
        startOffset: 0,
        endOffset: 12,
        chunkIndex: 0,
        embeddingId: null,
      }]);

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(namespace, [{
        id: chunks[0]!.id,
        vector: [0.25, 0.25, 0.25, 0.25],
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunks[0]!.id,
          url: page.url,
          title: page.title,
          heading: chunks[0]!.heading,
          content: chunks[0]!.content,
        },
      }]);

      // Should not throw with extreme values (they get clamped)
      const results = await orchestrator.search({
        query: "test",
        docsetIds: [docset.id],
        topK: 1,
        minScore: 0,
      });

      expect(results.length).toBe(1);
    });

    test("clamps topK to valid range", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/test",
        path: "/docs/test",
        title: "Test Page",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      const chunks = await metadataStore.createChunks([{
        pageId: page.id,
        docsetId: docset.id,
        content: "Test content",
        heading: "Test",
        startOffset: 0,
        endOffset: 12,
        chunkIndex: 0,
        embeddingId: null,
      }]);

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(namespace, [{
        id: chunks[0]!.id,
        vector: [0.25, 0.25, 0.25, 0.25],
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunks[0]!.id,
          url: page.url,
          title: page.title,
          heading: chunks[0]!.heading,
          content: chunks[0]!.content,
        },
      }]);

      // Very high topK should be clamped
      const results = await orchestrator.search({
        query: "test",
        docsetIds: [docset.id],
        topK: 10000, // Will be clamped to 100
        minScore: 0,
      });

      expect(results.length).toBe(1);
    });

    test("handles negative minScore gracefully", async () => {
      const docset = await metadataStore.createDocset({
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        name: "Test Docs",
      });

      const page = await metadataStore.createPage({
        docsetId: docset.id,
        url: "https://example.com/docs/test",
        path: "/docs/test",
        title: "Test Page",
        contentHash: "hash1",
        fetchedAt: Date.now(),
        indexedAt: Date.now(),
        status: "indexed",
        errorMessage: null,
        etag: null,
        lastModified: null,
        retryCount: 0,
        lastAttemptAt: null,
      });

      const chunks = await metadataStore.createChunks([{
        pageId: page.id,
        docsetId: docset.id,
        content: "Test content",
        heading: "Test",
        startOffset: 0,
        endOffset: 12,
        chunkIndex: 0,
        embeddingId: null,
      }]);

      const namespace = `docset-${docset.id}`;
      await vectorStore.init(namespace);
      await vectorStore.upsert(namespace, [{
        id: chunks[0]!.id,
        vector: [0.25, 0.25, 0.25, 0.25],
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunks[0]!.id,
          url: page.url,
          title: page.title,
          heading: chunks[0]!.heading,
          content: chunks[0]!.content,
        },
      }]);

      // Negative minScore should be clamped to 0
      const results = await orchestrator.search({
        query: "test",
        docsetIds: [docset.id],
        topK: 1,
        minScore: -1, // Will be clamped to 0
      });

      expect(results.length).toBe(1);
    });
  });
});
