// Worker middleware

/** CORS headers for all responses */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight requests */
export function handleCors(): Response {
  return new Response(null, { headers: CORS_HEADERS });
}

/** Wrap response with CORS headers */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Create error response */
export function errorResponse(message: string, status = 500): Response {
  return Response.json({ error: message }, { status, headers: CORS_HEADERS });
}

/** Create not found response */
export function notFoundResponse(): Response {
  return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
}
