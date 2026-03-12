import type { ChatMessage, ResumeSummary, SessionState } from "@resume-advisor/shared";
import { cleanupSessionVectors } from "../services/qdrantService";
import type { WorkerEnv } from "../workerEnv";

const SESSION_STORAGE_KEY = "session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type InitPayload = {
  sessionId: string;
  resumeText: string;
  jobDescription: string;
  resumeSummary?: ResumeSummary;
};

type AppendPayload = {
  userMessage: string;
  assistantMessage: string;
};

export class SessionDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: WorkerEnv
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/init") {
      console.log("[SessionDO] Handling /init");
      return this.handleInit(request);
    }

    if (request.method === "GET" && url.pathname === "/state") {
      console.log("[SessionDO] Handling /state");
      return this.handleState();
    }

    if (request.method === "POST" && url.pathname === "/append-chat") {
      console.log("[SessionDO] Handling /append-chat");
      return this.handleAppendChat(request);
    }

    if (request.method === "POST" && url.pathname === "/mark-ready") {
      console.log("[SessionDO] Handling /mark-ready");
      return this.handleMarkReady(request);
    }

    if (request.method === "POST" && url.pathname === "/mark-failed") {
      console.log("[SessionDO] Handling /mark-failed");
      return this.handleMarkFailed();
    }

    if (request.method === "POST" && url.pathname === "/end") {
      console.log("[SessionDO] Handling /end");
      return this.handleEnd();
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const session = await this.readSession();
    if (session?.sessionId) {
      console.log(`[SessionDO] Alarm fired for ${session.sessionId}. Cleaning up vectors...`);
      // Qdrant service expects (sessionId, env)
      await cleanupSessionVectors(session.sessionId, this.env);
    }
    await this.state.storage.deleteAll();
  }

  private async handleInit(request: Request): Promise<Response> {
    const payload = (await request.json()) as InitPayload;
    const now = new Date().toISOString();

    const session: SessionState = {
      sessionId: payload.sessionId,
      resumeText: payload.resumeText,
      resumeSummary: payload.resumeSummary,
      jobDescription: payload.jobDescription,
      messages: [],
      retrievalStatus: "pending",
      resumeVectorIndexed: false,
      createdAt: now,
      updatedAt: now
    };

    await this.writeSession(session);
    await this.state.storage.setAlarm(Date.now() + SESSION_TTL_MS);
    return this.json(session);
  }

  private async handleState(): Promise<Response> {
    const session = await this.readSession();
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    return this.json(session);
  }

  private async handleAppendChat(request: Request): Promise<Response> {
    const session = await this.readSession();
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    const payload = (await request.json()) as AppendPayload;
    const timestamp = new Date().toISOString();
    const nextMessages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: payload.userMessage, createdAt: timestamp },
      { role: "assistant", content: payload.assistantMessage, createdAt: timestamp }
    ];

    const updatedSession: SessionState = {
      ...session,
      messages: nextMessages,
      updatedAt: timestamp
    };

    await this.writeSession(updatedSession);
    return this.json(updatedSession);
  }

  private async handleMarkReady(request: Request): Promise<Response> {
    const session = await this.readSession();
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    const payload = (await request.json()) as { resumeSummary?: ResumeSummary };
    const updatedSession: SessionState = {
      ...session,
      resumeSummary: payload.resumeSummary ?? session.resumeSummary,
      retrievalStatus: "ready",
      resumeVectorIndexed: true,
      updatedAt: new Date().toISOString()
    };

    await this.writeSession(updatedSession);
    return this.json(updatedSession);
  }

  private async handleEnd(): Promise<Response> {
    await this.state.storage.deleteAll();
    return this.json({ status: "ended" });
  }

  private async handleMarkFailed(): Promise<Response> {
    const session = await this.readSession();
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    const updatedSession: SessionState = {
      ...session,
      retrievalStatus: "failed",
      resumeVectorIndexed: false,
      updatedAt: new Date().toISOString()
    };

    await this.writeSession(updatedSession);
    return this.json(updatedSession);
  }

  private async readSession(): Promise<SessionState | null> {
    return (await this.state.storage.get<SessionState>(SESSION_STORAGE_KEY)) ?? null;
  }

  private async writeSession(session: SessionState): Promise<void> {
    await this.state.storage.put(SESSION_STORAGE_KEY, session);
  }

  private json(data: unknown, status = 200): Response {
    const body = JSON.stringify(data);
    console.log(`[SessionDO] Response ${status}: ${body.slice(0, 100)}${body.length > 100 ? "..." : ""}`);
    return new Response(body, {
      status,
      headers: {
        "content-type": "application/json"
      }
    });
  }
}
