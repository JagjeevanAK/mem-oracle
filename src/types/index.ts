// Core types and interfaces for mem-oracle

export interface DocsetInput {
  /** Unique identifier for this docset (auto-generated if not provided) */
  id?: string;
  /** Base URL of the documentation site (e.g., "https://nextjs.org") */
  baseUrl: string;
  /** Seed path slug to start indexing from (e.g., "/docs/app/getting-started") */
  seedSlug: string;
  /** Optional: allowed path prefixes for crawling (defaults to seed path prefix) */
  allowedPaths?: string[];
  /** Optional: custom name for the docset */
  name?: string;
}

export interface DocsetRecord {
  id: string;
  name: string;
  baseUrl: string;
  seedSlug: string;
  allowedPaths: string[];
  createdAt: number;
  updatedAt: number;
  status: "pending" | "indexing" | "ready" | "error";
}

export interface PageRecord {
  id: string;
  docsetId: string;
  url: string;
  path: string;
  title: string | null;
  contentHash: string | null;
  fetchedAt: number | null;
  indexedAt: number | null;
  status: "pending" | "fetching" | "fetched" | "indexing" | "indexed" | "error";
  errorMessage: string | null;
  etag: string | null;
  lastModified: string | null;
}

export interface ChunkRecord {
  id: string;
  pageId: string;
  docsetId: string;
  content: string;
  heading: string | null;
  startOffset: number;
  endOffset: number;
  chunkIndex: number;
  embeddingId: string | null;
  createdAt: number;
}

export interface FetchResult {
  url: string;
  content: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  statusCode: number;
  fromCache: boolean;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  links: string[];
  headings: HeadingInfo[];
}

export interface HeadingInfo {
  level: number;
  text: string;
  offset: number;
}

export interface Chunk {
  content: string;
  heading: string | null;
  startOffset: number;
  endOffset: number;
  index: number;
}

export interface EmbeddingVector {
  id: string;
  vector: number[];
  metadata: EmbeddingMetadata;
}

export interface EmbeddingMetadata {
  docsetId: string;
  pageId: string;
  chunkId: string;
  url: string;
  title: string | null;
  heading: string | null;
  content: string;
}

export interface SearchQuery {
  query: string;
  docsetIds?: string[];
  topK?: number;
  minScore?: number;
}

export interface SearchResult {
  chunkId: string;
  pageId: string;
  docsetId: string;
  url: string;
  title: string | null;
  heading: string | null;
  content: string;
  score: number;
}

export interface KeywordSearchResult extends SearchResult {
  bm25: number;
  keywordScore: number;
}

export interface Fetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
}

export interface FetchOptions {
  etag?: string;
  lastModified?: string;
  timeout?: number;
}

export interface Extractor {
  extract(content: string, url: string, contentType: string): Promise<ExtractedContent>;
}

export interface Chunker {
  chunk(content: ExtractedContent, options?: ChunkOptions): Chunk[];
}

export interface ChunkOptions {
  maxChunkSize?: number;
  minChunkSize?: number;
  overlap?: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  embedSingle(text: string): Promise<number[]>;
}

export interface VectorStoreAdapter {
  readonly name: string;
  
  /** Initialize the store for a namespace */
  init(namespace: string): Promise<void>;
  
  /** Add vectors to the store */
  upsert(namespace: string, vectors: EmbeddingVector[]): Promise<void>;
  
  /** Search for similar vectors */
  search(namespace: string, queryVector: number[], topK: number, minScore?: number): Promise<SearchResult[]>;
  
  /** Delete vectors by IDs */
  delete(namespace: string, ids: string[]): Promise<void>;
  
  /** Clear all vectors in a namespace */
  clear(namespace: string): Promise<void>;
}

export interface MetadataStore {
  createDocset(input: DocsetInput): Promise<DocsetRecord>;
  getDocset(id: string): Promise<DocsetRecord | null>;
  getDocsetByUrl(baseUrl: string): Promise<DocsetRecord | null>;
  updateDocset(id: string, updates: Partial<DocsetRecord>): Promise<void>;
  listDocsets(): Promise<DocsetRecord[]>;
  deleteDocset(id: string): Promise<void>;
  
  createPage(page: Omit<PageRecord, "id">): Promise<PageRecord>;
  getPage(id: string): Promise<PageRecord | null>;
  getPageByUrl(docsetId: string, url: string): Promise<PageRecord | null>;
  updatePage(id: string, updates: Partial<PageRecord>): Promise<void>;
  listPages(docsetId: string, status?: PageRecord["status"]): Promise<PageRecord[]>;
  getNextPendingPage(docsetId: string): Promise<PageRecord | null>;
  deletePage(id: string): Promise<void>;
  
  createChunks(chunks: Omit<ChunkRecord, "id" | "createdAt">[]): Promise<ChunkRecord[]>;
  getChunks(pageId: string): Promise<ChunkRecord[]>;
  getChunk(id: string): Promise<ChunkRecord | null>;
  updateChunk(id: string, updates: Partial<ChunkRecord>): Promise<void>;
  deleteChunks(pageId: string): Promise<void>;
  
  getIndexStatus(docsetId: string): Promise<IndexStatus>;

  searchKeyword(
    query: string,
    docsetIds?: string[],
    topK?: number
  ): Promise<KeywordSearchResult[]>;
}

export interface IndexStatus {
  docsetId: string;
  totalPages: number;
  indexedPages: number;
  pendingPages: number;
  errorPages: number;
  totalChunks: number;
  status: DocsetRecord["status"];
}

export interface MemOracleConfig {
  /** Data directory (defaults to ~/.mem-oracle) */
  dataDir: string;
  
  /** Embedding provider config */
  embedding: EmbeddingConfig;
  
  /** Vector store config */
  vectorStore: VectorStoreConfig;
  
  /** Worker service config */
  worker: WorkerConfig;
  
  /** Crawler config */
  crawler: CrawlerConfig;

  /** Hybrid search config */
  hybrid: HybridSearchConfig;
}

export interface EmbeddingConfig {
  /** Provider type: "local" | "openai" | "voyage" | "cohere" */
  provider: string;
  /** Model name (provider-specific) */
  model?: string;
  /** API key (for API providers) */
  apiKey?: string;
  /** Custom API base URL */
  apiBase?: string;
  /** Batch size for embedding requests */
  batchSize?: number;
}

export interface VectorStoreConfig {
  /** Provider type: "local" | "qdrant" | "pinecone" */
  provider: string;
  /** Remote connection URL (for remote providers) */
  url?: string;
  /** API key (for remote providers) */
  apiKey?: string;
  /** Collection/index name prefix */
  collectionPrefix?: string;
}

export interface WorkerConfig {
  /** Port for the worker HTTP service */
  port: number;
  /** Host to bind to */
  host: string;
}

export interface CrawlerConfig {
  /** Maximum concurrent fetches */
  concurrency: number;
  /** Delay between requests to same host (ms) */
  requestDelay: number;
  /** Request timeout (ms) */
  timeout: number;
  /** Maximum pages to crawl per docset */
  maxPages: number;
  /** User agent string */
  userAgent: string;
}

export interface HybridSearchConfig {
  /** Enable hybrid search (keyword + vector) */
  enabled: boolean;
  /** Weight for vector score (0-1) */
  alpha: number;
  /** Vector search headroom */
  vectorTopK?: number;
  /** Keyword search headroom */
  keywordTopK?: number;
  /** Minimum keyword score to keep */
  minKeywordScore?: number;
}

export interface IndexRequest {
  baseUrl: string;
  seedSlug: string;
  name?: string;
  allowedPaths?: string[];
  /** If true, wait for seed page to be indexed before returning */
  waitForSeed?: boolean;
}

export interface IndexResponse {
  docsetId: string;
  status: DocsetRecord["status"];
  seedIndexed: boolean;
}

export interface RetrieveRequest {
  query: string;
  docsetIds?: string[];
  topK?: number;
}

export interface RetrieveResponse {
  results: SearchResult[];
  query: string;
}

export interface StatusRequest {
  docsetId?: string;
}

export interface StatusResponse {
  docsets: (DocsetRecord & { indexStatus: IndexStatus })[];
}
