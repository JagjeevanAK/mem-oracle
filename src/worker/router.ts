// Request router

import {
  handleHealth,
  handleIndexDocs,
  handleRetrieve,
  handleStatus,
  handleDeleteDocset,
  handleGetDocset,
  handleListPages,
  handleRefresh,
  handleRefreshAll,
  handleRegisterSession,
  handleUnregisterSession,
  handleGetSessions,
} from "./routes";
import { handleCors, withCors, errorResponse, notFoundResponse } from "./middleware";

export async function routeRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return handleCors();
  }

  try {
    let response: Response;

    // Route matching
    if (path === "/health" && method === "GET") {
      response = handleHealth();
    }
    else if (path === "/index" && method === "POST") {
      response = await handleIndexDocs(req);
    }
    else if (path === "/retrieve" && method === "POST") {
      response = await handleRetrieve(req);
    }
    else if (path === "/status" && method === "GET") {
      response = await handleStatus(url);
    }
    else if (path === "/refresh" && method === "POST") {
      response = await handleRefresh(req);
    }
    else if (path === "/refresh-all" && method === "POST") {
      response = await handleRefreshAll(req);
    }
    else if (path.startsWith("/docset/")) {
      const remainder = path.slice("/docset/".length);
      const parts = remainder.split("/");
      const docsetId = parts[0] ?? "";
      const subResource = parts[1];
      
      if (!docsetId) {
        response = notFoundResponse();
      }
      else if (subResource === "pages" && method === "GET") {
        response = await handleListPages(docsetId, url);
      }
      else if (!subResource && method === "DELETE") {
        response = await handleDeleteDocset(docsetId);
      }
      else if (!subResource && method === "GET") {
        response = await handleGetDocset(docsetId);
      }
      else {
        response = notFoundResponse();
      }
    }
    // Session management routes
    else if (path === "/session/register" && method === "POST") {
      response = await handleRegisterSession(req);
    }
    else if (path === "/session/unregister" && method === "POST") {
      response = await handleUnregisterSession(req);
    }
    else if (path === "/sessions" && method === "GET") {
      response = handleGetSessions();
    }
    else {
      response = notFoundResponse();
    }

    return withCors(response);

  } catch (error) {
    console.error("Worker error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error"
    );
  }
}
