// Request router

import {
  handleHealth,
  handleIndexDocs,
  handleRetrieve,
  handleStatus,
  handleDeleteDocset,
  handleGetDocset,
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
    else if (path.startsWith("/docset/")) {
      const docsetId = path.slice("/docset/".length);
      
      if (method === "DELETE") {
        response = await handleDeleteDocset(docsetId);
      }
      else if (method === "GET") {
        response = await handleGetDocset(docsetId);
      }
      else {
        response = notFoundResponse();
      }
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
