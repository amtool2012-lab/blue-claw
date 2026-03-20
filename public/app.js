const state = {
  sessionId: null,
  sessions: [],
  configured: false
};

const sessionList = document.getElementById("session-list");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const composerStatus = document.getElementById("composer-status");
const configStatus = document.getElementById("config-status");
const messageTemplate = document.getElementById("message-template");

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function relativeTime(value) {
  const deltaMs = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minutes = Math.round(deltaMs / 60000);

  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  return formatter.format(days, "day");
}

function setStatus(text, isError = false) {
  composerStatus.textContent = text;
  composerStatus.classList.toggle("error-text", isError);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderMessage(message) {
  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(message.role === "user" ? "user-message" : "assistant-message");
  node.querySelector(".message-role").textContent = message.role === "user" ? "You" : "Blue Claw";
  node.querySelector(".message-body").innerHTML = escapeHtml(message.content).replaceAll("\n", "<br />");
  messages.appendChild(node);
}

function renderEmptyState() {
  messages.innerHTML = `
    <section class="empty-state">
      <h3>Start simple</h3>
      <p>Create a chat and talk to Blue Claw. Your history stays local in this folder.</p>
    </section>
  `;
}

function renderSessionList() {
  if (!state.sessions.length) {
    sessionList.innerHTML = `<p class="muted">No chats yet.</p>`;
    return;
  }

  sessionList.innerHTML = "";
  state.sessions.forEach((session) => {
    const button = document.createElement("button");
    button.className = "session-item";
    if (session.id === state.sessionId) {
      button.classList.add("active");
    }
    button.innerHTML = `
      <strong>${escapeHtml(session.title)}</strong>
      <span>${session.messageCount} messages</span>
      <span>${relativeTime(session.updatedAt)}</span>
    `;
    button.addEventListener("click", () => loadSession(session.id));
    sessionList.appendChild(button);
  });
}

function renderConfigStatus(config) {
  state.configured = config.configured;
  configStatus.innerHTML = `
    <p><strong>Status:</strong> ${config.configured ? "Configured" : "Needs API key"}</p>
    <p><strong>Model:</strong> ${config.model}</p>
    <p><strong>Base URL:</strong> ${config.baseUrl}</p>
  `;
}

async function refreshSessions() {
  const data = await request("/api/sessions");
  state.sessions = data.sessions;
  renderSessionList();
}

async function refreshConfig() {
  const data = await request("/api/health");
  renderConfigStatus(data);
}

async function loadSession(id) {
  const data = await request(`/api/sessions/${id}`);
  state.sessionId = data.session.id;
  messages.innerHTML = "";

  if (!data.session.messages.length) {
    renderEmptyState();
  } else {
    data.session.messages.forEach(renderMessage);
  }

  renderSessionList();
}

async function createSession() {
  const data = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "New chat" })
  });

  state.sessionId = data.session.id;
  await refreshSessions();
  renderEmptyState();
}

async function sendMessage(event) {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;

  if (!state.configured) {
    setStatus("Add your API key in .env before sending messages.", true);
    return;
  }

  const pendingMessage = {
    role: "user",
    content: message
  };

  if (!state.sessionId && messages.querySelector(".empty-state")) {
    messages.innerHTML = "";
  }

  renderMessage(pendingMessage);
  messages.scrollTop = messages.scrollHeight;
  messageInput.value = "";
  setStatus("Thinking...");

  try {
    const data = await request("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.sessionId,
        message
      })
    });

    state.sessionId = data.session.id;
    renderMessage(data.reply);
    await refreshSessions();
    renderSessionList();
    setStatus("Ready.");
    messages.scrollTop = messages.scrollHeight;
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.getElementById("new-chat-button").addEventListener("click", createSession);
document.getElementById("refresh-button").addEventListener("click", async () => {
  await Promise.all([refreshSessions(), refreshConfig()]);
  setStatus("Refreshed.");
});
chatForm.addEventListener("submit", sendMessage);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

await Promise.all([refreshSessions(), refreshConfig()]);
if (state.sessions.length) {
  await loadSession(state.sessions[0].id);
} else {
  renderEmptyState();
}
