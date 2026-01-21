// Session management routes
// Tracks active clients (Claude Code, OpenCode) connected to the worker

import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync } from "fs";

interface Session {
  id: string;
  clientType: string; // "claude-code" | "opencode" | "unknown"
  connectedAt: number;
  lastHeartbeat: number;
}

const DATA_DIR = process.env.MEM_ORACLE_DATA_DIR || join(homedir(), ".mem-oracle");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

// In-memory session store
const activeSessions = new Map<string, Session>();

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function cleanupStaleSessions(): void {
  const now = Date.now();
  let removed = 0;
  
  for (const [id, session] of activeSessions.entries()) {
    if (now - session.lastHeartbeat > STALE_THRESHOLD_MS) {
      activeSessions.delete(id);
      removed++;
    }
  }
  
  if (removed > 0) {
    saveSessions();
  }
}

// Load sessions from file on startup
function loadSessions(): void {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
      if (Array.isArray(data)) {
        for (const session of data) {
          activeSessions.set(session.id, session);
        }
        cleanupStaleSessions();
      }
    }
  } catch {
    // Ignore errors, start fresh
  }
}

// Save sessions to file
function saveSessions(): void {
  try {
    const sessions = Array.from(activeSessions.values());
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (err) {
    console.error("Failed to save sessions:", err);
  }
}

// Initialize on module load
loadSessions();

export function registerSession(sessionId: string, clientType: string): Session {
  cleanupStaleSessions();
  const now = Date.now();
  const session: Session = {
    id: sessionId,
    clientType: clientType || "unknown",
    connectedAt: activeSessions.get(sessionId)?.connectedAt || now,
    lastHeartbeat: now,
  };
  
  activeSessions.set(sessionId, session);
  saveSessions();
  
  console.log(`[session] Registered: ${sessionId} (${clientType}), total: ${activeSessions.size}`);
  
  return session;
}

export function unregisterSession(sessionId: string): boolean {
  cleanupStaleSessions();
  const existed = activeSessions.delete(sessionId);
  saveSessions();
  
  console.log(`[session] Unregistered: ${sessionId}, remaining: ${activeSessions.size}`);
  
  return existed;
}

export function getActiveSessionCount(): number {
  cleanupStaleSessions();
  return activeSessions.size;
}

export function getActiveSessions(): Session[] {
  cleanupStaleSessions();
  return Array.from(activeSessions.values());
}

export function hasActiveSessions(): boolean {
  return activeSessions.size > 0;
}

// HTTP handlers
export async function handleRegisterSession(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { sessionId?: string; clientType?: string };
    const { sessionId, clientType } = body;
    
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "sessionId required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const session = registerSession(sessionId, clientType || "unknown");
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        session,
        totalSessions: activeSessions.size 
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function handleUnregisterSession(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { sessionId?: string };
    const { sessionId } = body;
    
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "sessionId required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const existed = unregisterSession(sessionId);
    const remainingSessions = activeSessions.size;
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        existed,
        remainingSessions,
        shouldStop: remainingSessions === 0
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}

export function handleGetSessions(): Response {
  return new Response(
    JSON.stringify({
      sessions: getActiveSessions(),
      count: activeSessions.size,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
