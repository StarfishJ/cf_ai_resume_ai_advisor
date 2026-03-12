# AI Prompts Used

This file records AI prompts used during planning and implementation, as required by the project submission rules.


### Prompt 1

```text
I have drafted an initial Cloudflare architecture for an AI Resume Advisor: the frontend is on Cloudflare Pages, the API entry point is a Cloudflare Worker, conversation history is stored in Durable Objects, Cloudflare Workflows are used for RAG orchestration, Qdrant stores vectors, and Workers AI is used as the LLM. Please help me evaluate whether this architecture is reasonable and whether the division of responsibilities is clear.
```

### Prompt 2

```text
Please organize this solution into a module breakdown that can be implemented in actual development, and clearly define the responsibilities of the frontend, Worker, Cloudflare Workflows, Durable Objects, Qdrant, and Workers AI.
```

### Prompt 3

```text
If both high-quality resumes and average resumes are stored in Qdrant, will that pollute the database? Please explain this from the perspective of RAG retrieval quality and provide a recommended data layering strategy.
```

### Prompt 4

```text
Please save the finalized design document in the repository's docs directory, and update README.md and PROMPTS.md to satisfy the project submission requirements.
```

### Prompt 5

```text
The architecture stores user resume chunks in Qdrant for retrieval. Please define a lifecycle and cleanup strategy for session-scoped vectors, assuming Qdrant Cloud free-tier storage is limited. Include recommended metadata fields, expiration rules, and how cleanup should be triggered.
```

### Prompt 6

```text
The application needs to process uploaded resume PDFs, but the runtime is Cloudflare Workers, which cannot rely on Node.js-native PDF parsing libraries. Please recommend an MVP-safe PDF parsing approach, compare browser-side parsing versus an external parsing API, and state which option should be the default design choice.
```

### Prompt 7

```text
Cloudflare Workflows may still be preprocessing and indexing the resume when the user starts chatting. Please define how the Worker and frontend should behave when retrievalStatus is pending, including fallback answer strategy, user-visible messaging, and when the system should switch back to the normal RAG path.
```

### Prompt 8

```text
Please review the MVP implementation order for this AI Resume Advisor. The current sequence is streaming chat, Durable Objects session memory, PDF upload, Cloudflare Workflows plus Qdrant integration, and prompt compression. Suggest a safer implementation order that reduces debugging complexity and explain the reasoning.
```

### Prompt 9

```text
Please add a short "What This Is Not" section to the architecture document so the scope is explicit. It should clarify that this project is an MVP and not a multi-tenant production platform, not a distributed document processing system, and not a long-term document archive.
```

### Prompt 10

```text
Please review this Cloudflare-based AI Resume Advisor architecture for operational gaps and hardening opportunities. Focus on browser-side PDF extraction reliability, user text preview and correction before analysis, Qdrant vector cleanup tied to session lifecycle, structured resume summaries to control token usage, sliding-window conversation memory, Workers AI retry and backoff strategy, and whether the API should include an explicit session termination endpoint.
```

### Prompt 11

```text
Please provide a concise sequence-oriented explanation of the end-to-end flow for this system, covering browser PDF extraction, session initialization, Workflow-based indexing, pending-status chat fallback, Qdrant retrieval, and streaming chat responses.
```


### Prompt 12

```text
Based on this architecture, please scaffold a minimal npm workspaces monorepo for an AI Resume Advisor with three parts: a Vite React frontend, a Cloudflare Worker backend, and a shared TypeScript package for cross-app types. Keep the structure small but ready for iterative development.
```

### Prompt 13

```text
Please generate a minimal frontend MVP for the AI Resume Advisor that supports browser-side PDF text extraction with pdf.js, manual review and editing of the extracted text, target job description input, session initialization, and a simple streaming chat interface that calls the Worker through /api endpoints.
```

### Prompt 14

```text
Please scaffold a Cloudflare Worker for this project with routes for session initialization, chat, session status lookup, and explicit session termination. Use a Durable Object as the per-session store and keep the LLM, Qdrant, and Workflow integrations as clean service-layer placeholders that can be replaced later.
```

### Prompt 15

```text
Please define the shared TypeScript types needed by both the frontend and Worker for this MVP, including session state, retrieval status, chat messages, session initialization payloads, chat request payloads, and a structured resume summary shape.
```

### Prompt 16

```text
Please update the README so it reflects the new scaffold instead of a documentation-only repository. Include the actual workspace structure, install steps, development commands for the frontend and Worker, and a clear list of what is implemented now versus what remains as placeholders.
```

### Prompt 17

```text
Please validate the scaffold for basic development readiness. The expected outcome is that npm install succeeds, TypeScript type-checking passes across all workspaces, and the frontend plus Worker can both build locally even if external AI and vector services are still mocked.
```

### Prompt 18

```text
Please replace the Worker's fixed fallback chat response with a real Workers AI integration path. Use the existing prompt builder and session state, prefer a small instruct model that works with Cloudflare Workers AI, keep the API response streaming-compatible, and fall back to a deterministic local response when the AI binding is unavailable or the model call fails.
```

### Prompt 19

```text
Please implement the next architecture step: turn the placeholder resume ingest flow into a real Cloudflare Workflow-backed path. The Worker should create a session in a Durable Object, trigger a workflow instance with the session payload, let the workflow build a resume summary, chunk the resume text, simulate or placeholder the indexing step if Qdrant is not integrated yet, and then mark the session as ready. If the workflow fails after retries, mark the session as failed.
```

### Prompt 20

```text
Please prepare the project for a real Qdrant integration using local environment variables. Add an example environment file, document the expected Qdrant variable names, and update the Worker environment types so the remote Qdrant URL, API key, and collection names can be read safely when the integration is implemented.
```

### Prompt 21

```text
Please replace the placeholder Qdrant service with a real remote integration. Use environment variables for the Qdrant URL, API key, and collection names; keep `knowledge_base` and `user_resume_chunks` as separate collections; only write user resume chunks after the frontend review step; create collections and payload indexes if they do not exist; use Workers AI embeddings when available with a deterministic fallback for local development; support chat-time retrieval filtered by `sessionId`; and implement delete-by-filter cleanup for both explicit session end and 24-hour expiry.
```

### Prompt 22

```text
Please add a practical way to import curated documents into the `knowledge_base` collection. The solution should fit local MVP development: add a Worker endpoint that accepts an array of knowledge documents, embed and upsert them into Qdrant, provide a sample JSON file, and add a simple npm script that posts that JSON file to the local Worker.
```

### Prompt 23

```text
Please extend the knowledge import tooling so I can collect different source files under a `knowledge materials` folder and import them in one shot. Support recursive folder scanning for `.md`, `.txt`, and `.json` files, infer the source type from folder names such as `Sample Resumes`, `Job Descriptions`, and `Resume Guidance`, and send the parsed documents to the existing Worker import endpoint.
```

### Prompt 24

```text
Please harden the retrieval strategy so the real-time chat path only pulls `resume_guide` documents from `knowledge_base`. Keep `expert_resume` and `jd_template` stored in Qdrant for future offline analysis or rewrite-template features, but exclude them from the live prompt used to compare the user's resume against the target job description.
```

### Prompt 25

```text
Please perform a deep-dive audit of the existing RAG implementation. Identify and fix any parsing issues in the Workers AI embedding response handling, implement true ReadableStream-based streaming for the chat API to reduce latency, and ensure the UI correctly reflects the retrieval status—especially when indexing fails—by providing clear fallback messaging.
```

### Prompt 26

```text
Redesign the frontend UI to transition from a technical demo to a premium, product-ready experience. Implement a 'Conversation-First' layout using a modern glassmorphism design system, simplify the onboarding into a clear 3-step wizard (Upload -> Review -> Job Description), and polish the chat interface with refined typography, micro-animations, and hidden technical metadata.
```
### Prompt 27

```text
Please harden the Qdrant retrieval logic by adding try-catch blocks and a fallback to empty context. Ensure that "already exists" errors (400/409) during collection and index creation are gracefully handled so the application doesn't crash during initialization or chat.
```

### Prompt 28

```text
Update the system prompt in promptService.ts to include a structured "Matching & Alignment Analysis" requirement. The AI should now start every response with an "Alignment Score" and a list of the "3 Biggest Gaps" between the user's resume and the job description, while strictly adhering to facts found in the resume.
```

### Prompt 29

```text
Align the Vite development proxy with the actual Wrangler port. Update wrangler.toml to explicitly set the port to 8788 and ensure vite.config.ts points to this port. Also, enable 'remote = true' for the AI binding to ensure stable access to models during local development.
```

### Prompt 30

```text
Implement global error handling in the chat route (chat.ts) that captures any uncaught exceptions and returns a JSON response with a stack trace in development mode. Add detailed logging across the LLM and retrieval services to help diagnose persistent 500 errors.
```
