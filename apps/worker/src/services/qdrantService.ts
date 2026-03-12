import type {
  KnowledgeDocument,
  RetrievedChunk,
  ResumeChunk,
  SessionState
} from "@resume-advisor/shared";
import type { AiBinding, WorkerEnv } from "../workerEnv";

export type RetrievalContext = {
  resumeChunks: RetrievedChunk[];
  knowledgeChunks: RetrievedChunk[];
};

type QdrantConfig = {
  url: string;
  apiKey: string;
  knowledgeBaseCollection: string;
  userResumeCollection: string;
};

type QdrantPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

type QdrantSearchResult = {
  payload?: {
    text?: string;
    title?: string;
    source?: "resume" | "knowledge";
    sourceType?: "user_resume" | "expert_resume" | "resume_guide" | "jd_template";
  };
};

const EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
const EMBEDDING_DIMENSION = 384;
const LIVE_CHAT_KNOWLEDGE_SOURCE_TYPE = "resume_guide" as const;

export async function getRetrievalContext(
  state: SessionState,
  queryText: string,
  env: Pick<WorkerEnv, "AI" | "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KNOWLEDGE_BASE_COLLECTION" | "QDRANT_USER_RESUME_COLLECTION">
): Promise<RetrievalContext> {
  if (state.retrievalStatus !== "ready") {
    return {
      resumeChunks: [],
      knowledgeChunks: []
    };
  }

  const config = getQdrantConfig(env);
  if (!config) {
    return {
      resumeChunks: state.resumeText
        ? [
            {
              text: state.resumeText.slice(0, 400),
              source: "resume",
              sourceType: "user_resume"
            }
          ]
        : [],
      knowledgeChunks: [
        {
          text: "Prefer quantified impact statements, role-specific keywords, and concise action verbs.",
          source: "knowledge",
          sourceType: "resume_guide",
          title: "Fallback resume guidance"
        }
      ]
    };
  }

  try {
    await ensureCollections(config);
  } catch (e) {
    // Silence 400/already exists in local dev
    console.warn("[Retrieval] Optional ensureCollections skipped or failed:", (e as Error).message);
  }

  try {
    const summaryString = state.resumeSummary 
      ? typeof state.resumeSummary === 'string' 
        ? state.resumeSummary 
        : JSON.stringify(state.resumeSummary)
      : "";

    const [queryVector] = await embedTexts(
      [`User Query: ${queryText?.slice(0, 500)}\n\nContext: ${summaryString?.slice(0, 500)}\n\nTarget Job: ${state.jobDescription?.slice(0, 1000)}`],
      env.AI
    );

    if (!queryVector) {
      console.warn("[Retrieval] Could not generate query vector, using empty context.");
      return { resumeChunks: [], knowledgeChunks: [] };
    }

    console.log(`[Retrieval] Searching collections. Vector size: ${queryVector.length}`);
    const [resumeResults, knowledgeResults] = await Promise.all([
      searchCollection(config, config.userResumeCollection, queryVector, {
        must: [{ key: "sessionId", match: { value: state.sessionId } }]
      }),
      searchCollection(config, config.knowledgeBaseCollection, queryVector, {
        must: [
          {
            key: "isCurated",
            match: { value: true }
          }
        ]
      })
    ]);

    return {
      resumeChunks: resumeResults,
      knowledgeChunks: knowledgeResults
    };
  } catch (error) {
    console.error("[Retrieval] CRITICAL FAILURE:", error instanceof Error ? error.message : String(error));
    // Final fallback: allow chat to continue without RAG
    return {
      resumeChunks: [],
      knowledgeChunks: []
    };
  }
}

export async function cleanupSessionVectors(
  sessionId: string,
  env: Pick<WorkerEnv, "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KNOWLEDGE_BASE_COLLECTION" | "QDRANT_USER_RESUME_COLLECTION">
) {
  const config = getQdrantConfig(env);
  if (!config) {
    return {
      sessionId,
      strategy: "not-configured",
      deleted: false
    };
  }

  await ensureCollections(config);
  await deleteByFilter(config, config.userResumeCollection, {
    must: [{ key: "sessionId", match: { value: sessionId } }]
  });

  return {
    sessionId,
    strategy: "delete-by-filter",
    deleted: true
  };
}

export async function cleanupExpiredVectors(
  env: Pick<WorkerEnv, "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KNOWLEDGE_BASE_COLLECTION" | "QDRANT_USER_RESUME_COLLECTION">
) {
  const config = getQdrantConfig(env);
  if (!config) {
    return {
      deletedCount: 0,
      strategy: "not-configured"
    };
  }

  await ensureCollections(config);
  await deleteByFilter(config, config.userResumeCollection, {
    must: [{ key: "expiresAt", range: { lt: Date.now() } }]
  });

  return {
    deletedCount: 0,
    strategy: "delete-expired-by-filter"
  };
}

export function chunkResumeText(resumeText: string): ResumeChunk[] {
  const paragraphs = resumeText
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.slice(0, 12).map((paragraph) => ({
    text: paragraph.slice(0, 900),
    chunkType: classifyChunk(paragraph)
  }));
}

export async function upsertResumeChunks(
  env: Pick<WorkerEnv, "AI" | "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KNOWLEDGE_BASE_COLLECTION" | "QDRANT_USER_RESUME_COLLECTION">,
  sessionId: string,
  chunks: ResumeChunk[]
) {
  const config = getQdrantConfig(env);
  if (!config || chunks.length === 0) {
    return {
      sessionId,
      indexedCount: 0,
      strategy: config ? "no-chunks" : "not-configured"
    };
  }

  await ensureCollections(config);
  const embeddings = await embedTexts(
    chunks.map((chunk) => chunk.text),
    env.AI
  );
  const expiresAt = Date.now() + EXPIRY_WINDOW_MS;

  const points: QdrantPoint[] = chunks.map((chunk, index) => ({
    id: makePointId(`${sessionId}:${index}:${chunk.text}`),
    vector: embeddings[index],
    payload: {
      sessionId,
      expiresAt,
      source: "resume",
      sourceType: "user_resume",
      chunkType: chunk.chunkType,
      isCurated: false,
      text: chunk.text
    }
  }));

  await putPoints(config, config.userResumeCollection, points);

  return {
    sessionId,
    indexedCount: chunks.length,
    strategy: env.AI ? "workers-ai-embeddings" : "deterministic-fallback-embeddings"
  };
}

export async function upsertKnowledgeDocuments(
  env: Pick<WorkerEnv, "AI" | "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KNOWLEDGE_BASE_COLLECTION" | "QDRANT_USER_RESUME_COLLECTION">,
  documents: KnowledgeDocument[]
) {
  const config = getQdrantConfig(env);
  if (!config || documents.length === 0) {
    return {
      importedCount: 0,
      collection: config?.knowledgeBaseCollection ?? "knowledge_base"
    };
  }

  await ensureCollections(config);
  const embeddings = await embedTexts(
    documents.map((document) => `${document.title}\n\n${document.text}`),
    env.AI
  );

  const points: QdrantPoint[] = documents.map((document, index) => ({
    id: makePointId(document.id ?? `${document.title}:${index}:${document.text}`),
    vector: embeddings[index],
    payload: {
      source: "knowledge",
      sourceType: document.sourceType ?? "resume_guide",
      qualityScore: document.qualityScore ?? 1,
      isCurated: true,
      title: document.title,
      text: document.text,
      expiresAt: null
    }
  }));

  await putPoints(config, config.knowledgeBaseCollection, points);

  return {
    importedCount: documents.length,
    collection: config.knowledgeBaseCollection
  };
}

function getQdrantConfig(
  env: Pick<WorkerEnv, "QDRANT_URL" | "QDRANT_API_KEY" | "QDRANT_KNOWLEDGE_BASE_COLLECTION" | "QDRANT_USER_RESUME_COLLECTION">
): QdrantConfig | null {
  if (!env.QDRANT_URL || !env.QDRANT_API_KEY) {
    return null;
  }

  return {
    url: env.QDRANT_URL.replace(/\/+$/, ""),
    apiKey: env.QDRANT_API_KEY,
    knowledgeBaseCollection: env.QDRANT_KNOWLEDGE_BASE_COLLECTION || "knowledge_base",
    userResumeCollection: env.QDRANT_USER_RESUME_COLLECTION || "user_resume_chunks"
  };
}

async function ensureCollections(config: QdrantConfig): Promise<void> {
  await Promise.all([
    ensureCollection(config, config.knowledgeBaseCollection),
    ensureCollection(config, config.userResumeCollection)
  ]);
}

async function ensureCollection(config: QdrantConfig, collectionName: string): Promise<void> {
  await qdrantFetch(config, `/collections/${collectionName}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: {
        size: EMBEDDING_DIMENSION,
        distance: "Cosine"
      }
    })
  }, true);

  await Promise.all([
    createPayloadIndex(config, collectionName, "sessionId", "keyword"),
    createPayloadIndex(config, collectionName, "source", "keyword"),
    createPayloadIndex(config, collectionName, "sourceType", "keyword"),
    createPayloadIndex(config, collectionName, "expiresAt", "integer")
  ]);
}

async function createPayloadIndex(
  config: QdrantConfig,
  collectionName: string,
  fieldName: string,
  fieldSchema: "keyword" | "integer"
): Promise<void> {
  await qdrantFetch(config, `/collections/${collectionName}/index`, {
    method: "PUT",
    body: JSON.stringify({
      field_name: fieldName,
      field_schema: fieldSchema
    })
  }, true);
}

async function searchCollection(
  config: QdrantConfig,
  collectionName: string,
  vector: number[],
  filter?: Record<string, unknown>
): Promise<RetrievedChunk[]> {
  const result = await qdrantFetch<{ result?: QdrantSearchResult[] }>(
    config,
    `/collections/${collectionName}/points/search`,
    {
      method: "POST",
      body: JSON.stringify({
        vector,
        limit: 4,
        with_payload: true,
        filter
      })
    }
  );

  return (result.result ?? [])
    .map((item) => item.payload)
    .filter(
      (
        payload
      ): payload is {
        text: string;
        title?: string;
        source?: "resume" | "knowledge";
        sourceType?: "user_resume" | "expert_resume" | "resume_guide" | "jd_template";
      } => Boolean(payload?.text)
    )
    .map((payload) => ({
      text: payload.text,
      title: payload.title,
      source: payload.source ?? (collectionName === config.userResumeCollection ? "resume" : "knowledge"),
      sourceType: payload.sourceType
    }));
}

async function putPoints(config: QdrantConfig, collectionName: string, points: QdrantPoint[]): Promise<void> {
  await qdrantFetch(config, `/collections/${collectionName}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points })
  });
}

async function deleteByFilter(
  config: QdrantConfig,
  collectionName: string,
  filter: Record<string, unknown>
): Promise<void> {
  await qdrantFetch(config, `/collections/${collectionName}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter })
  });
}

async function qdrantFetch<T>(
  config: QdrantConfig,
  path: string,
  init: RequestInit,
  allowAlreadyExists = false
): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "api-key": config.apiKey,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (allowAlreadyExists && (response.status === 400 || response.status === 409) && /already exists/i.test(errorText)) {
      return {} as T;
    }
    throw new Error(`Qdrant request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

async function embedTexts(texts: string[], ai?: AiBinding): Promise<number[][]> {
  if (ai) {
    const result = await ai.run(EMBEDDING_MODEL, {
      text: texts,
      pooling: "mean"
    });
    const parsed = extractEmbeddings(result);
    if (parsed.length === texts.length) {
      return parsed;
    }
  }

  return texts.map((text) => createDeterministicEmbedding(text));
}

function extractEmbeddings(result: unknown): number[][] {
  if (!result || typeof result !== "object") {
    return [];
  }

  const candidate = result as { data?: unknown; result?: { data?: unknown } };
  const data = candidate.data ?? candidate.result?.data;

  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (item): item is number[] => Array.isArray(item) && item.every((value) => typeof value === "number")
  );
}

function createDeterministicEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);

  tokens.forEach((token, tokenIndex) => {
    const hash = hashToken(token);
    const slot = Math.abs(hash) % EMBEDDING_DIMENSION;
    vector[slot] += 1 + (tokenIndex % 7) * 0.1;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

function hashToken(token: string): number {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) | 0;
  }
  return hash;
}

function makePointId(input: string): string {
  const segments = [
    seededHash(input, 0x811c9dc5),
    seededHash(input, 0x9e3779b1),
    seededHash(input, 0x85ebca6b),
    seededHash(input, 0xc2b2ae35)
  ].map((value) => value.toString(16).padStart(8, "0"));

  const raw = segments.join("").slice(0, 32).split("");
  raw[12] = "4";
  raw[16] = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);

  const normalized = raw.join("");
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32)
  ].join("-");
}

function seededHash(input: string, seed: number): number {
  let hash = seed >>> 0;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash >>> 0;
}

function classifyChunk(text: string): ResumeChunk["chunkType"] {
  const lowerText = text.toLowerCase();

  if (lowerText.includes("skill") || lowerText.includes("stack") || lowerText.includes("tool")) {
    return "skills";
  }

  if (lowerText.includes("project") || lowerText.includes("built") || lowerText.includes("launched")) {
    return "project";
  }

  if (lowerText.includes("experience") || lowerText.includes("worked") || lowerText.includes("engineer")) {
    return "experience";
  }

  return "general_tip";
}
