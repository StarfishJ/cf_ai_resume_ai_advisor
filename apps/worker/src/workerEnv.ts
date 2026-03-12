import type { ResumeIngestWorkflowParams } from "@resume-advisor/shared";

export type AiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

export type WorkerEnv = {
  SESSION_DO: DurableObjectNamespace;
  AI?: AiBinding;
  RESUME_INGEST_WORKFLOW: Workflow<ResumeIngestWorkflowParams>;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  QDRANT_KNOWLEDGE_BASE_COLLECTION?: string;
  QDRANT_USER_RESUME_COLLECTION?: string;
  ENVIRONMENT?: "development" | "production";
};
