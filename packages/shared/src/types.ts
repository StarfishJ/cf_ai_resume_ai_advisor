export type RetrievalStatus = "pending" | "ready" | "failed";
export type ChatMode = "pending-full-text" | "rag-ready";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ResumeSummary = {
  targetRole?: string;
  yearsOfExperience?: number;
  coreSkills: string[];
  domainKeywords: string[];
  notableProjects: string[];
  gaps: string[];
};

export type SessionState = {
  sessionId: string;
  resumeText: string;
  resumeSummary?: ResumeSummary;
  jobDescription: string;
  messages: ChatMessage[];
  retrievalStatus: RetrievalStatus;
  resumeVectorIndexed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SessionInitRequest = {
  resumeText: string;
  jobDescription: string;
  fileName?: string;
};

export type SessionInitResponse = {
  sessionId: string;
  status: RetrievalStatus;
};

export type ChatRequest = {
  sessionId: string;
  message: string;
};

export type SessionEndRequest = {
  sessionId: string;
};

export type SessionStatusResponse = {
  session: SessionState;
};

export type ResumeIngestWorkflowParams = {
  sessionId: string;
  resumeText: string;
  jobDescription: string;
};

export type ResumeChunk = {
  text: string;
  chunkType: "experience" | "skills" | "project" | "general_tip";
};

export type ResumeIngestWorkflowResult = {
  sessionId: string;
  status: RetrievalStatus;
  chunkCount: number;
};

export type KnowledgeDocument = {
  id?: string;
  title: string;
  text: string;
  sourceType?: "expert_resume" | "resume_guide" | "jd_template";
  qualityScore?: number;
};

export type KnowledgeImportRequest = {
  documents: KnowledgeDocument[];
};

export type KnowledgeImportResponse = {
  importedCount: number;
  collection: string;
};

export type RetrievedChunk = {
  text: string;
  source: "resume" | "knowledge";
  sourceType?: "user_resume" | "expert_resume" | "resume_guide" | "jd_template";
  title?: string;
};
