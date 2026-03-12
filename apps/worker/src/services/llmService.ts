import type { ChatMode, SessionState } from "@resume-advisor/shared";
import { buildPromptContext } from "./promptService";
import type { RetrievalContext } from "./qdrantService";
import type { AiBinding } from "../workerEnv";

type ReplyParams = {
  state: SessionState;
  userMessage: string;
  mode: ChatMode;
  retrievalContext: RetrievalContext;
  ai?: AiBinding;
};

export type AssistantReply = {
  text: string;
  provider: "workers-ai" | "fallback";
};

function fallbackReply(state: SessionState, userMessage: string, mode: ChatMode): AssistantReply {
  const roleHint = state.jobDescription.split("\n")[0]?.slice(0, 140) || "the target role";
  const resumePreview = state.resumeText.slice(0, 240).trim();

  if (mode === "pending-full-text") {
    return {
      provider: "fallback",
      text: [
        "Your resume is still being processed, so this answer is based on the full extracted text stored in the current session.",
        `For alignment with ${roleHint}, start by tightening the headline, skills section, and top two experience bullets around the user's request: ${userMessage}.`,
        `Current resume context preview: ${resumePreview || "No resume text available yet."}`,
        "Once retrieval is ready, the next pass should compare the resume against curated examples and role-specific guidance."
      ].join("\n\n")
    };
  }

  return {
    provider: "fallback",
    text: [
      "Retrieval is ready, so this answer can combine the structured resume summary with curated guidance.",
      `Prioritize edits that make the resume more relevant to ${roleHint}.`,
      `User request: ${userMessage}`,
      "Workers AI is unavailable in the current environment, so this fallback response is being returned instead of a live model output."
    ].join("\n\n")
  };
}

export async function generateAssistantReply({
  state,
  userMessage,
  mode,
  retrievalContext,
  ai
}: ReplyParams): Promise<ReadableStream | AssistantReply> {
  const promptContext = buildPromptContext(state, userMessage, mode, retrievalContext);

  if (!ai) {
    return fallbackReply(state, userMessage, mode);
  }

  const systemPrompt = [
    "You are an AI resume advisor. Give concise, actionable resume feedback grounded in the supplied resume, target job description, and retrieved guidance.",
    "Never claim the user has experience, skills, internships, technologies, or quantified impact unless they appear in the user's own resume text or retrieved user resume chunks.",
    "Sample resumes and other retrieved knowledge are references only, not the user's background. Do not invent percentages, metrics, or achievements.",
    "If you suggest stronger wording, label it as an example rewrite and keep it faithful to the facts present in the user's resume.",
    state.retrievalStatus === "failed"
      ? "NOTE: Retrieval indexing failed for this session. Use the provided full-text resume and job description only. Apologize once for the lack of curated guidance."
      : ""
  ].filter(Boolean).join(" ");

  try {
    if (typeof ai.run !== 'function') {
      throw new Error("AI.run is not a function - check bindings");
    }

    const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptContext }
      ],
      temperature: 0.2,
      max_tokens: 700,
      stream: true
    });

    if (!result || !(result instanceof ReadableStream)) {
      console.error("[LLM] Expected ReadableStream but got:", typeof result);
      return fallbackReply(state, userMessage, mode);
    }

    return result;
  } catch (error) {
    console.error("[LLM] AI model call failed:", error instanceof Error ? error.message : String(error));
    return fallbackReply(state, userMessage, mode);
  }
}
