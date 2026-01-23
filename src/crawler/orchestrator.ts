// Indexer orchestrator - coordinates the fetch/extract/chunk/embed pipeline

import { createHash } from "crypto";
import type {
  DocsetInput,
  DocsetRecord,
  PageRecord,
  EmbeddingVector,
  SearchQuery,
  SearchResult,
  KeywordSearchResult,
} from "../types";
import { getMetadataStore, SQLiteMetadataStore } from "../storage/metadata";
import { getVectorStore, LocalVectorStore } from "../storage/vector-store";
import { getHttpFetcher, HttpFetcher } from "./fetcher";
import { getDocExtractor, DocExtractor } from "./extractor";
import { getTextChunker, TextChunker } from "./chunker";
import { createLinkCrawler, LinkCrawler } from "./crawler";
import { getEmbeddingProvider } from "../embedding";
import { loadConfig } from "../config";
import type { EmbeddingProvider } from "../types";

interface IndexerOptions {
  metadataStore?: SQLiteMetadataStore;
  vectorStore?: LocalVectorStore;
  fetcher?: HttpFetcher;
  extractor?: DocExtractor;
  chunker?: TextChunker;
  embeddingProvider?: EmbeddingProvider;
  crawlerOptions?: { maxPages?: number; maxDepth?: number };
}

interface CrawlRunnerState {
  inFlight: number;
  nextAllowedFetchAt: number;
  stopRequested: boolean;
  runningPromise: Promise<void> | null;
}

export class IndexerOrchestrator {
  private metadataStore: SQLiteMetadataStore;
  private vectorStore: LocalVectorStore;
  private fetcher: HttpFetcher;
  private extractor: DocExtractor;
  private chunker: TextChunker;
  private embeddingProvider: EmbeddingProvider | null = null;
  private crawlers: Map<string, LinkCrawler> = new Map();
  private crawlerOptions: { maxPages?: number; maxDepth?: number };
  private runnerStates: Map<string, CrawlRunnerState> = new Map();

  constructor(options?: IndexerOptions) {
    this.metadataStore = options?.metadataStore ?? getMetadataStore();
    this.vectorStore = options?.vectorStore ?? getVectorStore();
    this.fetcher = options?.fetcher ?? getHttpFetcher();
    this.extractor = options?.extractor ?? getDocExtractor();
    this.chunker = options?.chunker ?? getTextChunker();
    this.embeddingProvider = options?.embeddingProvider ?? null;
    this.crawlerOptions = options?.crawlerOptions ?? {};
  }

  private async getEmbeddingProvider(): Promise<EmbeddingProvider> {
    if (!this.embeddingProvider) {
      this.embeddingProvider = await getEmbeddingProvider();
    }
    return this.embeddingProvider;
  }

  async indexDocset(input: DocsetInput, waitForSeed = true): Promise<DocsetRecord> {
    let docset = await this.metadataStore.getDocsetByUrl(input.baseUrl);
    
    if (!docset) {
      docset = await this.metadataStore.createDocset(input);
    }

    const namespace = this.getNamespace(docset.id);
    await this.vectorStore.init(namespace);
    await this.metadataStore.updateDocset(docset.id, { status: "indexing" });

    const seedUrl = new URL(input.seedSlug, input.baseUrl).toString();
    let seedPage = await this.metadataStore.getPageByUrl(docset.id, seedUrl);
    
    if (!seedPage) {
      seedPage = await this.metadataStore.createPage({
        docsetId: docset.id,
        url: seedUrl,
        path: input.seedSlug,
        title: null,
        contentHash: null,
        fetchedAt: null,
        indexedAt: null,
        status: "pending",
        errorMessage: null,
        etag: null,
        lastModified: null,
      });
    }

    if (waitForSeed && seedPage.status !== "indexed") {
      await this.indexPage(docset, seedPage);
      docset = (await this.metadataStore.getDocset(docset.id))!;
    }

    this.startBackgroundCrawl(docset.id);

    return docset;
  }

  async indexPage(docset: DocsetRecord, page: PageRecord): Promise<void> {
    const namespace = this.getNamespace(docset.id);

    try {
      await this.metadataStore.updatePage(page.id, { status: "fetching" });

      const fetchResult = await this.fetcher.fetch(page.url, {
        etag: page.etag ?? undefined,
        lastModified: page.lastModified ?? undefined,
      });

      const contentHash = createHash("sha256").update(fetchResult.content).digest("hex");
      
      if (page.contentHash === contentHash && page.status === "indexed") {
        await this.metadataStore.updatePage(page.id, {
          fetchedAt: Date.now(),
          etag: fetchResult.etag,
          lastModified: fetchResult.lastModified,
        });
        return;
      }

      await this.metadataStore.updatePage(page.id, {
        status: "fetched",
        fetchedAt: Date.now(),
        contentHash,
        etag: fetchResult.etag,
        lastModified: fetchResult.lastModified,
      });

      const extracted = await this.extractor.extract(
        fetchResult.content,
        page.url,
        fetchResult.contentType
      );

      await this.metadataStore.updatePage(page.id, {
        title: extracted.title,
        status: "indexing",
      });

      const crawler = this.getCrawler(docset.id);
      await crawler.discoverLinks(docset, page.url, extracted.links, 0);

      await this.metadataStore.deleteChunks(page.id);

      const chunks = this.chunker.chunk(extracted);

      if (chunks.length === 0) {
        await this.metadataStore.updatePage(page.id, {
          status: "indexed",
          indexedAt: Date.now(),
        });
        return;
      }

      const chunkRecords = await this.metadataStore.createChunks(
        chunks.map(chunk => ({
          pageId: page.id,
          docsetId: docset.id,
          content: chunk.content,
          heading: chunk.heading,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          chunkIndex: chunk.index,
          embeddingId: null,
        }))
      );

      const embeddingProvider = await this.getEmbeddingProvider();
      const embeddings = await embeddingProvider.embed(
        chunkRecords.map(c => c.content)
      );

      const vectors: EmbeddingVector[] = chunkRecords.map((chunk, i) => ({
        id: chunk.id,
        vector: embeddings[i]!,
        metadata: {
          docsetId: docset.id,
          pageId: page.id,
          chunkId: chunk.id,
          url: page.url,
          title: extracted.title,
          heading: chunk.heading,
          content: chunk.content,
        },
      }));

      await this.vectorStore.upsert(namespace, vectors);

      for (const chunk of chunkRecords) {
        await this.metadataStore.updateChunk(chunk.id, { embeddingId: chunk.id });
      }

      await this.metadataStore.updatePage(page.id, {
        status: "indexed",
        indexedAt: Date.now(),
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error indexing page ${page.url}:`, errorMessage);
      
      // HTTP 401/403/404 are expected (auth-protected or missing pages) - mark as skipped
      const isSkippable = /^HTTP (401|403|404)\b/.test(errorMessage);
      
      await this.metadataStore.updatePage(page.id, {
        status: isSkippable ? "skipped" : "error",
        errorMessage,
      });
    }
  }

  /**
   * Search across indexed documents
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const config = await loadConfig();
    const embeddingProvider = await this.getEmbeddingProvider();
    const queryVector = await embeddingProvider.embedSingle(query.query);
    
    const topK = query.topK ?? 10;
    const minScore = query.minScore ?? 0.5;
    const vectorTopK = config.hybrid?.vectorTopK ?? Math.max(topK * 3, 20);
    const keywordTopK = config.hybrid?.keywordTopK ?? Math.max(topK * 3, 20);
    const alpha = config.hybrid?.alpha ?? 0.65;
    const minKeywordScore = config.hybrid?.minKeywordScore ?? 0;

    const vectorResults = await this.searchVector(
      queryVector,
      query.docsetIds,
      vectorTopK,
      minScore
    );

    if (!config.hybrid?.enabled) {
      return vectorResults.slice(0, topK);
    }

    const keywordResults = await this.metadataStore.searchKeyword(
      query.query,
      query.docsetIds,
      keywordTopK
    );

    if (keywordResults.length === 0) {
      return vectorResults.slice(0, topK);
    }

    return this.mergeHybridResults(
      vectorResults,
      keywordResults,
      alpha,
      minKeywordScore,
      topK
    );
  }

  private async searchVector(
    queryVector: number[],
    docsetIds: string[] | undefined,
    topK: number,
    minScore: number
  ): Promise<SearchResult[]> {
    if (docsetIds && docsetIds.length > 0) {
      const results: SearchResult[] = [];
      for (const docsetId of docsetIds) {
        const namespace = this.getNamespace(docsetId);
        const docsetResults = await this.vectorStore.search(
          namespace,
          queryVector,
          topK,
          minScore
        );
        results.push(...docsetResults);
      }
      return results.sort((a, b) => b.score - a.score).slice(0, topK);
    }

    const docsets = await this.metadataStore.listDocsets();
    const results: SearchResult[] = [];

    for (const docset of docsets) {
      const namespace = this.getNamespace(docset.id);
      const docsetResults = await this.vectorStore.search(
        namespace,
        queryVector,
        topK,
        minScore
      );
      results.push(...docsetResults);
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private mergeHybridResults(
    vectorResults: SearchResult[],
    keywordResults: KeywordSearchResult[],
    alpha: number,
    minKeywordScore: number,
    topK: number
  ): SearchResult[] {
    const resultsMap = new Map<
      string,
      { result: SearchResult; vectorScore: number; keywordScore: number }
    >();

    for (const result of vectorResults) {
      resultsMap.set(result.chunkId, {
        result,
        vectorScore: result.score,
        keywordScore: 0,
      });
    }

    for (const keywordResult of keywordResults) {
      if (keywordResult.keywordScore < minKeywordScore) continue;
      const existing = resultsMap.get(keywordResult.chunkId);
      if (existing) {
        existing.keywordScore = Math.max(existing.keywordScore, keywordResult.keywordScore);
      } else {
        resultsMap.set(keywordResult.chunkId, {
          result: {
            chunkId: keywordResult.chunkId,
            pageId: keywordResult.pageId,
            docsetId: keywordResult.docsetId,
            url: keywordResult.url,
            title: keywordResult.title,
            heading: keywordResult.heading,
            content: keywordResult.content,
            score: keywordResult.keywordScore,
          },
          vectorScore: 0,
          keywordScore: keywordResult.keywordScore,
        });
      }
    }

    const merged = Array.from(resultsMap.values()).map(({ result, vectorScore, keywordScore }) => {
      const safeKeywordScore = Math.max(0, Math.min(1, keywordScore));
      const safeVectorScore = Math.max(0, Math.min(1, vectorScore));
      const hybridScore = alpha * safeVectorScore + (1 - alpha) * safeKeywordScore;
      return { ...result, score: hybridScore };
    });

    return merged.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private getRunnerState(docsetId: string): CrawlRunnerState {
    let state = this.runnerStates.get(docsetId);
    if (!state) {
      state = {
        inFlight: 0,
        nextAllowedFetchAt: 0,
        stopRequested: false,
        runningPromise: null,
      };
      this.runnerStates.set(docsetId, state);
    }
    return state;
  }

  private async waitForFetchSlot(state: CrawlRunnerState, requestDelay: number): Promise<void> {
    const now = Date.now();
    if (now < state.nextAllowedFetchAt) {
      await new Promise(resolve => setTimeout(resolve, state.nextAllowedFetchAt - now));
    }
    state.nextAllowedFetchAt = Date.now() + requestDelay;
  }

  private startBackgroundCrawl(docsetId: string): void {
    const state = this.getRunnerState(docsetId);
    
    if (state.runningPromise) {
      return;
    }

    state.stopRequested = false;
    state.runningPromise = this.runConcurrentCrawl(docsetId, state);
    
    state.runningPromise
      .catch(err => console.error(`Background crawl error for ${docsetId}:`, err))
      .finally(() => {
        state.runningPromise = null;
      });
  }

  private async runConcurrentCrawl(docsetId: string, state: CrawlRunnerState): Promise<void> {
    const config = await loadConfig();
    const concurrency = config.crawler.concurrency;
    const requestDelay = config.crawler.requestDelay;

    const docset = await this.metadataStore.getDocset(docsetId);
    if (!docset) {
      return;
    }

    const crawler = this.getCrawler(docsetId);
    if (!crawler.hasMore()) {
      await crawler.loadPendingPages(docsetId);
    }

    const workers: Promise<void>[] = [];

    const spawnWorker = async (): Promise<void> => {
      while (!state.stopRequested) {
        if (state.inFlight >= concurrency) {
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        const page = await this.metadataStore.getNextPendingPage(docsetId);
        if (!page) {
          break;
        }

        state.inFlight++;

        const currentDocset = await this.metadataStore.getDocset(docsetId);
        if (!currentDocset) {
          state.inFlight--;
          break;
        }

        await this.waitForFetchSlot(state, requestDelay);

        this.indexPage(currentDocset, page)
          .catch(err => console.error(`Error indexing ${page.url}:`, err))
          .finally(() => {
            state.inFlight--;
          });

        if (!crawler.hasMore()) {
          await crawler.loadPendingPages(docsetId);
        }
      }
    };

    for (let i = 0; i < concurrency; i++) {
      workers.push(spawnWorker());
    }

    await Promise.all(workers);

    while (state.inFlight > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!state.stopRequested) {
      await this.metadataStore.updateDocset(docsetId, { status: "ready" });
    }
  }

  /**
   * Resume background crawling for a docset (called on worker restart)
   */
  resumeBackgroundCrawl(docsetId: string): void {
    this.startBackgroundCrawl(docsetId);
  }

  /**
   * Stop background crawling for a docset
   */
  stopBackgroundCrawl(docsetId: string): void {
    const state = this.runnerStates.get(docsetId);
    if (state) {
      state.stopRequested = true;
    }
  }

  /**
   * Stop all background crawling
   */
  stopAllBackgroundCrawls(): void {
    for (const [docsetId] of this.runnerStates) {
      this.stopBackgroundCrawl(docsetId);
    }
  }

  /**
   * Check if a docset is currently being crawled
   */
  isCrawling(docsetId: string): boolean {
    const state = this.runnerStates.get(docsetId);
    if (!state) return false;
    return state.runningPromise !== null && !state.stopRequested;
  }

  /**
   * Wait for background crawl to complete (useful for testing)
   */
  async waitForCrawlComplete(docsetId: string): Promise<void> {
    const state = this.runnerStates.get(docsetId);
    if (state?.runningPromise) {
      await state.runningPromise;
    }
  }

  private getCrawler(docsetId: string): LinkCrawler {
    let crawler = this.crawlers.get(docsetId);
    if (!crawler) {
      crawler = createLinkCrawler(this.crawlerOptions);
      this.crawlers.set(docsetId, crawler);
    }
    return crawler;
  }

  private getNamespace(docsetId: string): string {
    return `docset-${docsetId}`;
  }

  /**
   * Get index status for a docset
   */
  async getIndexStatus(docsetId: string) {
    return this.metadataStore.getIndexStatus(docsetId);
  }

  /**
   * List all docsets
   */
  async listDocsets() {
    return this.metadataStore.listDocsets();
  }

  /**
   * Delete a docset and all its data
   */
  async deleteDocset(docsetId: string): Promise<void> {
    this.stopBackgroundCrawl(docsetId);
    const namespace = this.getNamespace(docsetId);
    await this.vectorStore.clear(namespace);
    this.crawlers.delete(docsetId);
    await this.metadataStore.deleteDocset(docsetId);
  }
}

let orchestrator: IndexerOrchestrator | null = null;

export function getOrchestrator(): IndexerOrchestrator {
  if (!orchestrator) {
    orchestrator = new IndexerOrchestrator();
  }
  return orchestrator;
}
