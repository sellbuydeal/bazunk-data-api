import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function matches(candidate: string, expected: string) {
  const a = digest(candidate);
  const b = digest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const supplied = request.headers["x-api-key"];
  const key = Array.isArray(supplied) ? supplied[0] : supplied;

  if (!key || ![...config.apiKeys].some(expected => matches(key, expected))) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "A valid X-API-Key header is required."
    });
  }
}
