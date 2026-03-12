import type { KnowledgeImportRequest } from "@resume-advisor/shared";
import { upsertKnowledgeDocuments } from "../services/qdrantService";
import type { WorkerEnv } from "../workerEnv";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

export async function handleKnowledgeImport(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    const payload = (await request.json()) as KnowledgeImportRequest;

    if (!Array.isArray(payload.documents) || payload.documents.length === 0) {
      return json({ error: "documents must be a non-empty array" }, 400);
    }

    const result = await upsertKnowledgeDocuments(env, payload.documents);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Knowledge import failed:", message);
    return json({ error: message }, 500);
  }
}
