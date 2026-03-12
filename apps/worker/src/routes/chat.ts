import type { ChatMode, ChatRequest, SessionState } from "@resume-advisor/shared";
import { AssistantReply, generateAssistantReply } from "../services/llmService";
import { getRetrievalContext } from "../services/qdrantService";
import type { WorkerEnv } from "../workerEnv";

function getStub(env: WorkerEnv, sessionId: string) {
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

function streamText(text: string, headers: HeadersInit): Response {
  const encoder = new TextEncoder();
  const chunks = text.match(/.{1,80}(\s|$)/g) ?? [text];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  return new Response(stream, { headers });
}

export async function handleChat(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
  try {
    const payload = (await request.json()) as ChatRequest;
    const stub = getStub(env, payload.sessionId);

    const stateResponse = await stub.fetch("https://session/state");
    if (!stateResponse.ok) {
      return new Response("Session not found", { status: 404 });
    }

    const state = (await stateResponse.json()) as SessionState;
    const mode: ChatMode = state.retrievalStatus === "ready" ? "rag-ready" : "pending-full-text";

    console.log(`[Chat] Starting. Session: ${payload.sessionId}, Retrieval Status: ${state.retrievalStatus}`);
    
    const retrievalContext = await getRetrievalContext(state, payload.message, env);
    console.log(`[Chat] Retrieval done. Resume chunks: ${retrievalContext.resumeChunks.length}, Knowledge chunks: ${retrievalContext.knowledgeChunks.length}`);

    console.log(`[Chat] Generating reply. Mode: ${mode}, AI Binding: ${!!env.AI}`);
    const result = await generateAssistantReply({
      state,
      userMessage: payload.message,
      mode,
      retrievalContext,
      ai: env.AI
    });
    console.log(`[Chat] Reply generated. Type: ${result instanceof ReadableStream ? "Stream" : "Object"}`);

    const isStream = result instanceof ReadableStream;
    const finalHeaders = {
      "content-type": isStream ? "text/event-stream" : "text/plain; charset=utf-8",
      "x-retrieval-status": state.retrievalStatus,
      "x-context-mode": mode,
      "x-llm-provider": isStream ? "workers-ai" : "fallback",
      "x-resume-hit-count": String(retrievalContext.resumeChunks.length),
      "x-knowledge-hit-count": String(retrievalContext.knowledgeChunks.length)
    };

    if (!isStream) {
      await stub.fetch("https://session/append-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userMessage: payload.message,
          assistantMessage: (result as AssistantReply).text
        })
      });
      return streamText((result as AssistantReply).text, finalHeaders);
    }

    // For real streams, we transform it to also append to DO after completion
    // but for MVP we might just pipe it.
    // Better: split the stream so we can collect full text for DO.
    if (isStream && typeof (result as any).tee !== 'function') {
      console.error("[Chat] Result is marked as stream but missing tee() method. Falling back to non-stream handling.");
      const text = "AI connection issue. Please try again.";
      return streamText(text, finalHeaders);
    }

    const [clientStream, doStream] = (result as ReadableStream).tee();

    // Fire and forget DO update after stream completion
    ctx.waitUntil((async () => {
      try {
        const reader = doStream.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          
          // Extract content from SSE data: {"response": "..."}
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (dataStr === "[DONE]") continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.response) fullText += data.response;
              } catch (e) { /* ignore partial JSON */ }
            }
          }
        }
        
        if (fullText.length > 0) {
          console.log(`[Chat] Stream complete. Saving full text to DO (${fullText.length} chars)`);
          await stub.fetch("https://session/append-chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              userMessage: payload.message,
              assistantMessage: fullText
            })
          });
        } else {
          console.warn("[Chat] Stream finished but no text was collected.");
        }
      } catch (e) {
        console.error("[Chat] Post-stream DO update failed:", e);
      }
    })());

    return new Response(clientStream, { headers: finalHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error(`[Chat] CRITICAL UNCAUGHT ERROR for session ${ (request as any).sessionId || 'unknown'}:`, message, stack);
    
    // Attempt last-ditch JSON response
    try {
      return new Response(JSON.stringify({ 
        error: "Internal Server Error",
        message: message,
        stack: env?.ENVIRONMENT === "development" ? stack : undefined
      }), {
        status: 500,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*"
        }
      });
    } catch (e) {
      return new Response("Critical Worker Error", { status: 500, headers: { "access-control-allow-origin": "*" } });
    }
  }
}
