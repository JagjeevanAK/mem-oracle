import { describe, test, expect, mock, beforeEach } from "bun:test";
import { IndexerOrchestrator } from "../src/crawler/orchestrator";

describe("IndexerOrchestrator concurrency", () => {
  let mockMetadataStore: any;
  let mockVectorStore: any;
  let mockFetcher: any;
  let mockExtractor: any;
  let mockChunker: any;
  let mockEmbeddingProvider: any;

  beforeEach(() => {
    mockMetadataStore = {
      getDocset: mock(() => Promise.resolve({
        id: "test-docset",
        name: "Test Docset",
        baseUrl: "https://example.com",
        seedSlug: "/docs",
        allowedPaths: ["/docs"],
        status: "indexing",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      getDocsetByUrl: mock(() => Promise.resolve(null)),
      createDocset: mock((input: any) => Promise.resolve({
        id: "test-docset",
        name: input.name || "Test",
        baseUrl: input.baseUrl,
        seedSlug: input.seedSlug,
        allowedPaths: input.allowedPaths || [input.seedSlug],
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      updateDocset: mock(() => Promise.resolve()),
      getPageByUrl: mock(() => Promise.resolve(null)),
      createPage: mock((page: any) => Promise.resolve({
        id: `page-${Date.now()}`,
        ...page,
      })),
      updatePage: mock(() => Promise.resolve()),
      getNextPendingPage: mock(() => Promise.resolve(null)),
      deleteChunks: mock(() => Promise.resolve()),
      getChunks: mock(() => Promise.resolve([])),
      createChunks: mock((chunks: any[]) => Promise.resolve(
        chunks.map((c, i) => ({ id: `chunk-${i}`, ...c, createdAt: Date.now() }))
      )),
      updateChunk: mock(() => Promise.resolve()),
      listPages: mock(() => Promise.resolve([])),
      getIndexStatus: mock(() => Promise.resolve({
        docsetId: "test-docset",
        totalPages: 0,
        indexedPages: 0,
        pendingPages: 0,
        errorPages: 0,
        totalChunks: 0,
        status: "ready",
      })),
    };

    mockVectorStore = {
      init: mock(() => Promise.resolve()),
      upsert: mock(() => Promise.resolve()),
      search: mock(() => Promise.resolve([])),
      delete: mock(() => Promise.resolve()),
      clear: mock(() => Promise.resolve()),
    };

    mockFetcher = {
      fetch: mock(() => Promise.resolve({
        url: "https://example.com/docs",
        content: "<html><body>Test content</body></html>",
        contentType: "text/html",
        etag: null,
        lastModified: null,
        statusCode: 200,
        fromCache: false,
      })),
    };

    mockExtractor = {
      extract: mock(() => Promise.resolve({
        url: "https://example.com/docs",
        title: "Test Page",
        content: "Test content for embedding",
        links: [],
        headings: [],
      })),
    };

    mockChunker = {
      chunk: mock(() => [{
        content: "Test content",
        heading: null,
        startOffset: 0,
        endOffset: 12,
        index: 0,
      }]),
    };

    mockEmbeddingProvider = {
      name: "mock",
      dimensions: 384,
      embed: mock((texts: string[]) => Promise.resolve(
        texts.map(() => new Array(384).fill(0).map(() => Math.random()))
      )),
      embedSingle: mock(() => Promise.resolve(new Array(384).fill(0).map(() => Math.random()))),
    };
  });

  test("should track in-flight pages and respect concurrency limit", async () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      id: `page-${i}`,
      docsetId: "test-docset",
      url: `https://example.com/docs/page-${i}`,
      path: `/docs/page-${i}`,
      title: null,
      contentHash: null,
      fetchedAt: null,
      indexedAt: null,
      status: "pending" as const,
      errorMessage: null,
      etag: null,
      lastModified: null,
    }));

    let pageIndex = 0;
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockMetadataStore.getNextPendingPage = mock(() => {
      if (pageIndex >= pages.length) return Promise.resolve(null);
      return Promise.resolve(pages[pageIndex++]);
    });

    const originalFetch = mockFetcher.fetch;
    mockFetcher.fetch = mock(async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(r => setTimeout(r, 50));
      currentConcurrent--;
      return originalFetch();
    });

    const orchestrator = new IndexerOrchestrator({
      metadataStore: mockMetadataStore,
      vectorStore: mockVectorStore,
      fetcher: mockFetcher,
      extractor: mockExtractor,
      chunker: mockChunker,
      embeddingProvider: mockEmbeddingProvider,
      crawlerOptions: { maxPages: 100, maxDepth: 10 },
    });

    await orchestrator.indexDocset({
      baseUrl: "https://example.com",
      seedSlug: "/docs",
    }, false);

    await orchestrator.waitForCrawlComplete("test-docset");

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  test("should stop crawl when stopBackgroundCrawl is called", async () => {
    let pageIndex = 0;
    let processedPages = 0;

    mockMetadataStore.getNextPendingPage = mock(() => {
      return Promise.resolve({
        id: `page-${pageIndex++}`,
        docsetId: "test-docset",
        url: `https://example.com/docs/page-${pageIndex}`,
        path: `/docs/page-${pageIndex}`,
        title: null,
        contentHash: null,
        fetchedAt: null,
        indexedAt: null,
        status: "pending" as const,
        errorMessage: null,
        etag: null,
        lastModified: null,
      });
    });

    mockFetcher.fetch = mock(async () => {
      processedPages++;
      await new Promise(r => setTimeout(r, 100));
      return {
        url: "https://example.com/docs",
        content: "<html><body>Test</body></html>",
        contentType: "text/html",
        etag: null,
        lastModified: null,
        statusCode: 200,
        fromCache: false,
      };
    });

    const orchestrator = new IndexerOrchestrator({
      metadataStore: mockMetadataStore,
      vectorStore: mockVectorStore,
      fetcher: mockFetcher,
      extractor: mockExtractor,
      chunker: mockChunker,
      embeddingProvider: mockEmbeddingProvider,
    });

    await orchestrator.indexDocset({
      baseUrl: "https://example.com",
      seedSlug: "/docs",
    }, false);

    await new Promise(r => setTimeout(r, 200));
    orchestrator.stopBackgroundCrawl("test-docset");
    await orchestrator.waitForCrawlComplete("test-docset");

    const processedAtStop = processedPages;
    await new Promise(r => setTimeout(r, 200));

    expect(processedPages).toBeLessThan(50);
    expect(processedPages).toBe(processedAtStop);
  });

  test("isCrawling should return correct state", async () => {
    let pageIndex = 0;
    const pages = Array.from({ length: 3 }, (_, i) => ({
      id: `page-${i}`,
      docsetId: "test-docset",
      url: `https://example.com/docs/page-${i}`,
      path: `/docs/page-${i}`,
      title: null,
      contentHash: null,
      fetchedAt: null,
      indexedAt: null,
      status: "pending" as const,
      errorMessage: null,
      etag: null,
      lastModified: null,
    }));

    mockMetadataStore.getNextPendingPage = mock(() => {
      if (pageIndex >= pages.length) return Promise.resolve(null);
      return Promise.resolve(pages[pageIndex++]);
    });

    mockFetcher.fetch = mock(async () => {
      await new Promise(r => setTimeout(r, 100));
      return {
        url: "https://example.com/docs",
        content: "<html><body>Test</body></html>",
        contentType: "text/html",
        etag: null,
        lastModified: null,
        statusCode: 200,
        fromCache: false,
      };
    });

    const orchestrator = new IndexerOrchestrator({
      metadataStore: mockMetadataStore,
      vectorStore: mockVectorStore,
      fetcher: mockFetcher,
      extractor: mockExtractor,
      chunker: mockChunker,
      embeddingProvider: mockEmbeddingProvider,
    });

    expect(orchestrator.isCrawling("test-docset")).toBe(false);

    await orchestrator.indexDocset({
      baseUrl: "https://example.com",
      seedSlug: "/docs",
    }, false);

    await new Promise(r => setTimeout(r, 50));
    expect(orchestrator.isCrawling("test-docset")).toBe(true);

    await orchestrator.waitForCrawlComplete("test-docset");
    expect(orchestrator.isCrawling("test-docset")).toBe(false);
  });

  test("should complete all pages before marking docset as ready", async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      id: `page-${i}`,
      docsetId: "test-docset",
      url: `https://example.com/docs/page-${i}`,
      path: `/docs/page-${i}`,
      title: null,
      contentHash: null,
      fetchedAt: null,
      indexedAt: null,
      status: "pending" as const,
      errorMessage: null,
      etag: null,
      lastModified: null,
    }));

    let pageIndex = 0;
    mockMetadataStore.getNextPendingPage = mock(() => {
      if (pageIndex >= pages.length) return Promise.resolve(null);
      return Promise.resolve(pages[pageIndex++]);
    });

    const orchestrator = new IndexerOrchestrator({
      metadataStore: mockMetadataStore,
      vectorStore: mockVectorStore,
      fetcher: mockFetcher,
      extractor: mockExtractor,
      chunker: mockChunker,
      embeddingProvider: mockEmbeddingProvider,
    });

    await orchestrator.indexDocset({
      baseUrl: "https://example.com",
      seedSlug: "/docs",
    }, false);

    await orchestrator.waitForCrawlComplete("test-docset");

    const updateCalls = mockMetadataStore.updateDocset.mock.calls;
    const lastCall = updateCalls[updateCalls.length - 1];
    expect(lastCall[1].status).toBe("ready");
  });
});
