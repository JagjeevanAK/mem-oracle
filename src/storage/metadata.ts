// SQLite metadata store using bun:sqlite

import { Database } from "bun:sqlite";
import { join } from "path";
import { randomUUID } from "crypto";
import type {
  MetadataStore,
  DocsetInput,
  DocsetRecord,
  PageRecord,
  ChunkRecord,
  IndexStatus,
  KeywordSearchResult,
  StuckPageInfo,
} from "../types";
import { getDataDir } from "../config";
import type { SectionInfo } from "../utils/sections";
import { deriveSectionInfoFromPath } from "../utils/sections";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docsets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  seed_slug TEXT NOT NULL,
  allowed_paths TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_docsets_base_url ON docsets(base_url);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  docset_id TEXT NOT NULL,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  section_root TEXT,
  section_path TEXT,
  title TEXT,
  content_hash TEXT,
  fetched_at INTEGER,
  indexed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  etag TEXT,
  last_modified TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  FOREIGN KEY (docset_id) REFERENCES docsets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pages_docset_id ON pages(docset_id);
CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(docset_id, url);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(docset_id, status);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  docset_id TEXT NOT NULL,
  content TEXT NOT NULL,
  heading TEXT,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  FOREIGN KEY (docset_id) REFERENCES docsets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_page_id ON chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_chunks_docset_id ON chunks(docset_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  docset_id UNINDEXED,
  page_id UNINDEXED,
  url UNINDEXED,
  title,
  heading,
  content,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS chunks_fts_meta (
  chunk_id TEXT PRIMARY KEY,
  docset_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_fts_meta_docset_id ON chunks_fts_meta(docset_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fts_meta_page_id ON chunks_fts_meta(page_id);
`;

export class SQLiteMetadataStore implements MetadataStore {
  private db: Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(getDataDir(), "db", "metadata.sqlite");
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(SCHEMA);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    const columns = this.db
      .query("PRAGMA table_info(pages)")
      .all() as { name: string }[];
    const columnNames = new Set(columns.map(c => c.name));

    if (!columnNames.has("retry_count")) {
      this.db.run("ALTER TABLE pages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!columnNames.has("last_attempt_at")) {
      this.db.run("ALTER TABLE pages ADD COLUMN last_attempt_at INTEGER");
    }
    const hasSectionRoot = columnNames.has("section_root");
    if (!hasSectionRoot) {
      this.db.run("ALTER TABLE pages ADD COLUMN section_root TEXT");
    }
    const hasSectionPath = columnNames.has("section_path");
    if (!hasSectionPath) {
      this.db.run("ALTER TABLE pages ADD COLUMN section_path TEXT");
    }

    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_pages_section_root ON pages(docset_id, section_root)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_pages_section_path ON pages(docset_id, section_path)"
    );

    this.backfillSectionFields();
  }

  private backfillSectionFields(): void {
    const rows = this.db.query(`
      SELECT id, path, section_root, section_path
      FROM pages
      WHERE section_root IS NULL OR section_path IS NULL
    `).all() as {
      id: string;
      path: string;
      section_root: string | null;
      section_path: string | null;
    }[];

    if (rows.length === 0) {
      return;
    }

    const updateStmt = this.db.query(`
      UPDATE pages
      SET section_root = ?, section_path = ?
      WHERE id = ?
    `);

    const tx = this.db.transaction((data: typeof rows) => {
      for (const row of data) {
        const derived = deriveSectionInfoFromPath(row.path);
        updateStmt.run(derived.sectionRoot, derived.sectionPath, row.id);
      }
    });

    tx(rows);
  }

  private buildFtsQuery(query: string): string {
    const normalized = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(word => word.length > 1);

    if (normalized.length === 0) {
      return query;
    }

    return normalized.map(word => `${word}*`).join(" ");
  }

  private getPageInfoMap(pageIds: string[]): Map<string, { url: string; title: string | null }> {
    if (pageIds.length === 0) {
      return new Map();
    }

    const placeholders = pageIds.map(() => "?").join(", ");
    const stmt = this.db.query(
      `SELECT id, url, title FROM pages WHERE id IN (${placeholders})`
    );
    const rows = stmt.all(...pageIds) as { id: string; url: string; title: string | null }[];
    const map = new Map<string, { url: string; title: string | null }>();
    for (const row of rows) {
      map.set(row.id, { url: row.url, title: row.title });
    }
    return map;
  }

  async getPageSections(pageIds: string[]): Promise<Map<string, SectionInfo>> {
    if (pageIds.length === 0) {
      return new Map();
    }

    const placeholders = pageIds.map(() => "?").join(", ");
    const stmt = this.db.query(
      `SELECT id, path, section_root, section_path FROM pages WHERE id IN (${placeholders})`
    );
    const rows = stmt.all(...pageIds) as {
      id: string;
      path: string;
      section_root: string | null;
      section_path: string | null;
    }[];
    const map = new Map<string, SectionInfo>();
    for (const row of rows) {
      if (row.section_root || row.section_path) {
        map.set(row.id, {
          sectionRoot: row.section_root ?? null,
          sectionPath: row.section_path ?? null,
        });
        continue;
      }
      const derived = deriveSectionInfoFromPath(row.path);
      map.set(row.id, derived);
    }
    return map;
  }

  private deleteFtsByChunkIds(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    const deleteFts = this.db.query(`DELETE FROM chunks_fts WHERE chunk_id = ?`);
    const deleteMeta = this.db.query(`DELETE FROM chunks_fts_meta WHERE chunk_id = ?`);
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteFts.run(id);
        deleteMeta.run(id);
      }
    });
    tx(chunkIds);
  }

  private ensureFtsReady(): void {
    const ftsCount = this.db.query(`SELECT COUNT(*) as count FROM chunks_fts_meta`).get() as { count: number };
    if (ftsCount.count > 0) return;

    const chunkCount = this.db.query(`SELECT COUNT(*) as count FROM chunks`).get() as { count: number };
    if (chunkCount.count === 0) return;

    this.rebuildFtsIndex();
  }

  private rebuildFtsIndex(): void {
    interface FtsRebuildRow {
      chunk_id: string;
      docset_id: string;
      page_id: string;
      url: string;
      title: string | null;
      heading: string | null;
      content: string;
    }

    const rows = this.db.query(`
      SELECT 
        chunks.id as chunk_id,
        chunks.docset_id as docset_id,
        chunks.page_id as page_id,
        pages.url as url,
        pages.title as title,
        chunks.heading as heading,
        chunks.content as content
      FROM chunks
      JOIN pages ON pages.id = chunks.page_id
    `).all() as FtsRebuildRow[];

    const clearFts = this.db.query(`DELETE FROM chunks_fts`);
    const clearMeta = this.db.query(`DELETE FROM chunks_fts_meta`);
    const ftsStmt = this.db.query(`
      INSERT INTO chunks_fts (chunk_id, docset_id, page_id, url, title, heading, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const metaStmt = this.db.query(`
      INSERT INTO chunks_fts_meta (chunk_id, docset_id, page_id, url)
      VALUES (?, ?, ?, ?)
    `);

    const tx = this.db.transaction((rows: FtsRebuildRow[]) => {
      clearFts.run();
      clearMeta.run();
      for (const row of rows) {
        ftsStmt.run(
          row.chunk_id,
          row.docset_id,
          row.page_id,
          row.url,
          row.title,
          row.heading,
          row.content
        );
        metaStmt.run(
          row.chunk_id,
          row.docset_id,
          row.page_id,
          row.url
        );
      }
    });

    tx(rows);
  }

  async createDocset(input: DocsetInput): Promise<DocsetRecord> {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const name = input.name ?? new URL(input.baseUrl).hostname;
    const allowedPaths = input.allowedPaths ?? [input.seedSlug.split("/").slice(0, -1).join("/") || "/"];

    const stmt = this.db.query(`
      INSERT INTO docsets (id, name, base_url, seed_slug, allowed_paths, created_at, updated_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, name, input.baseUrl, input.seedSlug, JSON.stringify(allowedPaths), now, now, "pending");

    return {
      id,
      name,
      baseUrl: input.baseUrl,
      seedSlug: input.seedSlug,
      allowedPaths,
      createdAt: now,
      updatedAt: now,
      status: "pending",
    };
  }

  async getDocset(id: string): Promise<DocsetRecord | null> {
    const stmt = this.db.query(`SELECT * FROM docsets WHERE id = ?`);
    const row = stmt.get(id) as DocsetRow | null;
    return row ? this.rowToDocset(row) : null;
  }

  async getDocsetByUrl(baseUrl: string): Promise<DocsetRecord | null> {
    const stmt = this.db.query(`SELECT * FROM docsets WHERE base_url = ?`);
    const row = stmt.get(baseUrl) as DocsetRow | null;
    return row ? this.rowToDocset(row) : null;
  }

  async updateDocset(id: string, updates: Partial<DocsetRecord>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.allowedPaths !== undefined) {
      fields.push("allowed_paths = ?");
      values.push(JSON.stringify(updates.allowedPaths));
    }

    if (fields.length === 0) return;

    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    const stmt = this.db.query(`UPDATE docsets SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  async listDocsets(): Promise<DocsetRecord[]> {
    const stmt = this.db.query(`SELECT * FROM docsets ORDER BY created_at DESC`);
    const rows = stmt.all() as DocsetRow[];
    return rows.map(row => this.rowToDocset(row));
  }

  async deleteDocset(id: string): Promise<void> {
    const chunkRows = this.db.query(
      `SELECT chunk_id FROM chunks_fts_meta WHERE docset_id = ?`
    ).all(id) as { chunk_id: string }[];
    this.deleteFtsByChunkIds(chunkRows.map(row => row.chunk_id));
    this.db.query(`DELETE FROM chunks_fts_meta WHERE docset_id = ?`).run(id);
    const stmt = this.db.query(`DELETE FROM docsets WHERE id = ?`);
    stmt.run(id);
  }

  async createPage(page: Omit<PageRecord, "id" | "sectionRoot" | "sectionPath">): Promise<PageRecord> {
    const id = randomUUID();
    const sectionInfo = deriveSectionInfoFromPath(page.path);

    const stmt = this.db.query(`
      INSERT INTO pages (id, docset_id, url, path, section_root, section_path, title, content_hash, fetched_at, indexed_at, status, error_message, etag, last_modified, retry_count, last_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      page.docsetId,
      page.url,
      page.path,
      sectionInfo.sectionRoot,
      sectionInfo.sectionPath,
      page.title,
      page.contentHash,
      page.fetchedAt,
      page.indexedAt,
      page.status,
      page.errorMessage,
      page.etag,
      page.lastModified,
      page.retryCount ?? 0,
      page.lastAttemptAt
    );

    return {
      id,
      ...page,
      sectionRoot: sectionInfo.sectionRoot,
      sectionPath: sectionInfo.sectionPath,
      retryCount: page.retryCount ?? 0,
    };
  }

  async getPage(id: string): Promise<PageRecord | null> {
    const stmt = this.db.query(`SELECT * FROM pages WHERE id = ?`);
    const row = stmt.get(id) as PageRow | null;
    return row ? this.rowToPage(row) : null;
  }

  async getPageByUrl(docsetId: string, url: string): Promise<PageRecord | null> {
    const stmt = this.db.query(`SELECT * FROM pages WHERE docset_id = ? AND url = ?`);
    const row = stmt.get(docsetId, url) as PageRow | null;
    return row ? this.rowToPage(row) : null;
  }

  async updatePage(id: string, updates: Partial<PageRecord>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    const fieldMap: Record<string, string> = {
      title: "title",
      contentHash: "content_hash",
      fetchedAt: "fetched_at",
      indexedAt: "indexed_at",
      status: "status",
      errorMessage: "error_message",
      etag: "etag",
      lastModified: "last_modified",
      retryCount: "retry_count",
      lastAttemptAt: "last_attempt_at",
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      const value = updates[key as keyof PageRecord];
      if (value !== undefined) {
        fields.push(`${column} = ?`);
        values.push(value as string | number | null);
      }
    }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = this.db.query(`UPDATE pages SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  async listPages(docsetId: string, status?: PageRecord["status"]): Promise<PageRecord[]> {
    let sql = `SELECT * FROM pages WHERE docset_id = ?`;
    const params: (string | number | null)[] = [docsetId];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY indexed_at DESC NULLS LAST`;

    const stmt = this.db.query(sql);
    const rows = stmt.all(...(params as string[])) as PageRow[];
    return rows.map(row => this.rowToPage(row));
  }

  async getNextPendingPage(docsetId: string): Promise<PageRecord | null> {
    const stmt = this.db.query(`
      SELECT * FROM pages 
      WHERE docset_id = ? AND status = 'pending' 
      ORDER BY rowid ASC 
      LIMIT 1
    `);
    const row = stmt.get(docsetId) as PageRow | null;
    return row ? this.rowToPage(row) : null;
  }

  async deletePage(id: string): Promise<void> {
    await this.deleteChunks(id);
    const stmt = this.db.query(`DELETE FROM pages WHERE id = ?`);
    stmt.run(id);
  }

  async createChunks(chunks: Omit<ChunkRecord, "id" | "createdAt">[]): Promise<ChunkRecord[]> {
    const now = Date.now();
    const results: ChunkRecord[] = [];
    const pageIds = Array.from(new Set(chunks.map(chunk => chunk.pageId)));
    const pageInfoMap = this.getPageInfoMap(pageIds);

    const stmt = this.db.query(`
      INSERT INTO chunks (id, page_id, docset_id, content, heading, start_offset, end_offset, chunk_index, embedding_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const ftsStmt = this.db.query(`
      INSERT INTO chunks_fts (chunk_id, docset_id, page_id, url, title, heading, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const metaStmt = this.db.query(`
      INSERT INTO chunks_fts_meta (chunk_id, docset_id, page_id, url)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((chunks: Omit<ChunkRecord, "id" | "createdAt">[]) => {
      for (const chunk of chunks) {
        const id = randomUUID();
        const pageInfo = pageInfoMap.get(chunk.pageId);
        stmt.run(
          id,
          chunk.pageId,
          chunk.docsetId,
          chunk.content,
          chunk.heading,
          chunk.startOffset,
          chunk.endOffset,
          chunk.chunkIndex,
          chunk.embeddingId,
          now
        );
        ftsStmt.run(
          id,
          chunk.docsetId,
          chunk.pageId,
          pageInfo?.url ?? "",
          pageInfo?.title ?? null,
          chunk.heading,
          chunk.content
        );
        metaStmt.run(
          id,
          chunk.docsetId,
          chunk.pageId,
          pageInfo?.url ?? ""
        );
        results.push({ id, ...chunk, createdAt: now });
      }
    });

    insertMany(chunks);
    return results;
  }

  async getChunks(pageId: string): Promise<ChunkRecord[]> {
    const stmt = this.db.query(`SELECT * FROM chunks WHERE page_id = ? ORDER BY chunk_index`);
    const rows = stmt.all(pageId) as ChunkRow[];
    return rows.map(row => this.rowToChunk(row));
  }

  async getChunk(id: string): Promise<ChunkRecord | null> {
    const stmt = this.db.query(`SELECT * FROM chunks WHERE id = ?`);
    const row = stmt.get(id) as ChunkRow | null;
    return row ? this.rowToChunk(row) : null;
  }

  async updateChunk(id: string, updates: Partial<ChunkRecord>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.embeddingId !== undefined) {
      fields.push("embedding_id = ?");
      values.push(updates.embeddingId);
    }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = this.db.query(`UPDATE chunks SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  async deleteChunks(pageId: string): Promise<void> {
    const chunkRows = this.db.query(
      `SELECT chunk_id FROM chunks_fts_meta WHERE page_id = ?`
    ).all(pageId) as { chunk_id: string }[];
    this.deleteFtsByChunkIds(chunkRows.map(row => row.chunk_id));
    this.db.query(`DELETE FROM chunks_fts_meta WHERE page_id = ?`).run(pageId);
    const stmt = this.db.query(`DELETE FROM chunks WHERE page_id = ?`);
    stmt.run(pageId);
  }

  async getIndexStatus(docsetId: string): Promise<IndexStatus> {
    const docset = await this.getDocset(docsetId);
    if (!docset) {
      throw new Error(`Docset not found: ${docsetId}`);
    }

    const pagesStmt = this.db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) as indexed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
        SUM(CASE WHEN status IN ('fetching', 'fetched', 'indexing') THEN 1 ELSE 0 END) as stuck,
        SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) as retried
      FROM pages WHERE docset_id = ?
    `);

    const chunksStmt = this.db.query(`
      SELECT COUNT(*) as total FROM chunks WHERE docset_id = ?
    `);

    const pagesResult = pagesStmt.get(docsetId) as { 
      total: number; 
      indexed: number; 
      pending: number; 
      errors: number; 
      skipped: number;
      stuck: number;
      retried: number;
    };
    const chunksResult = chunksStmt.get(docsetId) as { total: number };

    return {
      docsetId,
      totalPages: pagesResult.total,
      indexedPages: pagesResult.indexed,
      pendingPages: pagesResult.pending,
      errorPages: pagesResult.errors,
      skippedPages: pagesResult.skipped,
      totalChunks: chunksResult.total,
      status: docset.status,
      stuckPages: pagesResult.stuck,
      retriedPages: pagesResult.retried,
    };
  }

  async searchKeyword(
    query: string,
    docsetIds?: string[],
    topK = 10
  ): Promise<KeywordSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    this.ensureFtsReady();

    const ftsQuery = this.buildFtsQuery(trimmed);
    if (!ftsQuery) return [];

    let sql = `
      SELECT 
        chunk_id as chunkId,
        docset_id as docsetId,
        page_id as pageId,
        url,
        title,
        heading,
        content,
        bm25(chunks_fts) as bm25
      FROM chunks_fts
      WHERE chunks_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (docsetIds && docsetIds.length > 0) {
      const placeholders = docsetIds.map(() => "?").join(", ");
      sql += ` AND docset_id IN (${placeholders})`;
      params.push(...docsetIds);
    }

    sql += ` ORDER BY bm25 ASC LIMIT ?`;
    params.push(topK);

    const stmt = this.db.query(sql);
    const rows = stmt.all(...params) as {
      chunkId: string;
      docsetId: string;
      pageId: string;
      url: string;
      title: string | null;
      heading: string | null;
      content: string;
      bm25: number;
    }[];

    return rows.map(row => {
      const adjustedBm25 = Math.max(0, row.bm25);
      const keywordScore = 1 / (1 + adjustedBm25);
      return {
        chunkId: row.chunkId,
        pageId: row.pageId,
        docsetId: row.docsetId,
        url: row.url,
        title: row.title,
        heading: row.heading,
        content: row.content,
        score: keywordScore,
        keywordScore,
        bm25: row.bm25,
      };
    });
  }

  private rowToDocset(row: DocsetRow): DocsetRecord {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      seedSlug: row.seed_slug,
      allowedPaths: JSON.parse(row.allowed_paths),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status as DocsetRecord["status"],
    };
  }

  private rowToPage(row: PageRow): PageRecord {
    return {
      id: row.id,
      docsetId: row.docset_id,
      url: row.url,
      path: row.path,
      sectionRoot: row.section_root,
      sectionPath: row.section_path,
      title: row.title,
      contentHash: row.content_hash,
      fetchedAt: row.fetched_at,
      indexedAt: row.indexed_at,
      status: row.status as PageRecord["status"],
      errorMessage: row.error_message,
      etag: row.etag,
      lastModified: row.last_modified,
      retryCount: row.retry_count ?? 0,
      lastAttemptAt: row.last_attempt_at,
    };
  }

  private rowToChunk(row: ChunkRow): ChunkRecord {
    return {
      id: row.id,
      pageId: row.page_id,
      docsetId: row.docset_id,
      content: row.content,
      heading: row.heading,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      chunkIndex: row.chunk_index,
      embeddingId: row.embedding_id,
      createdAt: row.created_at,
    };
  }

  /**
   * Get pages that are stuck in intermediate states (fetching/fetched/indexing).
   * A page is considered stuck if it's been in that state longer than stuckThresholdMs.
   */
  async getStuckPages(docsetId: string, stuckThresholdMs = 5 * 60 * 1000): Promise<StuckPageInfo[]> {
    const now = Date.now();
    const stmt = this.db.query(`
      SELECT id, url, status, last_attempt_at, retry_count, error_message
      FROM pages
      WHERE docset_id = ?
        AND status IN ('fetching', 'fetched', 'indexing')
        AND (last_attempt_at IS NULL OR last_attempt_at < ?)
      ORDER BY last_attempt_at ASC NULLS FIRST
    `);
    
    const cutoff = now - stuckThresholdMs;
    const rows = stmt.all(docsetId, cutoff) as {
      id: string;
      url: string;
      status: string;
      last_attempt_at: number | null;
      retry_count: number;
      error_message: string | null;
    }[];

    return rows.map(row => ({
      id: row.id,
      url: row.url,
      status: row.status as PageRecord["status"],
      lastAttemptAt: row.last_attempt_at,
      retryCount: row.retry_count,
      errorMessage: row.error_message,
      stuckDurationMs: row.last_attempt_at ? now - row.last_attempt_at : now,
    }));
  }

  /**
   * Get pages that failed but can be retried (retry_count < maxRetries).
   */
  async getRetriablePages(docsetId: string, maxRetries = 3): Promise<PageRecord[]> {
    const stmt = this.db.query(`
      SELECT * FROM pages
      WHERE docset_id = ?
        AND status = 'error'
        AND retry_count < ?
      ORDER BY retry_count ASC, last_attempt_at ASC NULLS FIRST
    `);
    const rows = stmt.all(docsetId, maxRetries) as PageRow[];
    return rows.map(row => this.rowToPage(row));
  }

  /**
   * Reset stuck pages to pending status for retry.
   * Returns the number of pages reset.
   */
  async resetStuckPages(docsetId: string, stuckThresholdMs = 5 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - stuckThresholdMs;
    const stmt = this.db.query(`
      UPDATE pages
      SET status = 'pending', retry_count = retry_count + 1
      WHERE docset_id = ?
        AND status IN ('fetching', 'fetched', 'indexing')
        AND (last_attempt_at IS NULL OR last_attempt_at < ?)
    `);
    const result = stmt.run(docsetId, cutoff);
    return result.changes;
  }

  /**
   * Reset error pages to pending for retry (up to maxRetries).
   * Returns the number of pages reset.
   */
  async resetErrorPagesForRetry(docsetId: string, maxRetries = 3): Promise<number> {
    const stmt = this.db.query(`
      UPDATE pages
      SET status = 'pending'
      WHERE docset_id = ?
        AND status = 'error'
        AND retry_count < ?
    `);
    const result = stmt.run(docsetId, maxRetries);
    return result.changes;
  }

  /**
   * Get pages that have exhausted all retries.
   */
  async getExhaustedPages(docsetId: string, maxRetries = 3): Promise<PageRecord[]> {
    const stmt = this.db.query(`
      SELECT * FROM pages
      WHERE docset_id = ?
        AND status = 'error'
        AND retry_count >= ?
      ORDER BY last_attempt_at DESC
    `);
    const rows = stmt.all(docsetId, maxRetries) as PageRow[];
    return rows.map(row => this.rowToPage(row));
  }

  close(): void {
    this.db.close();
  }
}

interface DocsetRow {
  id: string;
  name: string;
  base_url: string;
  seed_slug: string;
  allowed_paths: string;
  created_at: number;
  updated_at: number;
  status: string;
}

interface PageRow {
  id: string;
  docset_id: string;
  url: string;
  path: string;
  section_root: string | null;
  section_path: string | null;
  title: string | null;
  content_hash: string | null;
  fetched_at: number | null;
  indexed_at: number | null;
  status: string;
  error_message: string | null;
  etag: string | null;
  last_modified: string | null;
  retry_count: number;
  last_attempt_at: number | null;
}

interface ChunkRow {
  id: string;
  page_id: string;
  docset_id: string;
  content: string;
  heading: string | null;
  start_offset: number;
  end_offset: number;
  chunk_index: number;
  embedding_id: string | null;
  created_at: number;
}

let metadataStore: SQLiteMetadataStore | null = null;

export function getMetadataStore(): SQLiteMetadataStore {
  if (!metadataStore) {
    metadataStore = new SQLiteMetadataStore();
  }
  return metadataStore;
}
