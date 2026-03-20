const state = {
  sessionId: null,
  sessions: [],
  configured: false,
  provider: "openai"
};

const sessionList = document.getElementById("session-list");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const composerStatus = document.getElementById("composer-status");
const configStatus = document.getElementById("config-status");
const messageTemplate = document.getElementById("message-template");
const settingsForm = document.getElementById("settings-form");
const providerInput = document.getElementById("provider-input");
const openAiKeyInput = document.getElementById("openai-key-input");
const openRouterKeyInput = document.getElementById("openrouter-key-input");
const baseUrlInput = document.getElementById("base-url-input");
const modelInput = document.getElementById("model-input");
const openrouterSiteUrlInput = document.getElementById("openrouter-site-url-input");
const openrouterAppNameInput = document.getElementById("openrouter-app-name-input");
const systemPromptInput = document.getElementById("system-prompt-input");
const settingsStatus = document.getElementById("settings-status");
const providerOnlyFields = Array.from(document.querySelectorAll(".provider-only"));

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

function setSettingsStatus(text, isError = false) {
  settingsStatus.textContent = text;
  settingsStatus.classList.toggle("error-text", isError);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isLocalActionMessage(text) {
  return /^\/(?:cmd|app|browse|open|help)\b/i.test(String(text || "").trim());
}

function actionStatusText(status) {
  if (status === "executed") return "Executed";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  return "Pending approval";
}

function renderActionRequest(container, message) {
  const requestData = message.actionRequest;
  if (!requestData) return;

  const card = document.createElement("section");
  card.className = "action-card";
  card.innerHTML = `
    <div class="action-header">
      <strong>${escapeHtml(requestData.label)}</strong>
      <span class="action-status ${escapeHtml(requestData.status)}">${escapeHtml(actionStatusText(requestData.status))}</span>
    </div>
    <pre class="action-body">${escapeHtml(
      requestData.type === "shell"
        ? requestData.payload.command
        : requestData.type === "browser"
          ? requestData.payload.url
          : requestData.payload.target
    )}</pre>
  `;

  if (requestData.status === "pending") {
    const actions = document.createElement("div");
    actions.className = "action-controls";

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.className = "primary-button inline-button";
    approveButton.textContent = "Approve";
    approveButton.addEventListener("click", () => handleAction(message, "execute"));

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ghost-button inline-button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => handleAction(message, "cancel"));

    actions.appendChild(approveButton);
    actions.appendChild(cancelButton);
    card.appendChild(actions);
  }

  container.appendChild(card);
}

function renderActionResult(container, message) {
  if (!message.actionResult) return;

  const card = document.createElement("section");
  card.className = "result-card";
  card.innerHTML = `
    <div class="action-header">
      <strong>${escapeHtml(message.actionResult.title)}</strong>
      <span class="action-status executed">Result</span>
    </div>
    <pre class="action-body">${escapeHtml(message.actionResult.text)}</pre>
  `;
  container.appendChild(card);
}

function renderMessage(message) {
  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(message.role === "user" ? "user-message" : "assistant-message");
  node.querySelector(".message-role").textContent = message.role === "user" ? "You" : "Blue Claw";
  node.querySelector(".message-body").innerHTML = escapeHtml(message.content).replaceAll("\n", "<br />");

  if (message.actionRequest) {
    renderActionRequest(node, message);
  }

  if (message.actionResult) {
    renderActionResult(node, message);
  }

  messages.appendChild(node);
}

function renderEmptyState() {
  messages.innerHTML = `
    <section class="empty-state">
      <h3>Start simple</h3>
      <p>Chat normally, or use <code>/cmd</code>, <code>/app</code>, <code>/browse</code>, and <code>/help</code> for local actions.</p>
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
  state.provider = config.provider || "openai";
  configStatus.innerHTML = `
    <p><strong>Status:</strong> ${config.configured ? "Configured" : "Needs API key for normal chat"}</p>
    <p><strong>Provider:</strong> ${config.provider}</p>
    <p><strong>Model:</strong> ${config.model}</p>
    <p><strong>Local tools:</strong> shell, apps, browser</p>
    <p><strong>Base URL:</strong> ${config.baseUrl}</p>
  `;
}

function getMissingKeyMessage() {
  const provider = providerInput.value || state.provider || "openai";
  if (provider === "openrouter") {
    return "Add your OpenRouter API key in Setup before using normal chat, or use /help for local actions.";
  }

  return "Add your OpenAI API key in Setup before using normal chat, or use /help for local actions.";
}

function updateProviderFields() {
  const provider = providerInput.value;
  providerOnlyFields.forEach((field) => {
    field.hidden = field.dataset.provider !== provider;
  });
}

function renderSettings(settings) {
  providerInput.value = settings.provider || "openai";
  openAiKeyInput.value = settings.openAiApiKey || "";
  openRouterKeyInput.value = settings.openRouterApiKey || "";
  baseUrlInput.value = settings.baseUrl || "";
  modelInput.value = settings.model || "";
  openrouterSiteUrlInput.value = settings.openrouterSiteUrl || "";
  openrouterAppNameInput.value = settings.openrouterAppName || "";
  systemPromptInput.value = settings.systemPrompt || "";
  updateProviderFields();
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

async function refreshSettings() {
  const data = await request("/api/settings");
  renderSettings(data.settings);
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
  messages.scrollTop = messages.scrollHeight;
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

async function handleAction(message, verb) {
  try {
    setStatus(verb === "execute" ? "Running approved action..." : "Cancelling action...");
    await request(`/api/actions/${message.actionRequest.id}/${verb}`, {
      method: "POST",
      body: JSON.stringify({ sessionId: state.sessionId })
    });
    await refreshSessions();
    await loadSession(state.sessionId);
    setStatus(verb === "execute" ? "Action complete." : "Action cancelled.");
  } catch (error) {
    setStatus(error.message, true);
    await loadSession(state.sessionId);
  }
}

async function saveSettings(event) {
  event.preventDefault();

  try {
    setSettingsStatus("Saving setup...");
    const data = await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        provider: providerInput.value,
        openAiApiKey: openAiKeyInput.value,
        openRouterApiKey: openRouterKeyInput.value,
        baseUrl: baseUrlInput.value,
        model: modelInput.value,
        openrouterSiteUrl: openrouterSiteUrlInput.value,
        openrouterAppName: openrouterAppNameInput.value,
        systemPrompt: systemPromptInput.value
      })
    });

    renderSettings(data.settings);
    renderConfigStatus(data.config);
    setSettingsStatus("Setup saved.");
    setStatus("Configuration updated.");
  } catch (error) {
    setSettingsStatus(error.message, true);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;

  if (!state.configured && !isLocalActionMessage(message)) {
    setStatus(getMissingKeyMessage(), true);
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
  await Promise.all([refreshSessions(), refreshConfig(), refreshSettings()]);
  setStatus("Refreshed.");
});
chatForm.addEventListener("submit", sendMessage);
settingsForm.addEventListener("submit", saveSettings);
providerInput.addEventListener("change", updateProviderFields);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

await Promise.all([refreshSessions(), refreshConfig(), refreshSettings()]);
if (state.sessions.length) {
  await loadSession(state.sessions[0].id);
} else {
  renderEmptyState();
}
