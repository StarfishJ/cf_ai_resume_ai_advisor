import { useEffect, useState, useRef } from "react";
import type {
  ChatMessage,
  ChatRequest,
  SessionInitRequest,
  SessionInitResponse,
  SessionState
} from "@resume-advisor/shared";
import { extractPdfText } from "./pdf";

type UploadState = "idle" | "extracting" | "ready" | "starting";
type WizardStep = "upload" | "review" | "job" | "chat";

interface MessageBlock {
  type: "paragraph" | "list" | "heading";
  content?: string;
  items?: string[];
}

export default function App() {
  // Wizard & View State
  const [activeStep, setActiveStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  
  // Data State
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Chat & Session State
  const [retrievalStatus, setRetrievalStatus] = useState<string>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSessionStats, setShowSessionStats] = useState(false);
  
  // Technical Stats
  const [lastLlmProvider, setLastLlmProvider] = useState<string>("not-called");
  const [resumeHitCount, setResumeHitCount] = useState(0);
  const [knowledgeHitCount, setKnowledgeHitCount] = useState(0);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Sync session status polling
  useEffect(() => {
    if (!sessionId || retrievalStatus === "ready" || retrievalStatus === "failed") {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/session/${sessionId}`);
        if (response.ok) {
          const session = (await response.json()) as SessionState;
          setRetrievalStatus(session.retrievalStatus);
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [sessionId, retrievalStatus]);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setUploadState("extracting");
    try {
      const extracted = await extractPdfText(file);
      setResumeText(extracted);
      setUploadState("ready");
      setActiveStep("review");
    } catch (err) {
      setUploadState("idle");
      setError(err instanceof Error ? err.message : "Failed to extract text");
    }
  };

  // Load session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("resume_session_id");
    if (saved) {
      setSessionId(saved);
      setActiveStep("chat");
      setRetrievalStatus("ready"); // Assume ready for resumed session
    }
  }, []);

  const startSession = async () => {
    setError(null);
    setUploadState("starting");
    try {
      // End previous session if it exists
      if (sessionId) {
        await fetch("/api/session/end", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId })
        });
      }

      const response = await fetch("/api/session/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText, jobDescription, fileName })
      });
      if (!response.ok) throw new Error("Failed to initialize session");
      const data = (await response.json()) as SessionInitResponse;
      
      setSessionId(data.sessionId);
      localStorage.setItem("resume_session_id", data.sessionId);
      
      setRetrievalStatus(data.status);
      setActiveStep("chat");
      setMessages([]);
      setUploadState("ready");
    } catch (err) {
      setUploadState("ready");
      setError(err instanceof Error ? err.message : "Failed to start session");
    }
  };

  const sendMessage = async () => {
    if (!sessionId || !chatInput.trim() || busy) return;
    setBusy(true);
    setError(null);
    const text = chatInput.trim();
    setChatInput("");

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage, { 
      role: "assistant", 
      content: "", 
      createdAt: new Date().toISOString() 
    }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: text })
      });

      if (!response.ok) throw new Error("Chat failed");

      // Update headers
      setRetrievalStatus(response.headers.get("x-retrieval-status") || retrievalStatus);
      setLastLlmProvider(response.headers.get("x-llm-provider") || "unknown");
      setResumeHitCount(Number(response.headers.get("x-resume-hit-count") || 0));
      setKnowledgeHitCount(Number(response.headers.get("x-knowledge-hit-count") || 0));

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Workers AI streams often send "data: { ... }" lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep unfinished line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;

            const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
            try {
              const data = JSON.parse(jsonStr);
              if (data.response) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content: last.content + data.response }];
                  }
                  return prev;
                });
              }
            } catch (e) {
              // Not a valid JSON or a partial line, ignore
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  };

  const buildAssistantBlocks = (content: string): MessageBlock[] => {
    const lines = content.replace(/\r\n/g, "\n").trim().split("\n");
    const blocks: MessageBlock[] = [];
    let pBuffer: string[] = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (pBuffer.length) {
          blocks.push({ type: "paragraph", content: pBuffer.join(" ") });
          pBuffer = [];
        }
      } else if (trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed)) {
        if (pBuffer.length) {
          blocks.push({ type: "paragraph", content: pBuffer.join(" ") });
          pBuffer = [];
        }
        const last = blocks[blocks.length - 1];
        const item = trimmed.replace(/^[-*]|\d+\.\s*/, "").trim();
        if (last?.type === "list") last.items?.push(item);
        else blocks.push({ type: "list", items: [item] });
      } else if (trimmed.endsWith(":")) {
        if (pBuffer.length) {
          blocks.push({ type: "paragraph", content: pBuffer.join(" ") });
          pBuffer = [];
        }
        blocks.push({ type: "heading", content: trimmed.slice(0, -1) });
      } else {
        pBuffer.push(trimmed);
      }
    });

    if (pBuffer.length) blocks.push({ type: "paragraph", content: pBuffer.join(" ") });
    return blocks;
  };

  return (
    <div className="app-shell">
      <aside className="setup-column">
        <div className="hero-section">
          <h1>Resume Advisor</h1>
          <p>Optimize your resume with AI-driven insights and JD alignment.</p>
        </div>

        <nav className="wizard-steps">
          <div 
            className={`wizard-step ${activeStep === "upload" ? "active" : "done"}`}
            onClick={() => setActiveStep("upload")}
          >
            <div className="wizard-step-header">
              <span className="step-number">1</span>
              <h3>Upload Resume</h3>
            </div>
            <p>{fileName || "Select your PDF document"}</p>
          </div>

          <div 
            className={`wizard-step ${activeStep === "review" ? "active" : activeStep === "upload" ? "" : "done"}`}
            onClick={() => resumeText && setActiveStep("review")}
          >
            <div className="wizard-step-header">
              <span className="step-number">2</span>
              <h3>Review Text</h3>
            </div>
            <p>{resumeText ? "Text extracted successfully" : "Confirm parsed content"}</p>
          </div>

          <div 
            className={`wizard-step ${activeStep === "job" ? "active" : (activeStep === "chat" ? "done" : "")}`}
            onClick={() => resumeText && setActiveStep("job")}
          >
            <div className="wizard-step-header">
              <span className="step-number">3</span>
              <h3>Target Job</h3>
            </div>
            <p>{jobDescription ? "JD provided" : "Paste the target description"}</p>
          </div>
        </nav>

        {activeStep === "chat" && (
          <div className="wizard-step active" style={{ marginTop: "auto" }}>
            <div className="wizard-step-header" onClick={() => setShowSessionStats(!showSessionStats)}>
              <span className="step-number" style={{ background: "var(--primary)" }}>i</span>
              <h3>Session Stats</h3>
            </div>
            {showSessionStats && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "0.5rem 0.5rem 0 2.25rem", display: "grid", gap: "0.25rem" }}>
                <div>Provider: {lastLlmProvider}</div>
                <div>Resume Hits: {resumeHitCount}</div>
                <div>Knowledge Hits: {knowledgeHitCount}</div>
                <div style={{ wordBreak: "break-all" }}>ID: {sessionId?.slice(0, 8)}...</div>
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="main-column panel">
        {activeStep === "upload" && (
          <div className="setup-view">
            <h2>Select your Resume</h2>
            <p className="hint">We use browser-side parsing for maximum privacy. Your data only leaves your machine when you start the analysis.</p>
            <div className="form-group" style={{ marginTop: "2rem" }}>
              <input 
                type="file" 
                accept="application/pdf" 
                className="form-input" 
                onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
                disabled={uploadState === "extracting"}
              />
            </div>
            {uploadState === "extracting" && <p className="hint">Extracting content, please wait...</p>}
          </div>
        )}

        {activeStep === "review" && (
          <div className="setup-view">
            <h2>Review Extracted Text</h2>
            <p className="hint">Ensure the content was parsed correctly. Edit as needed to fix layout artifacts.</p>
            <textarea 
              className="form-textarea"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
            <button className="action-button" onClick={() => setActiveStep("job")}>Confirm & Continue</button>
          </div>
        )}

        {activeStep === "job" && (
          <div className="setup-view">
            <h2>Target Job Description</h2>
            <p className="hint">Paste the JD you're aiming for. This helps us tailor the feedback.</p>
            <textarea 
              className="form-textarea"
              placeholder="Paste job description here..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
            <button 
              className="action-button" 
              onClick={startSession} 
              disabled={!jobDescription.trim() || uploadState === "starting"}
            >
              {uploadState === "starting" ? "Configuring AI..." : "Begin Analysis"}
            </button>
          </div>
        )}

        {activeStep === "chat" && (
          <div className="chat-container">
            <header className="status-bar">
              <div className="status-info">
                <span className={`status-badge ${retrievalStatus === "ready" ? "ready" : "pending"}`}>
                  {retrievalStatus === "ready" ? "RAG Ready" : "Indexing..."}
                </span>
                <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>Live Review Session</span>
              </div>
              <button 
                className="switcher-button" 
                style={{ fontSize: "0.75rem", padding: "0.5rem 1rem" }}
                onClick={() => {
                  localStorage.removeItem("resume_session_id");
                  setActiveStep("upload");
                }}
              >
                Reset
              </button>
            </header>

            <div className="message-list" ref={scrollRef}>
              {messages.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "4rem" }}>
                  <p>How can I help you improve your resume for this role?</p>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`message ${m.role}`}>
                    <div className="message-bubble">
                      {m.role === "assistant" ? (
                        buildAssistantBlocks(m.content).map((b, bi) => {
                          if (b.type === "heading") return <h3 key={bi} className="response-heading">{b.content}</h3>;
                          if (b.type === "list") return (
                            <ul key={bi} className="response-list">
                              {b.items?.map((li, lii) => <li key={lii}>{li}</li>)}
                            </ul>
                          );
                          return <p key={bi}>{b.content}</p>;
                        })
                      ) : (
                        <p>{m.content}</p>
                      )}
                    </div>
                    <div className="message-meta">
                      <span>{m.role === "assistant" ? "Advisor" : "You"}</span>
                      {m.createdAt && <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  </div>
                ))
              )}
              {busy && messages[messages.length-1]?.role !== "assistant" && (
                <div className="message assistant">
                  <div className="message-bubble">...</div>
                </div>
              )}
            </div>

            <footer className="composer-area">
              <div className="composer-input-wrapper">
                <textarea 
                  className="composer-textarea"
                  placeholder="Ask about specific sections, keywords, or ATS alignment..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                />
                <button 
                  className="send-button"
                  onClick={sendMessage}
                  disabled={!chatInput.trim() || busy}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            </footer>
          </div>
        )}
      </main>

      {error && (
        <div style={{ 
          position: "fixed", 
          bottom: "2rem", 
          right: "2rem", 
          background: "#fee2e2", 
          color: "#991b1b", 
          padding: "1rem 1.5rem", 
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 100,
          border: "1px solid #fecaca"
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: "1rem", background: "none", border: "none", cursor: "pointer", fontWeight: "bold" }}>×</button>
        </div>
      )}
    </div>
  );
}
