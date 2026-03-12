import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import type {
  ResumeIngestWorkflowParams,
  ResumeIngestWorkflowResult
} from "@resume-advisor/shared";
import { chunkResumeText, upsertResumeChunks } from "../services/qdrantService";
import {
  buildResumeSummary,
  markSessionFailed,
  markSessionReady
} from "../services/workflowService";
import type { WorkerEnv } from "../workerEnv";

export class ResumeIngestWorkflow extends WorkflowEntrypoint<
  WorkerEnv,
  ResumeIngestWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<ResumeIngestWorkflowParams>>,
    step: WorkflowStep
  ): Promise<ResumeIngestWorkflowResult> {
    try {
      const resumeSummary = await step.do(
        "build-resume-summary",
        { retries: { limit: 2, delay: "5 second", backoff: "exponential" } },
        async () => buildResumeSummary(event.payload.resumeText)
      );

      const chunks = await step.do(
        "chunk-resume-text",
        { retries: { limit: 2, delay: "5 second", backoff: "exponential" } },
        async () => chunkResumeText(event.payload.resumeText)
      );

      const indexingResult = await step.do(
        "index-resume-chunks",
        { retries: { limit: 2, delay: "10 second", backoff: "exponential" } },
        async () => upsertResumeChunks(this.env, event.payload.sessionId, chunks)
      );

      // Demonstrating step.sleep: Wait for 2 seconds to ensure vector consistency 
      // (Optional showcase of CF Workflows central state management)
      await step.sleep("wait-for-propogation", "2 second");

      await step.do("mark-session-ready", async () => {
        await markSessionReady(this.env, event.payload.sessionId, resumeSummary);
        return { status: "ready" };
      });

      return {
        sessionId: event.payload.sessionId,
        status: "ready",
        chunkCount: indexingResult.indexedCount
      };
    } catch (error) {
      await markSessionFailed(this.env, event.payload.sessionId);
      throw error;
    }
  }
}
