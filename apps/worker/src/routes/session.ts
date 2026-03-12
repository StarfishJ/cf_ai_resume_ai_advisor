import type { SessionInitRequest } from "@resume-advisor/shared";
import { normalizeResumeText } from "../services/pdfService";
import { cleanupSessionVectors } from "../services/qdrantService";
import { triggerResumeIngestWorkflow } from "../services/workflowService";
import type { WorkerEnv } from "../workerEnv";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function getStub(env: WorkerEnv, sessionId: string) {
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

export async function handleSessionInit(request: Request, env: WorkerEnv): Promise<Response> {
  const payload = (await request.json()) as SessionInitRequest;
  const sessionId = crypto.randomUUID();
  const normalizedResumeText = normalizeResumeText(payload.resumeText);

  const stub = getStub(env, sessionId);
  console.log(`[Session] Initializing DO for ${sessionId}`);
  await stub.fetch("https://session/init", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sessionId,
      resumeText: normalizedResumeText,
      jobDescription: payload.jobDescription.trim()
    })
  });

  console.log(`[Session] Triggering workflow for ${sessionId}`);
  await triggerResumeIngestWorkflow(env, {
    sessionId,
    resumeText: normalizedResumeText,
    jobDescription: payload.jobDescription.trim()
  });

  console.log(`[Session] Init complete for ${sessionId}`);
  return json({
    sessionId,
    status: "pending"
  });
}

export async function handleSessionStatus(sessionId: string, env: WorkerEnv): Promise<Response> {
  const stub = getStub(env, sessionId);
  return stub.fetch("https://session/state");
}

export async function handleSessionEnd(request: Request, env: WorkerEnv): Promise<Response> {
  const payload = (await request.json()) as { sessionId: string };
  const stub = getStub(env, payload.sessionId);

  await stub.fetch("https://session/end", {
    method: "POST"
  });

  const cleanup = await cleanupSessionVectors(payload.sessionId, env);
  return json({
    status: "ended",
    cleanup
  });
}
