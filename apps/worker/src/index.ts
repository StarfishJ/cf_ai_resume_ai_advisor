import { handleKnowledgeImport } from "./routes/admin";
import { handleChat } from "./routes/chat";
import { handleSessionEnd, handleSessionInit, handleSessionStatus } from "./routes/session";
import { cleanupExpiredVectors } from "./services/qdrantService";
import { SessionDO } from "./durable-objects/SessionDO";
import { ResumeIngestWorkflow } from "./workflows/resumeIngestWorkflow";
import type { WorkerEnv } from "./workerEnv";

export { SessionDO };
export { ResumeIngestWorkflow };

function notFound() {
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`[Worker] Incoming ${request.method} ${url.pathname}`);

    if (request.method === "POST" && url.pathname === "/api/admin/knowledge/import") {
      return handleKnowledgeImport(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/session/init") {
      return handleSessionInit(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/api/session/end") {
      return handleSessionEnd(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/session/")) {
      const sessionId = url.pathname.split("/").pop();
      if (!sessionId) {
        return notFound();
      }
      return handleSessionStatus(sessionId, env);
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", ai: !!env.AI, qdrant: !!env.QDRANT_URL }), {
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
      });
    }

    return new Response("Not found", { 
      status: 404,
      headers: { "access-control-allow-origin": "*" }
    });
  },

  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    await cleanupExpiredVectors(env);
  }
};