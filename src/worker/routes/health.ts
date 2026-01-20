// Health check route handler

export function handleHealth(): Response {
  return Response.json({ 
    status: "ok", 
    timestamp: Date.now(),
    version: "1.0.0",
  });
}
