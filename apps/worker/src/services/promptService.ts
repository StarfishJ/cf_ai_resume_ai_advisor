import type { ChatMode, SessionState } from "@resume-advisor/shared";
import type { RetrievalContext } from "./qdrantService";

function formatRecentMessages(state: SessionState): string {
  return state.messages
    .slice(-5)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

function formatRetrievedChunks(
  label: "resume" | "knowledge",
  chunks: RetrievalContext["resumeChunks"] | RetrievalContext["knowledgeChunks"]
): string {
  if (chunks.length === 0) {
    return label === "resume" ? "No retrieved resume chunks." : "No curated guidance retrieved.";
  }

  return chunks
    .map((chunk, index) => {
      const meta = [chunk.sourceType, chunk.title].filter(Boolean).join(" | ");
      return `[${label}-${index + 1}${meta ? ` | ${meta}` : ""}] ${chunk.text}`;
    })
    .join("\n");
}

export function buildPromptContext(
  state: SessionState,
  userMessage: string,
  mode: ChatMode,
  retrievalContext: RetrievalContext
): string {
  const summary = state.resumeSummary
    ? `Structured summary: ${JSON.stringify(state.resumeSummary)}`
    : "Structured summary: not ready yet.";

  const retrievalNote =
    mode === "pending-full-text"
      ? "Retrieval is pending. Use the stored resume text and job description only."
      : "Retrieval is ready. Prefer structured summary, retrieved chunks, and concise guidance. Never attribute knowledge-base content, sample resumes, or external job descriptions to the user as if they were the user's own experience.";

  const recentMessages = formatRecentMessages(state) || "No prior messages.";
  const resumeChunks = formatRetrievedChunks("resume", retrievalContext.resumeChunks);
  const knowledgeChunks = formatRetrievedChunks("knowledge", retrievalContext.knowledgeChunks);

  return [
    retrievalNote,
    "Task: Provide a deep-dive Matching & Alignment Analysis between the user's resume and the target JD.",
    "Reference Material usage:",
    "- 'resume_guide' chunks: Use these as rules for formatting, impact quantification, and tone.",
    "- 'expert_resume' chunks: Use these as stylistic benchmarks for high-performing bullets in similar roles.",
    "- 'jd_template' chunks: Use these to understand typical industry expectations for this specific field.",
    "Grounding rule: Only describe skills, technologies, and experiences as belonging to the user when they appear in the user's resume text or retrieved user resume chunks. Treat knowledge-base results as reference material only.",
    "Matching Analysis Requirement: Start your response with a brief 'Alignment Score' (out of 100) and a summary of the 3 biggest gaps between the resume and the JD.",
    "Rewrite rule: Do not invent metrics or experiences. If a bullet lacks quantification, suggest the user add a specific metric (e.g., '[X]% increase in throughput') instead of fabricating one.",
    `Target job description:\n${state.jobDescription}`,
    summary,
    `Resume text:\n${state.resumeText.slice(0, 2500)}`,
    `Retrieved resume chunks:\n${resumeChunks}`,
    `Retrieved curated knowledge (guides, benchmarks, templates):\n${knowledgeChunks}`,
    `Recent messages:\n${recentMessages}`,
    `Latest user message:\n${userMessage}`
  ].join("\n\n");
}
