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
} from "../types";
import { getDataDir } from "../config";

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
  title TEXT,
  content_hash TEXT,
  fetched_at INTEGER,
  indexed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  etag TEXT,
  last_modified TEXT,
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
`;

export class SQLiteMetadataStore implements MetadataStore {
  private db: Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(getDataDir(), "db", "metadata.sqlite");
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  async createDocset(input: DocsetInput): Promise<DocsetRecord> {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const name = input.name ?? new URL(input.baseUrl).hostname;
    const allowedPaths = input.allowedPaths ?? [input.seedSlug.split("/").slice(0, -1).join("/") || "/"];

    const stmt = this.db.prepare(`
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
    const stmt = this.db.prepare(`SELECT * FROM docsets WHERE id = ?`);
    const row = stmt.get(id) as DocsetRow | null;
    return row ? this.rowToDocset(row) : null;
  }

  async getDocsetByUrl(baseUrl: string): Promise<DocsetRecord | null> {
    const stmt = this.db.prepare(`SELECT * FROM docsets WHERE base_url = ?`);
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

    const stmt = this.db.prepare(`UPDATE docsets SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  async listDocsets(): Promise<DocsetRecord[]> {
    const stmt = this.db.prepare(`SELECT * FROM docsets ORDER BY created_at DESC`);
    const rows = stmt.all() as DocsetRow[];
    return rows.map(row => this.rowToDocset(row));
  }

  async deleteDocset(id: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM docsets WHERE id = ?`);
    stmt.run(id);
  }

  async createPage(page: Omit<PageRecord, "id">): Promise<PageRecord> {
    const id = randomUUID();

    const stmt = this.db.prepare(`
      INSERT INTO pages (id, docset_id, url, path, title, content_hash, fetched_at, indexed_at, status, error_message, etag, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      page.docsetId,
      page.url,
      page.path,
      page.title,
      page.contentHash,
      page.fetchedAt,
      page.indexedAt,
      page.status,
      page.errorMessage,
      page.etag,
      page.lastModified
    );

    return { id, ...page };
  }

  async getPage(id: string): Promise<PageRecord | null> {
    const stmt = this.db.prepare(`SELECT * FROM pages WHERE id = ?`);
    const row = stmt.get(id) as PageRow | null;
    return row ? this.rowToPage(row) : null;
  }

  async getPageByUrl(docsetId: string, url: string): Promise<PageRecord | null> {
    const stmt = this.db.prepare(`SELECT * FROM pages WHERE docset_id = ? AND url = ?`);
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
    const stmt = this.db.prepare(`UPDATE pages SET ${fields.join(", ")} WHERE id = ?`);
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

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(params as string[])) as PageRow[];
    return rows.map(row => this.rowToPage(row));
  }

  async getNextPendingPage(docsetId: string): Promise<PageRecord | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM pages 
      WHERE docset_id = ? AND status = 'pending' 
      ORDER BY rowid ASC 
      LIMIT 1
    `);
    const row = stmt.get(docsetId) as PageRow | null;
    return row ? this.rowToPage(row) : null;
  }

  async deletePage(id: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM pages WHERE id = ?`);
    stmt.run(id);
  }

  async createChunks(chunks: Omit<ChunkRecord, "id" | "createdAt">[]): Promise<ChunkRecord[]> {
    const now = Date.now();
    const results: ChunkRecord[] = [];

    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, page_id, docset_id, content, heading, start_offset, end_offset, chunk_index, embedding_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((chunks: Omit<ChunkRecord, "id" | "createdAt">[]) => {
      for (const chunk of chunks) {
        const id = randomUUID();
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
        results.push({ id, ...chunk, createdAt: now });
      }
    });

    insertMany(chunks);
    return results;
  }

  async getChunks(pageId: string): Promise<ChunkRecord[]> {
    const stmt = this.db.prepare(`SELECT * FROM chunks WHERE page_id = ? ORDER BY chunk_index`);
    const rows = stmt.all(pageId) as ChunkRow[];
    return rows.map(row => this.rowToChunk(row));
  }

  async getChunk(id: string): Promise<ChunkRecord | null> {
    const stmt = this.db.prepare(`SELECT * FROM chunks WHERE id = ?`);
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
    const stmt = this.db.prepare(`UPDATE chunks SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  async deleteChunks(pageId: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM chunks WHERE page_id = ?`);
    stmt.run(pageId);
  }

  async getIndexStatus(docsetId: string): Promise<IndexStatus> {
    const docset = await this.getDocset(docsetId);
    if (!docset) {
      throw new Error(`Docset not found: ${docsetId}`);
    }

    const pagesStmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) as indexed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
      FROM pages WHERE docset_id = ?
    `);

    const chunksStmt = this.db.prepare(`
      SELECT COUNT(*) as total FROM chunks WHERE docset_id = ?
    `);

    const pagesResult = pagesStmt.get(docsetId) as { total: number; indexed: number; pending: number; errors: number };
    const chunksResult = chunksStmt.get(docsetId) as { total: number };

    return {
      docsetId,
      totalPages: pagesResult.total,
      indexedPages: pagesResult.indexed,
      pendingPages: pagesResult.pending,
      errorPages: pagesResult.errors,
      totalChunks: chunksResult.total,
      status: docset.status,
    };
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
      title: row.title,
      contentHash: row.content_hash,
      fetchedAt: row.fetched_at,
      indexedAt: row.indexed_at,
      status: row.status as PageRecord["status"],
      errorMessage: row.error_message,
      etag: row.etag,
      lastModified: row.last_modified,
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
  title: string | null;
  content_hash: string | null;
  fetched_at: number | null;
  indexed_at: number | null;
  status: string;
  error_message: string | null;
  etag: string | null;
  last_modified: string | null;
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
