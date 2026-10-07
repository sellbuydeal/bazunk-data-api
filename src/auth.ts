import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveClient, type ApiClient } from "./clients.js";

declare module "fastify" {
  interface FastifyRequest {
    apiClient: ApiClient | null;
  }
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const supplied = request.headers["x-api-key"];
  const key = Array.isArray(supplied) ? supplied[0] : supplied;
  const client = key ? resolveClient(key) : null;
  request.apiClient = client;

  if (!client) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "A valid X-API-Key header is required."
    });
  }
}
