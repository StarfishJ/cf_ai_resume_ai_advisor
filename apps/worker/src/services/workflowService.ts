import type {
  ResumeIngestWorkflowParams,
  ResumeSummary
} from "@resume-advisor/shared";
import type { WorkerEnv } from "../workerEnv";

function getSessionStub(env: Pick<WorkerEnv, "SESSION_DO">, sessionId: string) {
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

export async function triggerResumeIngestWorkflow(
  env: Pick<WorkerEnv, "RESUME_INGEST_WORKFLOW">,
  params: ResumeIngestWorkflowParams
) {
  return env.RESUME_INGEST_WORKFLOW.create({
    id: params.sessionId,
    params
  });
}

export function buildResumeSummary(resumeText: string): ResumeSummary {
  const lines = resumeText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const skills = lines
    .flatMap((line) => line.split(/,|\||\/|;/))
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .slice(0, 8);

  return {
    coreSkills: skills,
    domainKeywords: skills.slice(0, 5),
    notableProjects: lines.slice(0, 3),
    gaps: []
  };
}

export async function markSessionReady(
  env: Pick<WorkerEnv, "SESSION_DO">,
  sessionId: string,
  resumeSummary: ResumeSummary
) {
  const stub = getSessionStub(env, sessionId);
  return stub.fetch("https://session/mark-ready", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ resumeSummary })
  });
}

export async function markSessionFailed(env: Pick<WorkerEnv, "SESSION_DO">, sessionId: string) {
  const stub = getSessionStub(env, sessionId);
  return stub.fetch("https://session/mark-failed", {
    method: "POST"
  });
}
