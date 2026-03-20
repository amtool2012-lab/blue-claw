import "dotenv/config";
import express from "express";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, "data");
const sessionsFile = path.join(dataDir, "sessions.json");
const actionTimeoutMs = 20_000;

const APP_ALIASES = {
  calculator: "calc.exe",
  calc: "calc.exe",
  chrome: "chrome.exe",
  edge: "msedge.exe",
  explorer: "explorer.exe",
  notepad: "notepad.exe",
  paint: "mspaint.exe",
  powershell: "powershell.exe",
  vscode: "code",
  code: "code"
};

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
      "You are Blue Claw, a helpful personal AI assistant. Be concise, practical, and friendly.",
    tools: {
      shell: true,
      apps: true,
      browser: true
    }
  };
}

function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toBrowserUrl(rawInput) {
  const value = String(rawInput || "").trim();
  if (!value) {
    throw new Error("Browser action needs a URL or search query.");
  }

  if (isSafeHttpUrl(value)) {
    return value;
  }

  if (/^[\w.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(value)) {
    return `https://${value}`;
  }

  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

function createActionRequest(type, payload, text) {
  if (type === "shell") {
    const command = String(payload.command || "").trim();
    if (!command) throw new Error("Shell action needs a command.");
    if (command.length > 500) throw new Error("Shell command is too long.");
    return {
      id: randomUUID(),
      type,
      status: "pending",
      label: `Run shell command: ${command}`,
      payload: { command },
      summary: `Blue Claw can run this command for you after approval:\n\n${command}`,
      sourceText: text
    };
  }

  if (type === "app") {
    const target = String(payload.target || "").trim();
    if (!target) throw new Error("App action needs an application name or path.");
    return {
      id: randomUUID(),
      type,
      status: "pending",
      label: `Open application: ${target}`,
      payload: { target },
      summary: `Blue Claw can launch this application or file after approval:\n\n${target}`,
      sourceText: text
    };
  }

  if (type === "browser") {
    const url = toBrowserUrl(payload.target);
    return {
      id: randomUUID(),
      type,
      status: "pending",
      label: `Open browser: ${url}`,
      payload: { target: payload.target, url },
      summary: `Blue Claw can open this in your browser after approval:\n\n${url}`,
      sourceText: text
    };
  }

  throw new Error("Unsupported action type.");
}

function parseLocalActionRequest(text) {
  const input = String(text || "").trim();
  if (!input.startsWith("/")) return null;

  if (input === "/help") {
    return {
      kind: "help",
      content:
        "Local actions:\n\n/cmd <powershell command>\n/app <application name or path>\n/browse <url or search query>\n/open <url or search query>\n/help"
    };
  }

  const shellMatch = input.match(/^\/cmd\s+([\s\S]+)$/i);
  if (shellMatch) {
    return { kind: "action", actionRequest: createActionRequest("shell", { command: shellMatch[1] }, input) };
  }

  const appMatch = input.match(/^\/app\s+([\s\S]+)$/i);
  if (appMatch) {
    return { kind: "action", actionRequest: createActionRequest("app", { target: appMatch[1] }, input) };
  }

  const browserMatch = input.match(/^\/(?:browse|open)\s+([\s\S]+)$/i);
  if (browserMatch) {
    return { kind: "action", actionRequest: createActionRequest("browser", { target: browserMatch[1] }, input) };
  }

  return {
    kind: "help",
    content:
      "I did not recognize that local action command.\n\nUse /cmd, /app, /browse, /open, or /help."
  };
}

function sanitizeOutput(text = "") {
  return String(text).replace(/\0/g, "").trim();
}

async function runPowerShell(command) {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { timeout: actionTimeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }
  );

  return {
    stdout: sanitizeOutput(stdout),
    stderr: sanitizeOutput(stderr)
  };
}

async function executeActionRequest(actionRequest) {
  if (actionRequest.type === "shell") {
    const result = await runPowerShell(actionRequest.payload.command);
    return {
      type: "shell",
      title: "Command executed",
      text:
        `Command:\n${actionRequest.payload.command}\n\n` +
        `Stdout:\n${result.stdout || "(empty)"}\n\n` +
        `Stderr:\n${result.stderr || "(empty)"}`
    };
  }

  if (actionRequest.type === "app") {
    const rawTarget = String(actionRequest.payload.target || "").trim();
    const aliasTarget = APP_ALIASES[rawTarget.toLowerCase()];
    const target = aliasTarget || rawTarget;
    const escapedTarget = target.replace(/'/g, "''");
    await runPowerShell(`Start-Process -FilePath '${escapedTarget}'`);
    return {
      type: "app",
      title: "Application launched",
      text: `Opened:\n${rawTarget}`
    };
  }

  if (actionRequest.type === "browser") {
    const escapedUrl = actionRequest.payload.url.replace(/'/g, "''");
    await runPowerShell(`Start-Process '${escapedUrl}'`);
    return {
      type: "browser",
      title: "Browser opened",
      text: `Opened:\n${actionRequest.payload.url}`
    };
  }

  throw new Error("Unsupported action type.");
}

function findActionMessage(session, actionId) {
  return session.messages.find((message) => message.actionRequest?.id === actionId) || null;
}

function appendAssistantMessage(session, message) {
  const assistantEntry = {
    id: randomUUID(),
    role: "assistant",
    createdAt: new Date().toISOString(),
    ...message
  };
  session.messages.push(assistantEntry);
  session.updatedAt = assistantEntry.createdAt;
  return assistantEntry;
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
        {
          role: "system",
          content:
            `${config.systemPrompt}\n\n` +
            "You can suggest local actions, but the user must use slash commands to run them.\n" +
            "Available commands: /cmd, /app, /browse, /open, /help."
        },
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
  session.updatedAt = userEntry.createdAt;

  try {
    const localAction = parseLocalActionRequest(userMessage);

    if (localAction?.kind === "help") {
      const assistantEntry = appendAssistantMessage(session, {
        content: localAction.content
      });
      saveSession(session);
      res.json({ session, reply: assistantEntry });
      return;
    }

    if (localAction?.kind === "action") {
      const assistantEntry = appendAssistantMessage(session, {
        content: localAction.actionRequest.summary,
        actionRequest: localAction.actionRequest
      });
      if (!session.title || session.title === "New chat") {
        session.title = trimTitle(userMessage);
      }
      saveSession(session);
      res.json({ session, reply: assistantEntry });
      return;
    }

    const reply = await createAssistantReply(session.messages);
    const assistantEntry = appendAssistantMessage(session, {
      content: reply
    });

    if (!session.title || session.title === "New chat") {
      session.title = trimTitle(userMessage);
    }

    saveSession(session);
    res.json({ session, reply: assistantEntry });
  } catch (error) {
    saveSession(session);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error while generating reply.",
      session
    });
  }
});

app.post("/api/actions/:actionId/execute", async (req, res) => {
  const session = getSession(String(req.body?.sessionId || ""));
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const message = findActionMessage(session, req.params.actionId);
  if (!message?.actionRequest) {
    res.status(404).json({ error: "Pending action not found." });
    return;
  }

  if (message.actionRequest.status !== "pending") {
    res.status(400).json({ error: "This action is no longer pending." });
    return;
  }

  try {
    const result = await executeActionRequest(message.actionRequest);
    message.actionRequest.status = "executed";
    message.actionRequest.executedAt = new Date().toISOString();
    const resultMessage = appendAssistantMessage(session, {
      content: `${result.title}\n\n${result.text}`,
      actionResult: result
    });
    saveSession(session);
    res.json({ session, reply: resultMessage });
  } catch (error) {
    message.actionRequest.status = "failed";
    message.actionRequest.executedAt = new Date().toISOString();
    const failureMessage = appendAssistantMessage(session, {
      content: `Action failed.\n\n${error instanceof Error ? error.message : "Unknown action error."}`,
      actionResult: {
        type: message.actionRequest.type,
        title: "Action failed",
        text: error instanceof Error ? error.message : "Unknown action error."
      }
    });
    saveSession(session);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown action error.",
      session,
      reply: failureMessage
    });
  }
});

app.post("/api/actions/:actionId/cancel", (req, res) => {
  const session = getSession(String(req.body?.sessionId || ""));
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const message = findActionMessage(session, req.params.actionId);
  if (!message?.actionRequest) {
    res.status(404).json({ error: "Pending action not found." });
    return;
  }

  if (message.actionRequest.status !== "pending") {
    res.status(400).json({ error: "This action is no longer pending." });
    return;
  }

  message.actionRequest.status = "cancelled";
  message.actionRequest.cancelledAt = new Date().toISOString();
  const reply = appendAssistantMessage(session, {
    content: `Action cancelled.\n\n${message.actionRequest.label}`
  });
  saveSession(session);
  res.json({ session, reply });
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
