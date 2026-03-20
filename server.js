import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, "data");
const sessionsFile = path.join(dataDir, "sessions.json");

function ensureStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(sessionsFile)) {
    fs.writeFileSync(sessionsFile, JSON.stringify({ sessions: [] }, null, 2));
  }
}

function readStore() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
  } catch {
    return { sessions: [] };
  }
}

function writeStore(store) {
  ensureStorage();
  fs.writeFileSync(sessionsFile, JSON.stringify(store, null, 2));
}

function listSessions() {
  const store = readStore();
  return [...store.sessions].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function getSession(id) {
  return listSessions().find((session) => session.id === id) || null;
}

function makeSession(title = "New chat") {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function saveSession(session) {
  const store = readStore();
  const index = store.sessions.findIndex((item) => item.id === session.id);

  if (index === -1) {
    store.sessions.push(session);
  } else {
    store.sessions[index] = session;
  }

  writeStore(store);
  return session;
}

function deleteSession(id) {
  const store = readStore();
  store.sessions = store.sessions.filter((item) => item.id !== id);
  writeStore(store);
}

function trimTitle(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.slice(0, 48);
}

function getConfig() {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY),
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    systemPrompt:
      process.env.SYSTEM_PROMPT ||
      "You are Blue Claw, a helpful personal AI assistant. Be concise, practical, and friendly."
  };
}

async function createAssistantReply(messages) {
  const config = getConfig();
  if (!config.configured) {
    throw new Error("Missing OPENAI_API_KEY. Copy .env.example to .env and add your key.");
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: config.systemPrompt },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content
        }))
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return "";
      })
      .join("")
      .trim();

    if (text) return text;
  }

  throw new Error("Model response did not include any assistant text.");
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Blue Claw", ...getConfig() });
});

app.get("/api/sessions", (_req, res) => {
  const sessions = listSessions().map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length
  }));
  res.json({ sessions });
});

app.post("/api/sessions", (req, res) => {
  const session = makeSession(trimTitle(req.body?.title));
  saveSession(session);
  res.status(201).json({ session });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  res.json({ session });
});

app.delete("/api/sessions/:id", (req, res) => {
  deleteSession(req.params.id);
  res.status(204).end();
});

app.post("/api/chat", async (req, res) => {
  const userMessage = String(req.body?.message || "").trim();
  const requestedSessionId = req.body?.sessionId;

  if (!userMessage) {
    res.status(400).json({ error: "Message is required." });
    return;
  }

  let session = requestedSessionId ? getSession(requestedSessionId) : null;
  if (!session) {
    session = makeSession(trimTitle(userMessage));
  }

  const userEntry = {
    id: randomUUID(),
    role: "user",
    content: userMessage,
    createdAt: new Date().toISOString()
  };

  session.messages.push(userEntry);

  try {
    const reply = await createAssistantReply(session.messages);
    const assistantEntry = {
      id: randomUUID(),
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    };

    session.messages.push(assistantEntry);
    session.updatedAt = assistantEntry.createdAt;
    if (!session.title || session.title === "New chat") {
      session.title = trimTitle(userMessage);
    }

    saveSession(session);
    res.json({ session, reply: assistantEntry });
  } catch (error) {
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error while generating reply.",
      session
    });
  }
});

ensureStorage();

function startServer(preferredPort, retries = 10) {
  const server = app.listen(preferredPort, () => {
    console.log(`Blue Claw running at http://localhost:${preferredPort}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && retries > 0) {
      console.warn(`Port ${preferredPort} is busy. Trying ${preferredPort + 1}...`);
      startServer(preferredPort + 1, retries - 1);
      return;
    }

    throw error;
  });
}

startServer(port);
