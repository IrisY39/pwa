import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowBigLeft,
  History,
  MessageCirclePlus,
  Search,
  ChevronsDown,
  MoreHorizontal,
  RefreshCw,
  Copy,
  SquarePen,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  Wrench,
  BookHeart,
  FileClock,
  Bot,
  Earth,
  Sparkles
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@supabase/supabase-js";

const AVATAR_USER =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' rx='20' fill='%231f2a44'/><circle cx='48' cy='38' r='18' fill='%235de4c7'/><rect x='22' y='58' width='52' height='22' rx='11' fill='%2379a8ff'/></svg>";
const AVATAR_ASSISTANT =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' rx='20' fill='%231a2228'/><circle cx='48' cy='40' r='18' fill='%2379a8ff'/><rect x='20' y='60' width='56' height='20' rx='10' fill='%235de4c7'/></svg>";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const supabase =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

const isSupabaseEnabled = () => !!supabase;
const APP_SETTINGS_ROW_ID = "default";
const MEMORY_LIST_KEY = "opt_memory_list";
const SYNCED_SETTING_KEYS = [
  "api_url",
  "api_key",
  "api_model",
  "opt_added_models",
  "opt_api_providers",
  "opt_temperature",
  "opt_top_p",
  "opt_max_tokens",
  "opt_context_limit",
  "opt_stream",
  "opt_assistant_name",
  "opt_assistant_avatar",
  "opt_user_avatar",
  "opt_system_prompt",
  "opt_message_template",
  "opt_search_enabled",
  "opt_mcp_enabled",
  "opt_memory_enabled",
  "mcp_url",
  "mcp_api_key",
  "web_search_url",
  "web_search_api_key"
];
const SYNCED_SETTING_KEY_SET = new Set(SYNCED_SETTING_KEYS);
let settingsSyncTimer = null;
let suppressRemoteSettingSync = false;
let settingsHydratedOnce = false;
let settingsHydratePromise = null;

const emitSettingsUpdate = () => {
  try {
    window.dispatchEvent(new Event("settings:update"));
  } catch {}
};

const collectSyncedSettingsFromLocal = () => {
  const out = {};
  SYNCED_SETTING_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  });
  return out;
};

const applySyncedSettingsToLocal = (settings) => {
  if (!settings || typeof settings !== "object") return;
  suppressRemoteSettingSync = true;
  try {
    Object.entries(settings).forEach(([key, value]) => {
      if (!SYNCED_SETTING_KEY_SET.has(key)) return;
      if (value == null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, String(value));
      }
    });
  } catch {}
  suppressRemoteSettingSync = false;
  emitModelsUpdate();
  window.dispatchEvent(new Event("memory:update"));
  emitSettingsUpdate();
};

const syncSettingsToSupabase = async () => {
  if (!supabase) return;
  try {
    const data = collectSyncedSettingsFromLocal();
    const { error } = await supabase.from("app_settings").upsert(
      {
        id: APP_SETTINGS_ROW_ID,
        updated_at: new Date().toISOString(),
        data
      },
      { onConflict: "id" }
    );
    if (error) {
      console.warn("supabase sync app settings failed", error);
    }
  } catch (err) {
    console.warn("supabase sync app settings exception", err);
  }
};

const queueSettingsSync = () => {
  if (!supabase || suppressRemoteSettingSync) return;
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
  settingsSyncTimer = setTimeout(() => {
    syncSettingsToSupabase();
  }, 800);
};

const hydrateSettingsFromSupabase = async () => {
  if (!supabase) return;
  if (settingsHydratedOnce) return;
  if (settingsHydratePromise) return settingsHydratePromise;
  settingsHydratePromise = (async () => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("data")
      .eq("id", APP_SETTINGS_ROW_ID)
      .maybeSingle();
    if (error) {
      console.warn("supabase load app settings failed", error);
      settingsHydratedOnce = true;
      settingsHydratePromise = null;
      return;
    }
    if (data?.data && typeof data.data === "object") {
      applySyncedSettingsToLocal(data.data);
    } else {
      queueSettingsSync();
    }
    settingsHydratedOnce = true;
    settingsHydratePromise = null;
  })();
  return settingsHydratePromise;
};

const normalizeExternalRole = (role) => {
  const value = String(role || "").toLowerCase().trim();
  if (!value) return "";
  if (value === "user" || value === "human") return "user";
  if (
    value === "assistant" ||
    value === "bot" ||
    value === "model" ||
    value === "ai"
  ) {
    return "assistant";
  }
  return "";
};

const parseMessageText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text" && typeof item?.text === "string") return item.text;
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .join("")
      .trim();
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }
  return "";
};

const normalizeSessionMessages = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      if (m.position === "left" || m.position === "right") {
        return ensureMessageId(m);
      }
      const role = normalizeExternalRole(m.role);
      if (!role) return null;
      const text = parseMessageText(
        m.content ?? m.text ?? m.message ?? m.value ?? ""
      );
      const rawTime = m.timestamp ?? m.createdAt ?? m.created_at ?? m.time;
      const createdAt =
        typeof rawTime === "number" ? rawTime : Date.parse(rawTime) || Date.now();
      const model =
        role === "assistant"
          ? String(m.model || m.assistant_model || m.model_id || "").trim()
          : "";
      return ensureMessageId(
        buildMessage({
          role,
          text: String(text || ""),
          tokens: role === "assistant" ? estimateTokens(String(text || "")) : 0,
          createdAt,
          model
        })
      );
    })
    .filter(Boolean);
};

const mapSessionMetaForDb = (session, includeCreatedAt = true) => {
  const createdAt = session.createdAt || session.updatedAt || Date.now();
  const payload = {
    id: String(session.id),
    title: session.title || "新对话",
    updated_at: new Date(session.updatedAt || Date.now()).toISOString()
  };
  if (includeCreatedAt) {
    payload.created_at = new Date(createdAt).toISOString();
  }
  return payload;
};

const mapMessagesForDb = (session) => {
  const sessionId = String(session.id);
  return (Array.isArray(session.messages) ? session.messages : [])
    .map((m, idx) => {
      const isUser = m?.position === "right";
      const role = isUser ? "human" : "assistant";
      const text = String(m?.content?.text || "");
      if (!text) return null;
      const createdAt = m?.createdAt ? Number(m.createdAt) : Date.now();
      return {
        id: String(m?._id || `${sessionId}_${idx}`),
        session_id: sessionId,
        role,
        content: text,
        model: role === "assistant" ? String(m?.model || "") : null,
        timestamp: new Date(createdAt).toISOString(),
        seq: idx
      };
    })
    .filter(Boolean);
};

const fetchSessionsRows = async () => {
  const selectPlans = [
    "id,title,created_at,updated_at",
    "id,title,updated_at",
    "id,title,created_at,updated_at,data",
    "id,title,updated_at,data"
  ];
  let lastError = null;
  for (const selectClause of selectPlans) {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select(selectClause)
      .order("updated_at", { ascending: false });
    if (!error) return { data, error: null };
    lastError = error;
  }
  return { data: null, error: lastError };
};

const fetchMessagesRows = async () => {
  let data = null;
  let error = null;
  ({ data, error } = await supabase
    .from("chat_messages")
    .select("id,session_id,role,content,model,timestamp,seq")
    .order("session_id", { ascending: true })
    .order("seq", { ascending: true })
    .order("timestamp", { ascending: true }));
  if (error && String(error.message || "").includes("seq")) {
    ({ data, error } = await supabase
      .from("chat_messages")
      .select("id,session_id,role,content,model,timestamp")
      .order("session_id", { ascending: true })
      .order("timestamp", { ascending: true }));
  }
  return { data, error };
};

const fetchSessionsFromSupabase = async () => {
  if (!supabase) return [];
  const { data: sessionRows, error: sessionError } = await fetchSessionsRows();
  if (sessionError) {
    console.warn("supabase load sessions failed", sessionError);
    return [];
  }
  const { data: msgRows, error: msgError } = await fetchMessagesRows();
  const hasMessageTable = !msgError;
  if (msgError) {
    console.warn("supabase load chat_messages failed, fallback to legacy data", msgError);
  }

  const messagesBySession = new Map();
  if (hasMessageTable) {
    (msgRows || []).forEach((row) => {
      const sid = String(row.session_id || "");
      if (!sid) return;
      const list = messagesBySession.get(sid) || [];
      list.push(
        ensureMessageId(
          buildMessage({
            role: normalizeExternalRole(row.role) || "assistant",
            text: parseMessageText(row.content || ""),
            tokens:
              normalizeExternalRole(row.role) === "assistant"
                ? estimateTokens(parseMessageText(row.content || ""))
                : 0,
            createdAt: Date.parse(row.timestamp) || Date.now(),
            model: String(row.model || "")
          })
        )
      );
      messagesBySession.set(sid, list);
    });
  }

  return (sessionRows || []).map((row) => {
    const fallbackCreated =
      typeof row.created_at === "string" ? Date.parse(row.created_at) : Date.now();
    const createdAtFromColumn = Number.isFinite(fallbackCreated)
      ? fallbackCreated
      : Date.now();
    const fallbackUpdated =
      typeof row.updated_at === "string" ? Date.parse(row.updated_at) : Date.now();
    const updatedAt = Number.isFinite(fallbackUpdated) ? fallbackUpdated : Date.now();
    const sessionId = String(row.id);
    const rowData = row.data && typeof row.data === "object" ? row.data : {};
    const legacyMessages = normalizeSessionMessages(rowData.messages || []);
    const normalizedMessages =
      messagesBySession.get(sessionId) || legacyMessages || [];
    return {
      ...rowData,
      id: sessionId,
      title: row.title || rowData.title || "新对话",
      createdAt:
        rowData.createdAt ??
        rowData.created_at ??
        createdAtFromColumn ??
        updatedAt,
      updatedAt,
      messages: normalizedMessages
    };
  });
};

const syncSessionsToSupabase = async (sessions) => {
  if (!supabase) return;
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return;

  const sessionPayload = list.map((s) => mapSessionMetaForDb(s, true));
  let { error: sessionError } = await supabase
    .from("chat_sessions")
    .upsert(sessionPayload, { onConflict: "id" });
  if (sessionError && String(sessionError.message || "").includes("created_at")) {
    const fallbackPayload = list.map((s) => mapSessionMetaForDb(s, false));
    ({ error: sessionError } = await supabase
      .from("chat_sessions")
      .upsert(fallbackPayload, { onConflict: "id" }));
  }
  if (sessionError) {
    console.warn("supabase sync chat_sessions failed", sessionError);
    return;
  }

  const sessionIds = list.map((s) => String(s.id));
  const { error: deleteMsgError } = await supabase
    .from("chat_messages")
    .delete()
    .in("session_id", sessionIds);
  if (
    deleteMsgError &&
    !String(deleteMsgError.message || "").includes("chat_messages")
  ) {
    console.warn("supabase clear chat_messages failed", deleteMsgError);
  }

  const messagePayload = list.flatMap((s) => mapMessagesForDb(s));
  if (!messagePayload.length) return;
  const { error: messageError } = await supabase
    .from("chat_messages")
    .upsert(messagePayload, { onConflict: "id" });
  if (messageError) {
    console.warn("supabase sync chat_messages failed", messageError);
  }
};

const deleteSessionFromSupabase = async (sessionId) => {
  if (!supabase || !sessionId) return;
  const { error: msgError } = await supabase
    .from("chat_messages")
    .delete()
    .eq("session_id", String(sessionId));
  if (
    msgError &&
    !String(msgError.message || "").includes("chat_messages")
  ) {
    console.warn("supabase delete session messages failed", msgError);
  }
  const { error } = await supabase
    .from("chat_sessions")
    .delete()
    .eq("id", String(sessionId));
  if (error) {
    console.warn("supabase delete session failed", error);
  }
};

let supabaseSyncTimer = null;
const queueSupabaseSync = (sessions) => {
  if (!supabase) return;
  if (supabaseSyncTimer) clearTimeout(supabaseSyncTimer);
  supabaseSyncTimer = setTimeout(() => {
    syncSessionsToSupabase(sessions);
  }, 800);
};

const estimateTokens = (text) => {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fff]/g, " ").match(/\S+/g) || []).length;
  return Math.max(1, Math.ceil(cjk / 2) + words);
};

const sanitizeText = (text) =>
  text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractThinkAndTools = (text) => {
  if (!text) return { cleanText: "", thinkText: "", tools: [] };
  let remaining = text;
  const thinkMatches = [];
  const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  remaining = remaining.replace(thinkRegex, (_m, p1) => {
    if (p1 && p1.trim()) thinkMatches.push(p1.trim());
    return "";
  });
  const tools = [];
  const toolCallRegex = /<tool_call\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/tool_call>/gi;
  remaining = remaining.replace(toolCallRegex, (_m, name, body) => {
    tools.push({ type: "call", name, content: body?.trim() || "" });
    return "";
  });
  const toolResultRegex = /<tool_result\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/tool_result>/gi;
  remaining = remaining.replace(toolResultRegex, (_m, name, body) => {
    tools.push({ type: "result", name, content: body?.trim() || "" });
    return "";
  });
  return {
    cleanText: sanitizeText(remaining),
    thinkText: thinkMatches.join("\n\n"),
    tools
  };
};

const readSetting = (key, fallback = "") => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const writeSetting = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
  if (SYNCED_SETTING_KEY_SET.has(key)) {
    queueSettingsSync();
    emitSettingsUpdate();
  }
};

const normalizeBaseUrl = (url) => {
  const cleaned = (url || "").trim().replace(/\/+$/, "");
  return cleaned;
};

const buildChatEndpoint = (baseUrl) => {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  if (base.endsWith("/chat/completions") || base.endsWith("/responses")) return base;
  return `${base}/chat/completions`;
};

const buildModelsEndpoint = (baseUrl) => {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  if (base.endsWith("/models")) return base;
  return `${base}/models`;
};

const parseNumber = (val, fallback = undefined) => {
  if (val === "" || val == null) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

const cloneMessages = (list) => {
  try {
    return structuredClone(list);
  } catch {
    try {
      return JSON.parse(JSON.stringify(list));
    } catch {
      return Array.isArray(list) ? list.map((m) => ({ ...m })) : [];
    }
  }
};

const LOG_KEY = "api_logs";
const REQUEST_LOG_KEY = "api_request_logs";
const readLogs = () => {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const readRequestLogs = () => {
  try {
    const raw = localStorage.getItem(REQUEST_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const writeLogs = (logs) => {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  } catch {}
};

const writeRequestLogs = (logs) => {
  try {
    localStorage.setItem(REQUEST_LOG_KEY, JSON.stringify(logs));
  } catch {}
};

const updateRequestLog = (id, patch) => {
  try {
    const reqLogs = readRequestLogs();
    const next = reqLogs.map((log) =>
      log.id === id ? { ...log, ...patch } : log
    );
    writeRequestLogs(next);
    window.dispatchEvent(new Event("requestlogs:update"));
  } catch {}
};

const emitModelsUpdate = () => {
  window.dispatchEvent(new Event("models:update"));
};

const appendLog = (entry) => {
  const logs = readLogs();
  logs.unshift(entry);
  if (logs.length > 200) logs.length = 200;
  writeLogs(logs);
  if (entry.type === "request") {
    const reqLogs = readRequestLogs();
    reqLogs.unshift(entry);
    if (reqLogs.length > 3) reqLogs.length = 3;
    writeRequestLogs(reqLogs);
    window.dispatchEvent(new Event("requestlogs:update"));
  }
};

const SESSION_KEY = "chat_sessions";
const CURRENT_SESSION_KEY = "current_session_id";
const readSessions = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const cloneSessions = (list) =>
  (Array.isArray(list) ? list : []).map((s) => ({
    ...s,
    createdAt: s.createdAt || s.updatedAt || Date.now(),
    updatedAt: s.updatedAt || s.createdAt || Date.now(),
    messages: cloneMessages(s.messages || [])
  }));

const writeSessions = (sessions) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  } catch {}
  queueSupabaseSync(sessions);
};

const notifySessionsUpdate = () => {
  try {
    window.dispatchEvent(new CustomEvent("sessions:update"));
  } catch {}
};

const readCurrentSessionId = () => {
  try {
    return (
      sessionStorage.getItem(CURRENT_SESSION_KEY) ||
      localStorage.getItem(CURRENT_SESSION_KEY)
    );
  } catch {
    return null;
  }
};

const writeCurrentSessionId = (id) => {
  try {
    if (id) {
      sessionStorage.setItem(CURRENT_SESSION_KEY, id);
      localStorage.setItem(CURRENT_SESSION_KEY, id);
    } else {
      sessionStorage.removeItem(CURRENT_SESSION_KEY);
      localStorage.removeItem(CURRENT_SESSION_KEY);
    }
  } catch {}
};

const formatDateTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const normalizeMemoryList = (raw) => {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const normalized = raw
    .map((item) => {
      if (typeof item === "string") {
        const content = item.trim();
        if (!content) return null;
        return { id: null, content, updatedAt: now, createdAt: now };
      }
      if (item && typeof item === "object") {
        const idNum = Number(item.id);
        const id = Number.isFinite(idNum) ? idNum : null;
        const content = String(item.content ?? item.text ?? "").trim();
        if (!content) return null;
        const rawCreated = item.createdAt ?? item.created_at;
        const rawTime =
          item.updatedAt ??
          item.updated_at ??
          item.createdAt ??
          item.created_at;
        let createdAt =
          typeof rawCreated === "number" ? rawCreated : Date.parse(rawCreated);
        if (!Number.isFinite(createdAt)) createdAt = now;
        let updatedAt =
          typeof rawTime === "number" ? rawTime : Date.parse(rawTime);
        if (!Number.isFinite(updatedAt)) updatedAt = createdAt;
        return { id, content, updatedAt, createdAt };
      }
      return null;
    })
    .filter(Boolean);
  return normalized;
};

const normalizeApiProviders = (raw) => {
  const list = Array.isArray(raw) ? raw : [];
  const normalized = list
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || `provider_${idx + 1}`).trim();
      const name = String(item.name || `供应商 ${idx + 1}`).trim();
      const url = String(item.url || "").trim();
      const key = String(item.key || "").trim();
      const enabled = item.enabled !== false;
      if (!id || !url) return null;
      return { id, name: name || id, url, key, enabled };
    })
    .filter(Boolean);
  return normalized;
};

const readApiProvidersFromLocal = () => {
  let raw = [];
  try {
    raw = JSON.parse(readSetting("opt_api_providers", "[]"));
  } catch {}
  return normalizeApiProviders(raw);
};

const modelKeyOf = (item) => `${item.providerId}::${item.id}`;
const enabledProviderIdSetOf = (providers = []) =>
  new Set(
    (Array.isArray(providers) ? providers : [])
      .filter((p) => p && p.enabled !== false)
      .map((p) => p.id)
  );
const filterModelsByEnabledProviders = (models = [], providers = []) => {
  const enabledIds = enabledProviderIdSetOf(providers);
  return (Array.isArray(models) ? models : []).filter((m) =>
    enabledIds.has(m.providerId)
  );
};

const normalizeAddedModels = (raw, providers = []) => {
  const list = Array.isArray(raw) ? raw : [];
  const defaultProviderId = providers[0]?.id || "";
  const normalized = list
    .map((item) => {
      if (typeof item === "string") {
        const text = item.trim();
        if (!text) return null;
        if (text.includes("::")) {
          const [providerId, ...rest] = text.split("::");
          const id = rest.join("::").trim();
          if (!providerId || !id) return null;
          return { providerId, id };
        }
        if (!defaultProviderId) return null;
        return { providerId: defaultProviderId, id: text };
      }
      if (item && typeof item === "object") {
        const id = String(item.id || item.model || "").trim();
        const providerId = String(item.providerId || defaultProviderId).trim();
        if (!id || !providerId) return null;
        return { providerId, id };
      }
      return null;
    })
    .filter(Boolean);
  const dedup = new Map();
  normalized.forEach((m) => dedup.set(modelKeyOf(m), m));
  return [...dedup.values()];
};

const findAddedModelBySelection = (list, selected) => {
  if (!selected) return null;
  const exact = list.find((m) => modelKeyOf(m) === selected);
  if (exact) return exact;
  return list.find((m) => m.id === selected) || null;
};

const readMemoryListFromLocal = () => {
  try {
    return normalizeMemoryList(
      JSON.parse(readSetting(MEMORY_LIST_KEY, "[]"))
    );
  } catch {
    return [];
  }
};

const writeMemoryListToLocal = (list, emitEvent = true) => {
  const normalized = normalizeMemoryList(list);
  writeSetting(MEMORY_LIST_KEY, JSON.stringify(normalized));
  if (emitEvent) window.dispatchEvent(new Event("memory:update"));
  return normalized;
};

const mapMemoryRowToItem = (row) => {
  if (!row || typeof row !== "object") return null;
  return normalizeMemoryList([
    {
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  ])[0];
};

const fetchMemoriesFromSupabase = async () => {
  if (!supabase) return { list: [], error: "未配置 Supabase" };
  try {
    const { data, error } = await supabase
      .from("memories")
      .select("id,content,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) return { list: [], error: error.message || "读取失败" };
    const list = (data || []).map(mapMemoryRowToItem).filter(Boolean);
    return { list, error: null };
  } catch (err) {
    return { list: [], error: err?.message || String(err) };
  }
};

const loadMemoriesFromSupabase = async () => {
  if (!supabase) return readMemoryListFromLocal();
  try {
    const { list, error } = await fetchMemoriesFromSupabase();
    if (error) {
      console.warn("supabase load memories failed", error);
      return readMemoryListFromLocal();
    }
    if (list.length === 0) {
      const localList = readMemoryListFromLocal();
      if (localList.length > 0) {
        return upsertMemoriesToSupabase(localList);
      }
    }
    writeMemoryListToLocal(list, false);
    return list;
  } catch (err) {
    console.warn("supabase load memories exception", err);
    return readMemoryListFromLocal();
  }
};

const upsertMemoriesToSupabase = async (inputList) => {
  const list = normalizeMemoryList(inputList);
  if (!supabase) return writeMemoryListToLocal(list);
  try {
    const { data: existingRows, error: existingError } = await supabase
      .from("memories")
      .select("id");
    if (existingError) {
      console.warn("supabase load existing memories failed", existingError);
      return writeMemoryListToLocal(list);
    }

    const withId = list.filter((m) => Number.isFinite(Number(m.id)));
    const noId = list.filter((m) => !Number.isFinite(Number(m.id)));

    if (withId.length > 0) {
      const payload = withId.map((m) => ({
        id: Number(m.id),
        content: m.content,
        updated_at: new Date(m.updatedAt || Date.now()).toISOString()
      }));
      const { error: upsertError } = await supabase
        .from("memories")
        .upsert(payload, { onConflict: "id" });
      if (upsertError) {
        console.warn("supabase upsert memories failed", upsertError);
      }
    }

    if (noId.length > 0) {
      const payload = noId.map((m) => {
        const createdAt = m.createdAt || m.updatedAt || Date.now();
        return {
          content: m.content,
          created_at: new Date(createdAt).toISOString(),
          updated_at: new Date(m.updatedAt || createdAt).toISOString()
        };
      });
      const { error: insertError } = await supabase.from("memories").insert(payload);
      if (insertError) {
        console.warn("supabase insert memories failed", insertError);
      }
    }

    const existingIds = new Set(
      (existingRows || [])
        .map((r) => Number(r.id))
        .filter((id) => Number.isFinite(id))
    );
    const nextIds = new Set(
      withId.map((m) => Number(m.id)).filter((id) => Number.isFinite(id))
    );
    const deleteIds = [...existingIds].filter((id) => !nextIds.has(id));
    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("memories")
        .delete()
        .in("id", deleteIds);
      if (deleteError) {
        console.warn("supabase delete removed memories failed", deleteError);
      }
    }

    const fresh = await loadMemoriesFromSupabase();
    return writeMemoryListToLocal(fresh);
  } catch (err) {
    console.warn("supabase sync memories exception", err);
    return writeMemoryListToLocal(list);
  }
};

const getLastMessageTime = (list) => {
  if (!Array.isArray(list) || list.length === 0) return Date.now();
  const last = list[list.length - 1];
  if (Array.isArray(last?.variants) && last.variants.length) {
    const idx =
      typeof last.variantIndex === "number"
        ? last.variantIndex
        : last.variants.length - 1;
    return last.variants[idx]?.createdAt || last.createdAt || Date.now();
  }
  return last?.createdAt || Date.now();
};

const ensureMessageId = (msg) => {
  if (!msg) return msg;
  if (msg._id) return msg;
  const id =
    (typeof crypto !== "undefined" && crypto?.randomUUID?.()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { ...msg, _id: id };
};

const buildMessage = ({
  role,
  text,
  tokens,
  avatar,
  createdAt,
  model,
  variants,
  isPending
}) => ({
  type: "text",
  content: { text: sanitizeText(text) },
  position: role === "user" ? "right" : "left",
  user: {
    avatar: avatar || (role === "user" ? AVATAR_USER : AVATAR_ASSISTANT)
  },
  createdAt: createdAt ?? Date.now(),
  hasTime: false,
  tokens,
  model: role === "assistant" ? model || "" : undefined,
  variants,
  isPending: !!isPending
});

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash || "#/");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route.replace(/^#/, "") || "/";
}

function ChatPage() {
  const assistantAvatarSetting = readSetting("opt_assistant_avatar");
  const assistantAvatar = assistantAvatarSetting || AVATAR_ASSISTANT;
  const userAvatarSetting = readSetting("opt_user_avatar");
  const userAvatar = userAvatarSetting || AVATAR_USER;
  const [assistantName, setAssistantName] = useState(
    () => readSetting("opt_assistant_name") || "Kelivo Chat"
  );
  const [chatModels, setChatModels] = useState(() => {
    const providers = readApiProvidersFromLocal();
    try {
      return filterModelsByEnabledProviders(
        normalizeAddedModels(
          JSON.parse(readSetting("opt_added_models", "[]")),
          providers
        ),
        providers
      );
    } catch {
      return [];
    }
  });
  const [chatModelId, setChatModelId] = useState(() => readSetting("api_model"));
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const groupedChatModels = useMemo(() => {
    const providers = readApiProvidersFromLocal();
    const providerNameMap = new Map(
      (Array.isArray(providers) ? providers : []).map((p) => [
        String(p.id || ""),
        String(p.name || p.id || "未命名供应商")
      ])
    );
    const groups = new Map();
    for (const m of Array.isArray(chatModels) ? chatModels : []) {
      const pid = String(m.providerId || "");
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push(m);
    }
    return Array.from(groups.entries()).map(([providerId, models]) => ({
      providerId,
      providerName: providerNameMap.get(providerId) || providerId || "未命名供应商",
      models
    }));
  }, [chatModels]);
  const [messages, setMessages] = useState(() => []);
  const appendMsg = (msg) =>
    setMessages((prev) => [...prev, ensureMessageId(msg)]);
  const updateMsg = (id, patch) =>
    setMessages((prev) =>
      prev.map((m) => (m._id === id ? { ...m, ...patch } : m))
    );
  const resetList = (next) =>
    setMessages((Array.isArray(next) ? next : []).map(ensureMessageId));
  const safeSetTyping = () => {};
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const normalizeMessageVariants = (msg) => {
    if (!msg) return msg;
    if (Array.isArray(msg.variants) && msg.variants.length) return msg;
    const text = msg?.content?.text ?? "";
    const base = { text, createdAt: msg.createdAt };
    if (msg.position === "left") {
      base.tokens = msg.tokens;
    }
    return {
      ...msg,
      variants: [base],
      variantIndex: 0
    };
  };

  const getMessageTextForHistory = (m) => {
    const normalized = normalizeMessageVariants(m);
    const variants = normalized?.variants || [];
    if (!variants.length) return normalized?.content?.text ?? "";
    const idx =
      typeof normalized.variantIndex === "number"
        ? normalized.variantIndex
        : variants.length - 1;
    return variants[idx]?.text ?? normalized?.content?.text ?? "";
  };

  const buildHistoryList = (list) =>
    list
      .map((m) => {
        const raw = getMessageTextForHistory(m);
        const extracted = extractThinkAndTools(raw);
        const cleaned = extracted.cleanText;
        const toolTags =
          m.position === "right"
            ? ""
            : extracted.tools
                .map((t) => {
                  const name = t.name || "";
                  const content = t.content || "";
                  if (t.type === "call") {
                    return `<tool_call name="${name}">${content}</tool_call>`;
                  }
                  if (t.type === "result") {
                    return `<tool_result name="${name}">${content}</tool_result>`;
                  }
                  return "";
                })
                .filter(Boolean)
                .join("\n");
        const combined = [cleaned, toolTags].filter(Boolean).join("\n");
        return {
          role: m.position === "right" ? "user" : "assistant",
          content: sanitizeText(combined)
        };
      })
      .filter((m) => m.content);

  const storeTailOnVariant = (list, targetIdx) => {
    const target = list[targetIdx];
    const normalized = normalizeMessageVariants(target);
    const variants = normalized.variants || [];
    const idx =
      typeof normalized.variantIndex === "number"
        ? normalized.variantIndex
        : variants.length - 1;
    const tail = list.slice(targetIdx + 1);
    const nextVariants = variants.map((v, i) =>
      i === idx ? { ...v, thread: tail } : v
    );
    return {
      ...normalized,
      variants: nextVariants
    };
  };

  const applyAssistantUpdate = ({
    id,
    text,
    tokens,
    isPending,
    appendVariant,
    createdAt
  }) => {
    const baseMsg = messagesRef.current.find((m) => m._id === id);
    if (!baseMsg) {
      updateMsg(id, {
        content: { text },
        tokens,
        isPending: !!isPending
      });
      return;
    }
    if (!appendVariant || isPending) {
      updateMsg(id, {
        ...baseMsg,
        content: { text },
        tokens,
        isPending: !!isPending
      });
      return;
    }
    const normalized = normalizeMessageVariants(baseMsg);
    const variants = normalized.variants || [];
    const nextVariant = {
      text,
      createdAt: createdAt ?? Date.now(),
      tokens
    };
    const last = variants[variants.length - 1];
    const shouldReplaceLast =
      normalized.isPending && typeof last?.text === "string" && last.text === "";
    const nextVariants = shouldReplaceLast
      ? [...variants.slice(0, -1), nextVariant]
      : [...variants, nextVariant];
    updateMsg(id, {
      ...normalized,
      variants: nextVariants,
      variantIndex: nextVariants.length - 1,
      content: { text },
      tokens,
      createdAt: nextVariant.createdAt,
      isPending: false
    });
  };

  const switchVariant = (msgId, nextIndex) => {
    const list = messages;
    const targetIdx = list.findIndex((m) => m._id === msgId);
    if (targetIdx < 0) return;
    const updatedTarget = storeTailOnVariant(list, targetIdx);
    const variants = updatedTarget.variants || [];
    const nextVariant = variants[nextIndex];
    const thread = Array.isArray(nextVariant?.thread) ? nextVariant.thread : [];
    const nextTarget = {
      ...updatedTarget,
      variantIndex: nextIndex,
      content: {
        text: nextVariant?.text ?? updatedTarget?.content?.text ?? ""
      },
      createdAt: nextVariant?.createdAt ?? updatedTarget.createdAt,
      tokens:
        updatedTarget.position === "left"
          ? typeof nextVariant?.tokens === "number"
            ? nextVariant.tokens
            : updatedTarget.tokens
          : undefined
    };
    suppressAutoScrollRef.current = true;
    resetList([...list.slice(0, targetIdx), nextTarget, ...thread]);
  };

  const displayMessages = useMemo(
    () =>
      messages.map((m) => {
        const normalized = normalizeMessageVariants(m);
        const variants = normalized.variants;
        const activeIdx =
          typeof normalized.variantIndex === "number"
            ? normalized.variantIndex
            : variants?.length
            ? variants.length - 1
            : 0;
        const activeVariant = variants?.[activeIdx];
        return {
          ...normalized,
          content: {
            text: activeVariant?.text ?? normalized?.content?.text ?? ""
          },
          createdAt: activeVariant?.createdAt ?? normalized.createdAt,
          tokens:
            typeof activeVariant?.tokens === "number"
              ? activeVariant.tokens
              : normalized.tokens,
          user: {
            ...(normalized.user || {}),
            avatar:
              normalized.position === "right" ? userAvatar : assistantAvatar
          }
        };
      }),
    [messages, userAvatar, assistantAvatar]
  );

  const inputRef = useRef(null);
  const [inputValue, setInputValue] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [actionOpenId, setActionOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const copyTimerRef = useRef(null);
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const [chatReady, setChatReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showBackBottom, setShowBackBottom] = useState(false);
  const abortRef = useRef(null);
  const [thinkOpen, setThinkOpen] = useState({});
  const [toolOpen, setToolOpen] = useState({});
  const suppressSaveRef = useRef(false);
  const atBottomRef = useRef(true);
  const suppressAutoScrollRef = useRef(false);
  const isAutoDraftSession = (session) =>
    !!session &&
    (session.title || "新对话") === "新对话" &&
    (!Array.isArray(session.messages) || session.messages.length === 0);
  const [sessions, setSessions] = useState(() => {
    const existing = readSessions();
    const cleaned = existing.filter((s) => !isAutoDraftSession(s));
    if (cleaned.length !== existing.length) {
      writeSessions(cleaned);
    }
    return cleaned;
  });
  const [currentSessionId, setCurrentSessionId] = useState(
    () => readCurrentSessionId() || readSessions()[0]?.id || null
  );
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const removeEmptySession = (sessionId) => {
    if (!sessionId) return;
    const current = readSessions();
    const target = current.find((s) => s.id === sessionId);
    if (!isAutoDraftSession(target)) return;
    const next = current.filter((s) => s.id !== sessionId);
    setSessions(next);
    writeSessions(next);
    notifySessionsUpdate();
    const fallbackId = next[0]?.id || null;
    if (currentSessionId === sessionId) {
      setCurrentSessionId(fallbackId);
      writeCurrentSessionId(fallbackId || "");
      if (!fallbackId) {
        suppressSaveRef.current = true;
        resetList([]);
        setTimeout(() => {
          suppressSaveRef.current = false;
        }, 0);
      }
    }
    deleteSessionFromSupabase(sessionId);
  };

  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    let cancelled = false;
    (async () => {
      const remote = await fetchSessionsFromSupabase();
      if (cancelled) return;
      if (remote.length) {
        writeSessions(remote);
        setSessions(remote);
        const nextId = readCurrentSessionId() || remote[0]?.id || null;
        if (nextId) {
          setCurrentSessionId(nextId);
          writeCurrentSessionId(nextId);
        }
        return;
      }
      const local = readSessions();
      if (local.length) {
        queueSupabaseSync(local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (!window.location.hash.startsWith("#/chat")) return;
    setChatReady(false);

    const findList = () =>
      document.querySelector(".ChatPage .MessageList") ||
      document.querySelector(".MessageList");

    const forceScroll = (list) => {
      const prev = list.style.scrollBehavior;
      list.style.scrollBehavior = "auto";
      list.scrollTop = list.scrollHeight;
      list.style.scrollBehavior = prev;
    };

    const run = () => {
      const list = findList();
      if (!list) return false;
      const start = performance.now();
      const tick = () => {
        forceScroll(list);
        if (performance.now() - start < 350) {
          requestAnimationFrame(tick);
        } else {
          setChatReady(true);
        }
      };
      tick();
      return true;
    };

    if (run()) return;

    const observer = new MutationObserver(() => {
      if (run()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  const triggerAutoScroll = (force = false) => {
    const run = () => {
      if (!window.location.hash.startsWith("#/chat")) return;
      const container = document.querySelector(".ChatPage .MessageContainer");
      if (!container) return;
      if (!force && !atBottomRef.current) return;
      const prev = container.style.scrollBehavior;
      container.style.scrollBehavior = "auto";
      container.scrollTop = container.scrollHeight;
      container.style.scrollBehavior = prev;
    };
    run();
    setTimeout(run, 0);
    setTimeout(run, 60);
    setTimeout(run, 180);
  };

  const scrollToTop = () => {
    const container = document.querySelector(".ChatPage .MessageContainer");
    if (!container) return;
    const prev = container.style.scrollBehavior;
    container.style.scrollBehavior = "auto";
    container.scrollTop = 0;
    container.style.scrollBehavior = prev;
  };

  useEffect(() => {
    const list = document.querySelector(".ChatPage .MessageContainer");
    if (!list || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (!window.location.hash.startsWith("#/chat")) return;
      if (suppressAutoScrollRef.current) {
        suppressAutoScrollRef.current = false;
        return;
      }
      triggerAutoScroll();
    });
    observer.observe(list, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!window.location.hash.startsWith("#/chat")) return;
    const container = document.querySelector(".ChatPage .MessageContainer");
    if (!container) return;
    const onScroll = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distance < 8;
      atBottomRef.current = atBottom;
      const showThreshold = container.clientHeight;
      setShowBackBottom(distance > showThreshold);
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [chatReady, messages]);

  useEffect(() => {
    const onHashChange = () => {
      if (!window.location.hash.startsWith("#/chat")) return;
      const storedId = readCurrentSessionId();
      const storedSessions = readSessions();
      if (storedSessions.length) {
        setSessions(storedSessions);
      }
      const fallbackId = storedSessions[0]?.id || null;
      const nextId = storedId || fallbackId;
      const targetSession = nextId
        ? storedSessions.find((s) => s.id === nextId) || null
        : null;
      if (targetSession) {
        suppressSaveRef.current = true;
        resetList(cloneMessages(targetSession.messages || []));
        setTimeout(() => {
          suppressSaveRef.current = false;
        }, 0);
      }
      if (nextId && nextId !== currentSessionId) {
        setCurrentSessionId(nextId);
        writeCurrentSessionId(nextId);
      }
      setAssistantName(readSetting("opt_assistant_name") || "Kelivo Chat");
      setChatReady(false);
      triggerAutoScroll(true);
      setTimeout(() => {
        setChatReady(true);
      }, 800);
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onLeaveChat = () => {
      if (window.location.hash.startsWith("#/chat")) return;
      removeEmptySession(currentSessionId);
    };
    window.addEventListener("hashchange", onLeaveChat);
    return () => window.removeEventListener("hashchange", onLeaveChat);
  }, [currentSessionId]);

  useEffect(() => {
    if (!window.location.hash.startsWith("#/chat")) return;
    triggerAutoScroll();
  }, [messages]);

  const showToast = (text) => {
    setToast(text);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(""), 1200);
  };

  const handleStopGenerate = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    safeSetTyping(false);
    setIsGenerating(false);
    showToast("已停止生成");
  };

  useEffect(() => {
    setChatModelId(readSetting("api_model"));
    const providers = readApiProvidersFromLocal();
    try {
      setChatModels(
        filterModelsByEnabledProviders(
          normalizeAddedModels(
            JSON.parse(readSetting("opt_added_models", "[]")),
            providers
          ),
          providers
        )
      );
    } catch {
      setChatModels([]);
    }
  }, []);

  useEffect(() => {
    const onModelsUpdate = () => {
      setChatModelId(readSetting("api_model"));
      const providers = readApiProvidersFromLocal();
      try {
        setChatModels(
          filterModelsByEnabledProviders(
            normalizeAddedModels(
              JSON.parse(readSetting("opt_added_models", "[]")),
              providers
            ),
            providers
          )
        );
      } catch {
        setChatModels([]);
      }
    };
    window.addEventListener("models:update", onModelsUpdate);
    return () => window.removeEventListener("models:update", onModelsUpdate);
  }, []);

  useEffect(() => {
    const onClick = (event) => {
      if (!modelMenuOpen) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".model-picker-dropdown")) {
        return;
      }
      setModelMenuOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!actionOpenId) return;
    const handleClick = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".action-pop")) {
        return;
      }
      setActionOpenId(null);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [actionOpenId]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!currentSessionId) {
      suppressSaveRef.current = true;
      resetList([]);
      writeCurrentSessionId("");
      setTimeout(() => {
        suppressSaveRef.current = false;
      }, 0);
      return;
    }
    const storedSessions = readSessions();
    const safeSessions = cloneSessions(storedSessions);
    if (safeSessions.length) {
      setSessions(safeSessions);
    }
    const session =
      safeSessions.find((s) => s.id === currentSessionId) ||
      sessions.find((s) => s.id === currentSessionId);
    if (session?.messages) {
      suppressSaveRef.current = true;
      resetList(cloneMessages(session.messages));
      triggerAutoScroll(true);
      setTimeout(() => {
        suppressSaveRef.current = false;
      }, 0);
    }
    writeCurrentSessionId(currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    if (currentSessionId) return;
    const fallbackId = sessions[0]?.id || null;
    if (!fallbackId) return;
    setCurrentSessionId(fallbackId);
    writeCurrentSessionId(fallbackId);
  }, [currentSessionId, sessions]);

  useEffect(() => {
    if (!currentSessionId) return;
    if (suppressSaveRef.current) return;
    const firstUser = messages.find(
      (m) => m.position === "right" && m?.content?.text
    );
    const baseSessions = sessionsRef.current || [];
    const targetIndex = baseSessions.findIndex((s) => s.id === currentSessionId);
    if (targetIndex < 0) return;
    const next = baseSessions.map((s) => {
      if (s.id !== currentSessionId) return s;
      const title =
        s.title === "新对话" && firstUser
          ? sanitizeText(firstUser.content.text).slice(0, 20)
          : s.title;
      return {
        ...s,
        title,
        createdAt: s.createdAt || s.updatedAt || Date.now(),
        messages: cloneMessages(messages),
        updatedAt: getLastMessageTime(messages)
      };
    });
    setSessions(next);
    writeSessions(next);
    notifySessionsUpdate();
  }, [messages, currentSessionId]);

  const createEmptySession = () => ({
    id: crypto?.randomUUID?.() || String(Date.now()),
    title: "新对话",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const activateSession = (session) => {
    if (!session) return;
    const updated = [session, ...(sessionsRef.current || [])];
    setSessions(updated);
    writeSessions(updated);
    notifySessionsUpdate();
    suppressSaveRef.current = true;
    setCurrentSessionId(session.id);
    writeCurrentSessionId(session.id);
    resetList([]);
    setTimeout(() => {
      suppressSaveRef.current = false;
    }, 0);
  };

  const ensureCurrentSessionId = () => {
    if (currentSessionId) return currentSessionId;
    const next = createEmptySession();
    activateSession(next);
    return next.id;
  };

  const handleNewSession = () => {
    const next = {
      ...createEmptySession()
    };
    activateSession(next);
  };

  const handleAction = (msg, action) => {
    const text = msg?.content?.text ?? "";
    if (action === "copy") {
      setActionOpenId(null);
      const id = msg?._id || null;
      if (id && copiedId !== id) {
        setCopiedId(id);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          setCopiedId(null);
        }, 1200);
      }
      navigator.clipboard?.writeText(text).catch(() => {});
      return;
    }
    if (action === "delete") {
      setActionOpenId(null);
      setDeleteTargetId(msg._id);
      return;
    }
    if (action === "edit") {
      setActionOpenId(null);
      setEditingId(msg._id);
      setEditingText(text);
      setEditSheetOpen(true);
      return;
    }
    if (action === "refresh") {
      setActionOpenId(null);
      if (msg?.position === "right") return;
      const idx = messages.findIndex((m) => m._id === msg._id);
      if (idx < 0) return;
      const updatedTarget = storeTailOnVariant(messages, idx);
      const pendingVariant = {
        text: "",
        createdAt: Date.now(),
        tokens: updatedTarget.tokens
      };
      const nextVariants = [...(updatedTarget.variants || []), pendingVariant];
      const truncated = [
        ...messages.slice(0, idx),
        {
          ...updatedTarget,
          variants: nextVariants,
          variantIndex: nextVariants.length - 1,
          content: { text: "" },
          isPending: true,
          createdAt: pendingVariant.createdAt
        }
      ];
      resetList(truncated);
      let lastUserIndex = -1;
      for (let i = idx; i >= 0; i -= 1) {
        if (messages[i]?.position === "right" && messages[i]?.content?.text) {
          lastUserIndex = i;
          break;
        }
      }
      if (lastUserIndex < 0) return;
      const historyList = buildHistoryList(
        messages.slice(0, lastUserIndex + 1)
      );
      sendChatRequest({
        historyList,
        targetMsgId: msg._id,
        appendVariant: true
      });
    }
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 160;
    const cssBase = parseFloat(
      getComputedStyle(el).getPropertyValue("--composer-height")
    );
    const base = Number.isFinite(cssBase) ? cssBase : 42;
    if (!inputValue.trim()) {
      el.style.height = `${base}px`;
      return;
    }
    const nextHeight = Math.min(Math.max(el.scrollHeight, base), max);
    el.style.height = `${nextHeight}px`;
  }, [inputValue]);

  const sendChatRequest = async ({ historyList, targetMsgId, appendVariant }) => {
    let apiUrl = "";
    let apiKey = "";
    let modelId = "";
    let temperature;
    let topP;
    let maxTokens;
    let ctxLimit;
    let useStream = false;
    let systemPrompt = "";
    let template = "";
    let memoryEnabled = false;
    let memoryList = [];
    let searchEnabled = false;
    let mcpEnabled = false;
    let mcpUrl = "";
    let mcpApiKey = "";
    let webSearchUrl = "";
    let webSearchApiKey = "";
    let pendingId = targetMsgId || null;
    let pendingCreatedAt = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    let timeoutId = null;
    let timedOut = false;
    const timeoutMs = 60000;
    setIsGenerating(true);
    try {
      safeSetTyping(true);
      const providers = readApiProvidersFromLocal();
      apiUrl = readSetting("api_url");
      apiKey = readSetting("api_key");
      modelId = readSetting("api_model");
      let modelRequestId = modelId;
      try {
        const addedModels = normalizeAddedModels(
          JSON.parse(readSetting("opt_added_models", "[]")),
          providers
        );
        const selectedModel = findAddedModelBySelection(addedModels, modelId);
        if (selectedModel) {
          modelRequestId = selectedModel.id;
          const provider = providers.find((p) => p.id === selectedModel.providerId);
          if (provider) {
            apiUrl = provider.url || apiUrl;
            apiKey = provider.key || apiKey;
          }
        } else if (typeof modelId === "string" && modelId.includes("::")) {
          const fallbackModel = modelId.split("::").slice(1).join("::").trim();
          if (fallbackModel) modelRequestId = fallbackModel;
        }
      } catch {}
      temperature = parseNumber(readSetting("opt_temperature"), undefined);
      topP = parseNumber(readSetting("opt_top_p"), undefined);
      maxTokens = parseNumber(readSetting("opt_max_tokens"), undefined);
      ctxLimit = parseNumber(readSetting("opt_context_limit"), undefined);
      useStream = readSetting("opt_stream") === "true";
      systemPrompt = readSetting("opt_system_prompt");
      template = readSetting("opt_message_template");
      memoryEnabled = readSetting("opt_memory_enabled") === "true";
      memoryList = await loadMemoriesFromSupabase();
      searchEnabled = readSetting("opt_search_enabled") === "true";
      mcpEnabled = readSetting("opt_mcp_enabled") === "true";
      mcpUrl = readSetting("mcp_url");
      mcpApiKey = readSetting("mcp_api_key");
      webSearchUrl = readSetting("web_search_url");
      webSearchApiKey = readSetting("web_search_api_key");

      if (!modelRequestId) {
        showToast("请选择聊天模型");
        return;
      }

      const endpoint = buildChatEndpoint(apiUrl);
      if (!endpoint) {
        showToast("请先填写 API URL");
        return;
      }

      const context = Array.isArray(historyList) ? historyList : [];
      const trimmed = ctxLimit ? context.slice(-ctxLimit) : context;

      const messagesPayload = [];
      const systemBlocks = [];
      const toolInstruction = "";
      const searchPrompt = `## search_web 工具使用说明

当用户询问需要实时信息或最新数据的问题时，使用 search_web 工具进行搜索。

### 引用格式
- 搜索结果中会包含index(搜索结果序号)和id(搜索结果唯一标识符)，引用格式为：
  \`具体的引用内容 [citation](index:id)\`
- **引用必须紧跟在相关内容之后**，在标点符号后面，不得延后到回复结尾
- 正确格式：\`... [citation](index:id)\` \`... [citation](index:id) [citation](index:id)\`

### 使用规范
1. **使用时机**
   - 用户询问最新新闻、事件、数据
   - 需要查证事实信息
   - 需要获取技术文档、API信息等
   
2. **引用要求**
   - 使用搜索结果时必须标注引用来源
   - 每个引用的事实都要紧跟 [citation](index:id) 标记
   - 不要将所有引用集中在回答末尾

3. **回答格式示例**
   ✅ 正确：
   - 据最新报道，该事件发生在昨天下午。[citation](1:a1b2c3)
   - 技术文档显示该功能需要版本3.0以上。[citation](2:d4e5f6) 具体配置步骤如下...[citation](3:g7h8i9)
   
   ❌ 错误：
   - 据最新报道，该事件发生在昨天下午。技术文档显示该功能需要版本3.0以上。
     [citation](1:a1b2c3) [citation](2:d4e5f6)`;
      const nowText = new Date().toLocaleString();
      const replaceDatetimeVars = (text) =>
        text
          .replaceAll("{current_datetime}", nowText)
          .replaceAll("{cur_datetime}", nowText);
      if (systemPrompt) {
        systemBlocks.push(replaceDatetimeVars(systemPrompt));
      }
      if (memoryEnabled && memoryList.length) {
        const memBlock = [
          "## Memories",
          "These are memories that you can reference in the future conversations.",
          "<memories>",
          ...memoryList.map(
            (m, idx) =>
              [
                "<record>",
                `<id>${m.id ?? idx + 1}</id>`,
                `<content>${m.content}</content>`,
                "</record>"
              ].join("\n")
          ),
          "</memories>",
          "## Memory Tool",
          "你是一个无状态的大模型，你无法存储记忆，因此为了记住信息，你需要使用**记忆工具**。",
          "你可以使用 `create_memory`, `edit_memory`, `delete_memory` 工具创建、更新或删除记忆。",
          "- 如果记忆中没有相关信息，请使用 create_memory 创建一条新的记录。",
          "- 如果已有相关记录，请使用 edit_memory 更新内容。",
          "- 若记忆过时或无用，请使用 delete_memory 删除",
          "这些记忆会自动包含在未来的对话上下文中，在<memories>标签内。",
          "在与用户聊天过程中，你可以**主动**记录用户相关的信息到记忆里，包括但不限于：",
          "- 用户的兴趣爱好",
          "- 计划事项",
          "- 聊天风格偏好",
          "- 工作相关事项等",
          "请主动调用工具记录，而不是需要用户要求。",
          `记忆如果包含日期信息，请包含在内，请使用绝对时间格式，并且当前时间是 ${new Date().toLocaleString()}。`,
          "无需告知用户你已更改记忆记录，也不要在对话中直接显示记忆内容，除非用户主动要求。",
          "相似或相关的记忆应合并为一条记录，而不要重复记录，过时记录应删除。"
        ].join("\n");
        systemBlocks.push(memBlock);
      }
      if (template) {
        systemBlocks.push(`聊天内容模板：\n${replaceDatetimeVars(template)}`);
      }
      if (toolInstruction) systemBlocks.push(toolInstruction);
      if (searchEnabled) systemBlocks.push(searchPrompt);

      const tools = [
        {
          type: "function",
          function: {
            name: "create_memory",
            description: "create a memory record",
            parameters: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  description: "The content of the memory record"
                }
              },
              required: ["content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "edit_memory",
            description: "update a memory record",
            parameters: {
              type: "object",
              properties: {
                id: {
                  type: "integer",
                  description: "The id of the memory record"
                },
                content: {
                  type: "string",
                  description: "The content of the memory record"
                }
              },
              required: ["id", "content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "delete_memory",
            description: "delete a memory record",
            parameters: {
              type: "object",
              properties: {
                id: {
                  type: "integer",
                  description: "The id of the memory record"
                }
              },
              required: ["id"]
            }
          }
        },
        ...(mcpEnabled
          ? [
              {
                type: "function",
                function: {
                  name: "mcp_call",
                  description: "调用 MCP 工具",
                  parameters: {
                    type: "object",
                    properties: {
                      server: { type: "string", description: "MCP 服务器名称" },
                      tool: { type: "string", description: "工具名称" },
                      arguments: { type: "object", description: "工具参数" }
                    },
                    required: ["server", "tool", "arguments"]
                  }
                }
              }
            ]
          : []),
        ...(searchEnabled
          ? [
              {
                type: "function",
                function: {
                  name: "search_web",
                  description: "Search the web for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: {
                        type: "string",
                        description: "The search query to look up online"
                      }
                    },
                    required: ["query"]
                  }
                }
              }
            ]
          : [])
      ];

      if (systemBlocks.length > 0) {
        messagesPayload.push({
          role: "system",
          content: systemBlocks.join("\n\n")
        });
      }
      trimmed.forEach((m) => messagesPayload.push(m));

      const safeParseJson = (value, fallback = {}) => {
        if (!value || typeof value !== "string") return fallback;
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      };

      const readMemoryList = async () => loadMemoriesFromSupabase();
      const writeMemoryList = async (list) => upsertMemoriesToSupabase(list);

      const runToolCall = async (toolCall) => {
        const name = toolCall?.function?.name || toolCall?.name || "";
        const argsText = toolCall?.function?.arguments || toolCall?.arguments || "{}";
        const args = safeParseJson(argsText, {});
        const result = { ok: false };
        const buildUrl = (base, params = {}) => {
          if (!base) return "";
          let next = base;
          Object.entries(params).forEach(([key, value]) => {
            next = next.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
          });
          return next;
        };
        const fetchTool = async (baseUrl, payload, apiKeyValue, options = {}) => {
          if (!baseUrl) {
            return {
              ok: false,
              error: "未配置工具地址"
            };
          }
          const method = options.method || "POST";
          const url = options.url || baseUrl;
          const headers = {
            "Content-Type": "application/json",
            ...(apiKeyValue ? { Authorization: `Bearer ${apiKeyValue}` } : {})
          };
          const res = await fetch(url, {
            method,
            headers,
            body: method === "GET" ? undefined : JSON.stringify(payload)
          });
          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          return {
            ok: res.ok,
            status: res.status,
            data
          };
        };

        if (name === "create_memory") {
          const content = String(args?.content || "").trim();
          if (!content) {
            return {
              tool_call_id: toolCall?.id,
              name,
              content: JSON.stringify(
                { ok: false, error: "content 不能为空" },
                null,
                2
              )
            };
          }
          const list = await readMemoryList();
          const next = [{ id: null, content, updatedAt: Date.now() }, ...list];
          const saved = await writeMemoryList(next);
          const created = saved.find((m) => m.content === content) || saved[0];
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(
              { ok: true, id: created?.id ?? null, content },
              null,
              2
            )
          };
        }

        if (name === "edit_memory") {
          const idRaw = args?.id;
          const content = String(args?.content || "").trim();
          const list = await readMemoryList();
          const targetId = Number(idRaw);
          const idx = list.findIndex((m) => Number(m.id) === targetId);
          if (!content) {
            return {
              tool_call_id: toolCall?.id,
              name,
              content: JSON.stringify(
                { ok: false, error: "content 不能为空" },
                null,
                2
              )
            };
          }
          if (idx < 0) {
            return {
              tool_call_id: toolCall?.id,
              name,
              content: JSON.stringify(
                { ok: false, error: "需要有效的 id" },
                null,
                2
              )
            };
          }
          const before = list[idx]?.content || "";
          list[idx] = { ...list[idx], content, updatedAt: Date.now() };
          const saved = await writeMemoryList(list);
          const savedRow = saved.find((m) => Number(m.id) === targetId) || list[idx];
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(
              { ok: true, id: savedRow?.id ?? targetId, before, after: content },
              null,
              2
            )
          };
        }

        if (name === "delete_memory") {
          const idRaw = args?.id;
          const list = await readMemoryList();
          let removed = null;
          const targetId = Number(idRaw);
          const idx = list.findIndex((m) => Number(m.id) === targetId);
          if (idx >= 0) {
            removed = { id: list[idx].id, content: list[idx].content };
            list.splice(idx, 1);
            await writeMemoryList(list);
            return {
              tool_call_id: toolCall?.id,
              name,
              content: JSON.stringify({ ok: true, removed }, null, 2)
            };
          }
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(
              { ok: false, error: "未找到可删除的记忆" },
              null,
              2
            )
          };
        }

        if (name === "mcp_call") {
          const server = String(args?.server || "").trim();
          const tool = String(args?.tool || "").trim();
          const argumentsPayload = args?.arguments || {};
          const finalUrl = buildUrl(mcpUrl, { server, tool });
          const resp = await fetchTool(
            finalUrl || mcpUrl,
            { server, tool, arguments: argumentsPayload },
            mcpApiKey,
            { method: "POST", url: finalUrl || mcpUrl }
          );
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(resp, null, 2)
          };
        }

        if (name === "search_web") {
          const query = String(args?.query || "").trim();
          const urlWithQuery = webSearchUrl.includes("{query}")
            ? buildUrl(webSearchUrl, { query })
            : webSearchUrl;
          const method = webSearchUrl.includes("{query}") ? "GET" : "POST";
          const resp = await fetchTool(
            urlWithQuery,
            { query },
            webSearchApiKey,
            { method, url: urlWithQuery }
          );
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(resp, null, 2)
          };
        }

        return {
          tool_call_id: toolCall?.id,
          name,
          content: JSON.stringify(
            { ...result, error: "未知工具" },
            null,
            2
          )
        };
      };

      const normalizeToolCalls = (toolCalls) =>
        toolCalls.map((call) => ({
          id: call.id || crypto?.randomUUID?.() || String(Date.now()),
          type: "function",
          function: {
            name: call?.function?.name || call?.name || "",
            arguments: call?.function?.arguments || call?.arguments || "{}"
          }
        }));

      const buildToolTags = (calls, results) => {
        const callTags = calls
          .map(
            (c) =>
              `<tool_call name="${c.function?.name || c.name || ""}">${c
                .function?.arguments || c.arguments || ""}</tool_call>`
          )
          .join("\n");
        const resultTags = results
          .map(
            (r) =>
              `<tool_result name="${r.name || ""}">${r.content || ""}</tool_result>`
          )
          .join("\n");
        return [callTags, resultTags].filter(Boolean).join("\n");
      };

      const handleToolCalls = async (toolCalls, baseMessages) => {
        const normalizedCalls = normalizeToolCalls(toolCalls);
        const toolResults = [];
        for (const call of normalizedCalls) {
          // eslint-disable-next-line no-await-in-loop
          toolResults.push(await runToolCall(call));
        }
        const assistantToolMessage = {
          role: "assistant",
          content: "",
          tool_calls: normalizedCalls
        };
        const toolMessages = toolResults.map((r) => ({
          role: "tool",
          tool_call_id: r.tool_call_id,
          content: r.content
        }));
        return {
          nextMessages: [...baseMessages, assistantToolMessage, ...toolMessages],
          toolTags: buildToolTags(normalizedCalls, toolResults)
        };
      };

      const body = {
        model: modelRequestId,
        messages: messagesPayload,
        tools,
        tool_choice: "auto",
        stream: useStream
      };
      if (useStream) {
        body.stream_options = { include_usage: true };
      }
      if (typeof temperature === "number") body.temperature = temperature;
      if (typeof topP === "number") body.top_p = topP;
      if (typeof maxTokens === "number") body.max_tokens = maxTokens;
      const assistantModel = String(body.model || chatModelId || "").trim();

      const pendingMsg = ensureMessageId(
        buildMessage({
          role: "assistant",
          text: "",
          tokens: 0,
          avatar: assistantAvatar,
          createdAt: pendingCreatedAt,
          model: assistantModel,
          isPending: true
        })
      );
      if (!pendingId) {
        appendMsg(pendingMsg);
        pendingId = pendingMsg._id;
      } else if (assistantModel) {
        updateMsg(pendingId, { model: assistantModel });
      }

      const reqLogId = crypto?.randomUUID?.() || String(Date.now());
      appendLog({
        id: reqLogId,
        at: Date.now(),
        type: "request",
        requestJson: JSON.stringify(body, null, 2)
      });

      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const resolveTokens = (text, usageValue) =>
        typeof usageValue === "number" ? usageValue : estimateTokens(text);

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const shouldStream = useStream && contentType.includes("text/event-stream");
      if (!shouldStream) {
        const rawText = await res.text();
        updateRequestLog(reqLogId, {
          responseAt: Date.now(),
          responseStatus: res.status,
          responseText: rawText
        });
        if (!res.ok) {
          showToast(`HTTP ${res.status}`);
          applyAssistantUpdate({
            id: pendingId,
            text: rawText || `HTTP ${res.status}`,
            tokens: pendingMsg.tokens,
            isPending: false,
            appendVariant: !!appendVariant,
            createdAt: pendingCreatedAt
          });
          return;
        }
        let data;
        try {
          data = JSON.parse(rawText);
          updateRequestLog(reqLogId, {
            responseJson: JSON.stringify(data, null, 2)
          });
        } catch {
          updateRequestLog(reqLogId, {
            responseJson: null,
            responseText: rawText
          });
          applyAssistantUpdate({
            id: pendingId,
            text: rawText,
            tokens: pendingMsg.tokens,
            isPending: false,
            appendVariant: !!appendVariant,
            createdAt: pendingCreatedAt
          });
          return;
        }
        let toolTags = "";
        const toolCalls =
          data?.choices?.[0]?.message?.tool_calls ||
          data?.choices?.[0]?.tool_calls ||
          [];
        if (toolCalls.length > 0) {
          const handled = await handleToolCalls(toolCalls, messagesPayload);
          const nextMessages = handled.nextMessages;
          toolTags = handled.toolTags;
          if (toolTags) {
            applyAssistantUpdate({
              id: pendingId,
              text: toolTags,
              tokens: estimateTokens(toolTags),
              isPending: true,
              appendVariant: false,
              createdAt: pendingCreatedAt
            });
          }
          const followBody = { ...body, messages: nextMessages, stream: false };
          const followLogId = crypto?.randomUUID?.() || String(Date.now());
          appendLog({
            id: followLogId,
            at: Date.now(),
            type: "request",
            requestJson: JSON.stringify(followBody, null, 2)
          });
          const followRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify(followBody),
            signal: controller.signal
          });
          const followText = await followRes.text();
          updateRequestLog(followLogId, {
            responseAt: Date.now(),
            responseStatus: followRes.status,
            responseText: followText
          });
          if (!followRes.ok) {
            applyAssistantUpdate({
              id: pendingId,
              text: followText || `HTTP ${followRes.status}`,
              tokens: pendingMsg.tokens,
              isPending: false,
              appendVariant: !!appendVariant,
              createdAt: pendingCreatedAt
            });
            return;
          }
          let followData;
          try {
            followData = JSON.parse(followText);
            updateRequestLog(followLogId, {
              responseJson: JSON.stringify(followData, null, 2)
            });
          } catch {
            applyAssistantUpdate({
              id: pendingId,
              text: followText,
              tokens: pendingMsg.tokens,
              isPending: false,
              appendVariant: !!appendVariant,
              createdAt: pendingCreatedAt
            });
            return;
          }
          const followContent =
            followData?.choices?.[0]?.message?.content ||
            followData?.choices?.[0]?.delta?.content ||
            followData?.output_text ||
            "";
          const followUsage =
            followData?.usage?.total_tokens ??
            followData?.usage?.totalTokens ??
            followData?.usage?.total;
          const finalTokens = resolveTokens(followContent, followUsage);
          applyAssistantUpdate({
            id: pendingId,
            text: toolTags ? `${toolTags}\n${followContent}` : followContent,
            tokens: finalTokens,
            isPending: false,
            appendVariant: !!appendVariant,
            createdAt: pendingCreatedAt
          });
          return;
        }
        const content =
          data?.choices?.[0]?.message?.content ||
          data?.choices?.[0]?.delta?.content ||
          data?.output_text ||
          "";
        const usageTokens =
          data?.usage?.total_tokens ?? data?.usage?.totalTokens ?? data?.usage?.total;
        const nextTokens = resolveTokens(content, usageTokens);
        applyAssistantUpdate({
          id: pendingId,
          text: content,
          tokens: nextTokens,
          isPending: false,
          appendVariant: !!appendVariant,
          createdAt: pendingCreatedAt
        });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let fullText = "";
      const toolCallsMap = {};
      let toolTags = "";
      let streamUsageTokens;
      if (!reader) {
        applyAssistantUpdate({
          id: pendingId,
          text: "No response stream",
          tokens: pendingMsg.tokens,
          isPending: false,
          appendVariant: !!appendVariant,
          createdAt: pendingCreatedAt
        });
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        buffer += chunkText;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          if (trimmedLine.startsWith("data:")) {
            const payload = trimmedLine.replace(/^data:\s*/, "");
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const delta =
                json?.choices?.[0]?.delta?.content ||
                json?.choices?.[0]?.message?.content ||
                json?.output_text ||
                "";
              const usageValue =
                json?.usage?.total_tokens ??
                json?.usage?.totalTokens ??
                json?.usage?.total;
              if (typeof usageValue === "number") {
                streamUsageTokens = usageValue;
              }
              const deltaToolCalls = json?.choices?.[0]?.delta?.tool_calls || [];
              if (Array.isArray(deltaToolCalls)) {
                deltaToolCalls.forEach((tc) => {
                  const idx = typeof tc.index === "number" ? tc.index : 0;
                  if (!toolCallsMap[idx]) {
                    toolCallsMap[idx] = {
                      id: tc.id,
                      type: "function",
                      function: { name: "", arguments: "" }
                    };
                  }
                  if (tc.id) toolCallsMap[idx].id = tc.id;
                  if (tc.function?.name) toolCallsMap[idx].function.name = tc.function.name;
                  if (tc.function?.arguments) {
                    toolCallsMap[idx].function.arguments += tc.function.arguments;
                  }
                });
              }
                if (delta) {
                  fullText += delta;
                  applyAssistantUpdate({
                    id: pendingId,
                    text: fullText,
                    tokens: resolveTokens(fullText, streamUsageTokens),
                    isPending: true,
                    appendVariant: false,
                    createdAt: pendingCreatedAt
                  });
                }
            } catch {
              // ignore
            }
          }
        }
      }

      updateRequestLog(reqLogId, {
        responseAt: Date.now(),
        responseStatus: res.status,
        responseText: fullText,
        responseJson: null
      });
      const streamToolCalls = Object.values(toolCallsMap);
      if (streamToolCalls.length > 0) {
        updateRequestLog(reqLogId, {
          responseJson: JSON.stringify({ tool_calls: streamToolCalls }, null, 2)
        });
        const handled = await handleToolCalls(streamToolCalls, messagesPayload);
        const nextMessages = handled.nextMessages;
        toolTags = handled.toolTags;
        if (toolTags) {
          applyAssistantUpdate({
            id: pendingId,
            text: toolTags,
            tokens: estimateTokens(toolTags),
            isPending: true,
            appendVariant: false,
            createdAt: pendingCreatedAt
          });
        }
        const followBody = { ...body, messages: nextMessages, stream: true };
        const followLogId = crypto?.randomUUID?.() || String(Date.now());
        appendLog({
          id: followLogId,
          at: Date.now(),
          type: "request",
          requestJson: JSON.stringify(followBody, null, 2)
        });
        const followRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify(followBody),
          signal: controller.signal
        });
        if (!followRes.body) {
          applyAssistantUpdate({
            id: pendingId,
            text: "No response stream",
            tokens: pendingMsg.tokens,
            isPending: false,
            appendVariant: !!appendVariant,
            createdAt: pendingCreatedAt
          });
          return;
        }
        const followReader = followRes.body.getReader();
        const followDecoder = new TextDecoder("utf-8");
        let followBuffer = "";
        let followText = "";
        let followUsageTokens;
        while (true) {
          // eslint-disable-next-line no-await-in-loop
          const { done: followDone, value: followValue } = await followReader.read();
          if (followDone) break;
          const followChunk = followDecoder.decode(followValue, { stream: true });
          followBuffer += followChunk;
          const followLines = followBuffer.split("\n");
          followBuffer = followLines.pop() || "";
          for (const line of followLines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            if (trimmedLine.startsWith("data:")) {
              const payload = trimmedLine.replace(/^data:\s*/, "");
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta =
                  json?.choices?.[0]?.delta?.content ||
                  json?.choices?.[0]?.message?.content ||
                  json?.output_text ||
                  "";
                const usageValue =
                  json?.usage?.total_tokens ??
                  json?.usage?.totalTokens ??
                  json?.usage?.total;
                if (typeof usageValue === "number") {
                  followUsageTokens = usageValue;
                }
                if (delta) {
                  followText += delta;
                  applyAssistantUpdate({
                    id: pendingId,
                    text: toolTags ? `${toolTags}\n${followText}` : followText,
                    tokens: resolveTokens(followText, followUsageTokens),
                    isPending: true,
                    appendVariant: false,
                    createdAt: pendingCreatedAt
                  });
                }
              } catch {
                // ignore
              }
            }
          }
        }
        updateRequestLog(followLogId, {
          responseAt: Date.now(),
          responseStatus: followRes.status,
          responseText: followText,
          responseJson: null
        });
        applyAssistantUpdate({
          id: pendingId,
          text: toolTags ? `${toolTags}\n${followText}` : followText,
          tokens: resolveTokens(followText, followUsageTokens),
          isPending: false,
          appendVariant: !!appendVariant,
          createdAt: pendingCreatedAt
        });
        return;
      }
      applyAssistantUpdate({
        id: pendingId,
        text: fullText,
        tokens: resolveTokens(fullText, streamUsageTokens),
        isPending: false,
        appendVariant: !!appendVariant,
        createdAt: pendingCreatedAt
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        showToast(timedOut ? "请求超时" : "已停止生成");
        updateRequestLog(reqLogId, {
          responseAt: Date.now(),
          responseStatus: timedOut ? "timeout" : "aborted",
          responseText: timedOut ? "请求超时" : "已停止生成"
        });
      } else {
        showToast(err?.message || "请求失败");
        updateRequestLog(reqLogId, {
          responseAt: Date.now(),
          responseStatus: "error",
          responseText: err?.message || "请求失败"
        });
      }
      if (pendingId) {
        applyAssistantUpdate({
          id: pendingId,
          text: err?.message || "请求失败",
          tokens: pendingMsg.tokens,
          isPending: false,
          appendVariant: !!appendVariant,
          createdAt: pendingCreatedAt
        });
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      safeSetTyping(false);
      setIsGenerating(false);
    }
  };

  const diffTextInline = (before, after) => {
    const a = before || "";
    const b = after || "";
    if (!a && !b) return [];
    if (!a) return [{ type: "add", text: b }];
    if (!b) return [{ type: "del", text: a }];
    const hasCJK = /[\u4e00-\u9fff]/.test(a + b);
    const tokenize = (s) =>
      hasCJK
        ? s.split("")
        : s.split(/(\s+)/).filter((t) => t.length > 0);
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    const n = tokensA.length;
    const m = tokensB.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = 1; i <= n; i += 1) {
      for (let j = 1; j <= m; j += 1) {
        dp[i][j] =
          tokensA[i - 1] === tokensB[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const ops = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (tokensA[i - 1] === tokensB[j - 1]) {
        ops.push({ type: "keep", text: tokensA[i - 1] });
        i -= 1;
        j -= 1;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        ops.push({ type: "del", text: tokensA[i - 1] });
        i -= 1;
      } else {
        ops.push({ type: "add", text: tokensB[j - 1] });
        j -= 1;
      }
    }
    while (i > 0) {
      ops.push({ type: "del", text: tokensA[i - 1] });
      i -= 1;
    }
    while (j > 0) {
      ops.push({ type: "add", text: tokensB[j - 1] });
      j -= 1;
    }
    ops.reverse();
    const merged = [];
    ops.forEach((op) => {
      const last = merged[merged.length - 1];
      if (last && last.type === op.type) {
        last.text += op.text;
      } else {
        merged.push({ ...op });
      }
    });
    return merged;
  };

  const renderMessageContent = (message) => {
    const { content, position, createdAt, tokens } = message;
    const rawText = content?.text || "";
    const extracted = extractThinkAndTools(rawText);
    const baseText = extracted.cleanText;
    const thinkText = extracted.thinkText;
    const toolParts = extracted.tools.filter((t) => t.type === "result");
    const timeText = formatDateTime(createdAt);
    const showTokens = position !== "right" && typeof tokens === "number";
    const variantCount = message?.variants?.length || 1;
    const variantIndex =
      typeof message?.variantIndex === "number" ? message.variantIndex : 0;
    const variantLabel = `${variantIndex + 1}/${variantCount}`;

    return (
      <div className={`chat ${position === "right" ? "chat-end" : "chat-start"}`}>
        <div className="chat-image avatar">
          <div className="w-8 rounded-full">
            <img
              src={
                message?.user?.avatar ||
                (position === "right" ? userAvatar : assistantAvatar)
              }
              alt="avatar"
            />
          </div>
        </div>
        <div className="chat-header text-xs opacity-70">
          {timeText && <span>{timeText}</span>}
          {showTokens && <span>{` · ${tokens} tokens`}</span>}
        </div>
        <div className="chat-bubble-wrap">
          {(thinkText || toolParts.length > 0) && (
            <div className="chat-top-cards">
            {thinkText && (
              <div className="think-card collapse collapse-arrow">
                <input type="checkbox" />
                <div className="collapse-title think-header">
                  <span>思考/推理</span>
                </div>
                <div className="collapse-content think-body">
                  <pre>{thinkText}</pre>
                </div>
              </div>
            )}
              {toolParts.length > 0 && (
                <div className="tool-cards">
                  {toolParts.map((t, idx) => {
                    const key = `${message._id}-tool-${idx}`;
                    const isOpen = !!toolOpen[key];
                    const parseToolJson = (raw) => {
                      if (!raw) return null;
                      try {
                        return JSON.parse(raw);
                      } catch {
                        return null;
                      }
                    };
                    const memoryNames = ["create_memory", "edit_memory", "delete_memory"];
                    const isMemoryTool = t.type === "result" && memoryNames.includes(t.name);
                    if (isMemoryTool) {
                      const payload = parseToolJson(t.content) || {};
                      const beforeText = payload?.before || payload?.removed?.content || "";
                      const afterText = payload?.after || payload?.content || "";
                      const diffParts =
                        t.name === "edit_memory"
                          ? diffTextInline(beforeText, afterText)
                          : [];
                      const titleMap = {
                        create_memory: "创建记忆",
                        edit_memory: "更新记忆",
                        delete_memory: "删除记忆"
                      };
                      return (
                        <div
                          className="tool-card collapse collapse-arrow"
                          key={key}
                        >
                          <input type="checkbox" />
                          <div className="collapse-title tool-card-header">
                            <span className="tool-card-name">
                              {titleMap[t.name] || t.name}
                            </span>
                          </div>
                          <div className="collapse-content tool-detail">
                            {t.name === "create_memory" && (
                              <div className="tool-diff">
                                <span className="tool-add">+ {afterText}</span>
                              </div>
                            )}
                            {t.name === "edit_memory" && (
                              <div className="tool-diff-inline">
                                {diffParts.length > 0 ? (
                                  diffParts.map((part, partIdx) => {
                                    if (part.type === "del") {
                                      return (
                                        <span className="tool-del" key={`del-${partIdx}`}>
                                          {part.text}
                                        </span>
                                      );
                                    }
                                    if (part.type === "add") {
                                      return (
                                        <span className="tool-add" key={`add-${partIdx}`}>
                                          {part.text}
                                        </span>
                                      );
                                    }
                                    return <span key={`keep-${partIdx}`}>{part.text}</span>;
                                  })
                                ) : (
                                  <>
                                    {beforeText && (
                                      <span className="tool-del">{beforeText}</span>
                                    )}
                                    {afterText && (
                                      <span className="tool-add">{afterText}</span>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                            {t.name === "delete_memory" && (
                              <div className="tool-diff">
                                <span className="tool-del">- {beforeText}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="tool-card collapse collapse-arrow" key={key}>
                        <input type="checkbox" />
                        <div className="collapse-title tool-card-header">
                          <span className="tool-card-name">
                            {t.type === "call" ? "工具调用" : "工具结果"} · {t.name}
                          </span>
                        </div>
                        <div className="collapse-content tool-detail">
                          <pre className="tool-body">{t.content}</pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        <div
          className={`chat-bubble ${
            position === "right"
              ? "bg-secondary text-secondary-content"
              : "bg-white text-base-content"
          }`}
        >
            {message.isPending && !baseText && (
              <span className="loading loading-dots loading-sm" />
            )}
          {baseText && (
            <div className="msg-content msg-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre: ({ children }) => {
                    const child = Array.isArray(children) ? children[0] : children;
                    const className = child?.props?.className || "";
                    const match = /language-([\w-]+)/.exec(className);
                    const lang = (match?.[1] || "code").toLowerCase();
                    const codeChildren = child?.props?.children ?? children;
                    return (
                      <div className="msg-codeblock">
                        <div className="msg-codeblock-head">
                          <span>{lang}</span>
                        </div>
                        <pre>
                          <code className={className}>{codeChildren}</code>
                        </pre>
                      </div>
                    );
                  },
                  code: ({ inline, className, children, ...props }) => {
                    if (inline) {
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                  table: ({ node, ...props }) => (
                    <div className="md-table">
                      <table {...props} />
                    </div>
                  )
                }}
              >
                {baseText}
              </ReactMarkdown>
            </div>
          )}
          </div>
        </div>
        <div className="chat-footer">
          {position === "right" && variantCount > 1 && (
            <div className="variant-switch">
              <button
                type="button"
                className="variant-btn"
                onClick={() =>
                  switchVariant(
                    message._id,
                    (variantIndex - 1 + variantCount) % variantCount
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="variant-label-text">{variantLabel}</span>
              <button
                type="button"
                className="variant-btn"
                onClick={() =>
                  switchVariant(
                    message._id,
                    (variantIndex + 1) % variantCount
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <div
            className={`action-pop ${position === "right" ? "is-right" : "is-left"}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="btn btn-ghost btn-xs msg-ellipsis-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                setActionOpenId((prev) => (prev === message._id ? null : message._id));
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {actionOpenId === message._id && (
              <div
                className="action-bar"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  className="action-icon-btn"
                  type="button"
                  onPointerDown={() => {
                    const id = message?._id || null;
                    if (!id) return;
                    setCopiedId(id);
                    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
                    copyTimerRef.current = setTimeout(() => {
                      setCopiedId(null);
                    }, 1200);
                  }}
                  onClick={() => handleAction(message, "copy")}
                >
                  {copiedId === message._id ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                {position !== "right" && (
                  <button
                    className="action-icon-btn"
                    type="button"
                    onClick={() => handleAction(message, "refresh")}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
                <button
                  className="action-icon-btn"
                  type="button"
                  onClick={() => handleAction(message, "edit")}
                >
                  <SquarePen className="h-4 w-4" />
                </button>
                <button
                  className="action-icon-btn"
                  type="button"
                  onClick={() => handleAction(message, "delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          {position !== "right" && variantCount > 1 && (
            <div className="variant-switch">
              <button
                type="button"
                className="variant-btn"
                onClick={() =>
                  switchVariant(
                    message._id,
                    (variantIndex - 1 + variantCount) % variantCount
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="variant-label-text">{variantLabel}</span>
              <button
                type="button"
                className="variant-btn"
                onClick={() =>
                  switchVariant(
                    message._id,
                    (variantIndex + 1) % variantCount
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleSend = (nextText) => {
    const text = sanitizeText(
      typeof nextText === "string" ? nextText : inputValue
    );
    if (!text) return;
    if (!chatModelId) {
      showToast("请选择聊天模型");
      return;
    }
    ensureCurrentSessionId();
    appendMsg(
      buildMessage({
        role: "user",
        text,
        tokens: 0,
        avatar: userAvatar
      })
    );
    const historyList = buildHistoryList([
      ...messagesRef.current,
      { position: "right", content: { text } }
    ]);
    sendChatRequest({ historyList });
    setInputValue("");
  };

  const editingTarget = messages.find((m) => m._id === editingId);

  return (
    <div className="ChatPage bg-[#f7f8fb]">
      <div
        className="navbar bg-base-100 shadow-sm app-navbar"
        onClick={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(
              "button,a,input,select,textarea,.dropdown-content,.chat-model-sub-btn,.dropdown"
            )
          ) {
            return;
          }
          scrollToTop();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            scrollToTop();
          }
        }}
      >
        <div className="navbar-start">
          <button
            type="button"
            className="btn btn-ghost btn-circle"
            aria-label="返回"
            onClick={() => (window.location.hash = "#/")}
          >
            <ArrowBigLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="navbar-center">
          <div className="navbar-title-stack">
            <div className="navbar-title-text">
              {assistantName || "Kelivo Chat"}
            </div>
            <div className="chat-model-sub">
              {findAddedModelBySelection(chatModels, chatModelId)?.id ||
                chatModelId ||
                "未选择聊天模型"}
            </div>
          </div>
        </div>
        <div className="navbar-end">
          <button
            className="btn btn-ghost btn-circle"
            type="button"
            aria-label="搜索会话"
            onClick={() => (window.location.hash = "#/sessions")}
          >
            <History className="h-5 w-5" />
          </button>
          <button
            className="btn btn-ghost btn-circle"
            type="button"
            aria-label="新对话"
            onClick={() => handleNewSession()}
          >
            <MessageCirclePlus className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="MessageContainer">
        <div className="MessageList">
          {displayMessages.map((m) => (
            <div key={m._id}>{renderMessageContent(m)}</div>
          ))}
        </div>
      </div>
      <div className="composer-bar">
        <div className="composer-input-wrap">
          <textarea
            ref={inputRef}
            className="composer-input custom-input"
            placeholder="输入消息..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isGenerating) {
                  handleSend();
                }
              }
            }}
            rows={1}
            disabled={isGenerating}
          />
          <div className="composer-icons-row">
            <div className="composer-icons-group">
              <div className="dropdown dropdown-top model-picker-dropdown">
                <button
                  className="composer-inline-icon btn btn-ghost"
                  type="button"
                  aria-label="选择聊天模型"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModelMenuOpen((v) => !v);
                  }}
                >
                  <Bot className="h-5 w-5" />
                </button>
                {modelMenuOpen && (
                  <ul
                    tabIndex={-1}
                    className="dropdown-content menu bg-base-100 rounded-box z-[80] mb-2 w-64 p-2 shadow-sm"
                  >
                    {groupedChatModels.length === 0 && (
                      <li className="disabled">
                        <span>暂无已添加模型</span>
                      </li>
                    )}
                    {groupedChatModels.map((group) => (
                      <li key={group.providerId || group.providerName}>
                        <div className="menu-title px-2 py-1">{group.providerName}</div>
                        <ul>
                          {group.models.map((m) => (
                            <li key={modelKeyOf(m)}>
                              <button
                                type="button"
                                className={chatModelId === modelKeyOf(m) ? "active" : ""}
                                onClick={() => {
                                  const nextValue = modelKeyOf(m);
                                  setChatModelId(nextValue);
                                  writeSetting("api_model", nextValue);
                                  emitModelsUpdate();
                                  setModelMenuOpen(false);
                                }}
                              >
                                {m.id}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button className="composer-inline-icon btn btn-ghost" type="button" aria-label="Earth">
                <Earth className="h-5 w-5" />
              </button>
              <button className="composer-inline-icon btn btn-ghost" type="button" aria-label="Sparkles">
                <Sparkles className="h-5 w-5" />
              </button>
            </div>
            <button
              className={`composer-send-btn ${
                isGenerating || inputValue.trim() ? "is-ready" : ""
              }`}
              type="button"
              onClick={isGenerating ? handleStopGenerate : handleSend}
              disabled={!isGenerating && !inputValue.trim()}
              aria-label={isGenerating ? "停止生成" : "发送"}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {showBackBottom && (
        <button
          className="btn btn-circle back-bottom-custom"
          type="button"
          onClick={() => triggerAutoScroll(true)}
        >
          <ChevronsDown className="h-5 w-5" />
        </button>
      )}
      {editSheetOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setEditSheetOpen(false);
            setEditingId(null);
          }}
        >
          <div className="app-modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-content rename-content-edit">
              <button
                className="btn btn-outline btn-sm modal-corner-btn modal-corner-left"
                type="button"
                onClick={() => {
                  setEditSheetOpen(false);
                  setEditingId(null);
                }}
              >
                取消
              </button>
              <button
                className="btn btn-outline btn-sm modal-corner-btn modal-corner-right"
                type="button"
                onClick={() => {
                  const nextText = sanitizeText(editingText);
                  const target = messages.find((m) => m._id === editingId);
                  if (!target) {
                    setEditSheetOpen(false);
                    setEditingId(null);
                    return;
                  }
                  if (target.position === "right") {
                    const targetIndex = messages.findIndex(
                      (m) => m._id === target._id
                    );
                    const updatedTarget = storeTailOnVariant(
                      messages,
                      targetIndex
                    );
                    const nextVariants = [
                      ...(updatedTarget.variants || []),
                      { text: nextText, createdAt: Date.now() }
                    ];
                    const nextTarget = {
                      ...updatedTarget,
                      variants: nextVariants,
                      variantIndex: nextVariants.length - 1,
                      content: { text: nextText }
                    };
                    const nextAssistant = messages
                      .slice(targetIndex + 1)
                      .find((m) => m.position === "left");
                    const placeholderAssistant = nextAssistant
                      ? {
                          ...nextAssistant,
                          content: { text: "" },
                          isPending: true,
                          createdAt: Date.now()
                        }
                      : null;
                    const truncated = [
                      ...messages.slice(0, targetIndex),
                      nextTarget,
                      ...(placeholderAssistant ? [placeholderAssistant] : [])
                    ];
                    resetList(truncated);

                    const historyList = buildHistoryList(
                      messages.slice(0, targetIndex)
                    );
                    historyList.push({ role: "user", content: nextText });

                    if (nextAssistant) {
                      sendChatRequest({
                        historyList,
                        targetMsgId: nextAssistant._id,
                        appendVariant: true
                      });
                    } else {
                      sendChatRequest({
                        historyList,
                        appendVariant: false
                      });
                    }
                  } else {
                    const normalized = normalizeMessageVariants(target);
                    const variants = normalized.variants || [];
                    const idx =
                      typeof normalized.variantIndex === "number"
                        ? normalized.variantIndex
                        : variants.length
                        ? variants.length - 1
                        : 0;
                    const nextVariants = variants.map((v, i) =>
                      i === idx
                        ? {
                            ...v,
                            text: nextText,
                            tokens: estimateTokens(nextText)
                          }
                        : v
                    );
                    updateMsg(target._id, {
                      ...normalized,
                      variants: nextVariants,
                      content: { text: nextText },
                      tokens: estimateTokens(nextText)
                    });
                  }
                  setEditSheetOpen(false);
                  setEditingId(null);
                }}
              >
                {editingTarget?.position === "right"
                  ? "确认并重新发送"
                  : "确认"}
              </button>
              <div className="rename-title">编辑消息</div>
              <textarea
                className="rename-textarea"
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                rows={4}
              />
            </div>
          </div>
        </div>
      )}
      {deleteTargetId && (
        <div
          className="modal-backdrop"
          onClick={() => setDeleteTargetId(null)}
        >
          <div className="app-modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-content">
              <div className="rename-title">是否确认删除</div>
              <div className="modal-actions">
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => setDeleteTargetId(null)}
                >
                  取消
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => {
                    const next = messages.filter((m) => m._id !== deleteTargetId);
                    resetList(next);
                    setDeleteTargetId(null);
                  }}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function ToolsPage() {
  const initialProviders = readApiProvidersFromLocal();
  const [apiProviders, setApiProviders] = useState(() => initialProviders);
  const [providerId, setProviderId] = useState(() => initialProviders[0]?.id || "");
  const [providerName, setProviderName] = useState(
    () => initialProviders[0]?.name || ""
  );
  const [providerEnabled, setProviderEnabled] = useState(() =>
    initialProviders[0]?.enabled !== false
  );
  const [apiProviderDetailOpen, setApiProviderDetailOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(
    () => initialProviders[0]?.url || readSetting("api_url")
  );
  const [apiKey, setApiKey] = useState(
    () => initialProviders[0]?.key || readSetting("api_key")
  );
  const [models, setModels] = useState([]);
  const [addedModels, setAddedModels] = useState(() => {
    const providers = readApiProvidersFromLocal();
    try {
      return normalizeAddedModels(
        JSON.parse(readSetting("opt_added_models", "[]")),
        providers
      );
    } catch {
      return [];
    }
  });
  const [modelId, setModelId] = useState(() => readSetting("api_model"));
  const [modelCandidate, setModelCandidate] = useState("");
  const [temperature, setTemperature] = useState(() => readSetting("opt_temperature"));
  const [topP, setTopP] = useState(() => readSetting("opt_top_p"));
  const [maxTokens, setMaxTokens] = useState(() => readSetting("opt_max_tokens"));
  const [contextLimit, setContextLimit] = useState(() => readSetting("opt_context_limit"));
  const [useStream, setUseStream] = useState(() => readSetting("opt_stream") === "true");
  const [mcpUrl, setMcpUrl] = useState(() => readSetting("mcp_url"));
  const [mcpApiKey, setMcpApiKey] = useState(() => readSetting("mcp_api_key"));
  const [webSearchUrl, setWebSearchUrl] = useState(() => readSetting("web_search_url"));
  const [webSearchApiKey, setWebSearchApiKey] = useState(() =>
    readSetting("web_search_api_key")
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");
  const [saved, setSaved] = useState(false);
  const [apiSavedHint, setApiSavedHint] = useState("");
  const [tab, setTab] = useState("api");
  const [logs, setLogs] = useState(() => readLogs());
  const [requestLogs, setRequestLogs] = useState(() => readRequestLogs());
  const [supabaseStatus, setSupabaseStatus] = useState({
    loading: false,
    ok: null,
    text: ""
  });
  const [assistantName, setAssistantName] = useState(() =>
    readSetting("opt_assistant_name")
  );
  const [assistantAvatar, setAssistantAvatar] = useState(() =>
    readSetting("opt_assistant_avatar")
  );
  const [userAvatar, setUserAvatar] = useState(() =>
    readSetting("opt_user_avatar")
  );
  const [systemPrompt, setSystemPrompt] = useState(() => readSetting("opt_system_prompt"));
  const [messageTemplate, setMessageTemplate] = useState(() => readSetting("opt_message_template"));
  const [uiFontChat, setUiFontChat] = useState(
    () => readSetting("ui_font_chat") || "21"
  );
  const [uiFontNavbar, setUiFontNavbar] = useState(
    () => readSetting("ui_font_navbar") || "20"
  );
  const [uiFontSmall, setUiFontSmall] = useState(
    () => readSetting("ui_font_small") || "14"
  );
  const [uiFontBody, setUiFontBody] = useState(
    () => readSetting("ui_font_body") || "16"
  );
  const [searchEnabled, setSearchEnabled] = useState(
    () => readSetting("opt_search_enabled") !== "false"
  );
  const [mcpEnabled, setMcpEnabled] = useState(
    () => readSetting("opt_mcp_enabled") === "true"
  );
  const [memoryEnabled, setMemoryEnabled] = useState(
    () => readSetting("opt_memory_enabled") === "true"
  );
  const [memoryList, setMemoryList] = useState(() => readMemoryListFromLocal());
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingMemoryIndex, setEditingMemoryIndex] = useState(null);
  const [editingMemoryText, setEditingMemoryText] = useState("");
  const [memorySyncText, setMemorySyncText] = useState("");
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState("");
  const [avatarCropTarget, setAvatarCropTarget] = useState("assistant");
  const [avatarCropZoom, setAvatarCropZoom] = useState(1);
  const [avatarCropX, setAvatarCropX] = useState(0);
  const [avatarCropY, setAvatarCropY] = useState(0);
  const [avatarNaturalSize, setAvatarNaturalSize] = useState({ w: 0, h: 0 });
  const avatarCropImgRef = useRef(null);
  const AVATAR_CROP_FRAME = 240;

  useEffect(() => {
    const clamp = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    const chat = clamp(uiFontChat, 14, 30, 21);
    const navbar = clamp(uiFontNavbar, 16, 32, 20);
    const small = clamp(uiFontSmall, 10, 20, 14);
    const body = clamp(uiFontBody, 12, 24, 16);

    document.documentElement.style.setProperty("--ui-font-chat", `${chat}px`);
    document.documentElement.style.setProperty("--ui-font-navbar", `${navbar}px`);
    document.documentElement.style.setProperty("--ui-font-small", `${small}px`);
    document.documentElement.style.setProperty("--ui-font-body", `${body}px`);

    writeSetting("ui_font_chat", String(chat));
    writeSetting("ui_font_navbar", String(navbar));
    writeSetting("ui_font_small", String(small));
    writeSetting("ui_font_body", String(body));
  }, [uiFontChat, uiFontNavbar, uiFontSmall, uiFontBody]);
  const [memoryMenuIndex, setMemoryMenuIndex] = useState(null);
  const [showMemoryRename, setShowMemoryRename] = useState(false);
  const [deleteMemoryIndex, setDeleteMemoryIndex] = useState(null);
  const memoryPressTimerRef = useRef(null);
  const providerIdRef = useRef(providerId);

  useEffect(() => {
    providerIdRef.current = providerId;
  }, [providerId]);

  useEffect(() => {
    if (!providerId) return;
    const provider = apiProviders.find((p) => p.id === providerId);
    if (!provider) return;
    setProviderName(provider.name || "");
    setApiUrl(provider.url || "");
    setApiKey(provider.key || "");
    setProviderEnabled(provider.enabled !== false);
  }, [providerId, apiProviders]);

  const currentProvider = useMemo(
    () => apiProviders.find((p) => p.id === providerId) || null,
    [apiProviders, providerId]
  );
  const providerDirty =
    !!currentProvider &&
    (providerName.trim() !== String(currentProvider.name || "").trim() ||
      apiUrl.trim() !== String(currentProvider.url || "").trim() ||
      apiKey.trim() !== String(currentProvider.key || "").trim() ||
      providerEnabled !== (currentProvider.enabled !== false));
  const mcpDirty =
    mcpUrl.trim() !== readSetting("mcp_url").trim() ||
    mcpApiKey.trim() !== readSetting("mcp_api_key").trim() ||
    mcpEnabled !== (readSetting("opt_mcp_enabled") === "true");
  const searchDirty =
    webSearchUrl.trim() !== readSetting("web_search_url").trim() ||
    webSearchApiKey.trim() !== readSetting("web_search_api_key").trim() ||
    searchEnabled !== (readSetting("opt_search_enabled") === "true");

  useEffect(() => {
    const syncFromLocal = () => {
      const providers = readApiProvidersFromLocal();
      setApiProviders(providers);
      const keep =
        providers.find((p) => p.id === providerIdRef.current) ||
        providers[0] ||
        null;
      setProviderId(keep?.id || "");
      setProviderName(keep?.name ?? "");
      setApiUrl(keep?.url ?? readSetting("api_url"));
      setApiKey(keep?.key ?? readSetting("api_key"));
      setProviderEnabled(keep?.enabled !== false);
      try {
        setAddedModels(
          normalizeAddedModels(
            JSON.parse(readSetting("opt_added_models", "[]")),
            providers
          )
        );
      } catch {
        setAddedModels([]);
      }
      setModelId(readSetting("api_model"));
      setTemperature(readSetting("opt_temperature"));
      setTopP(readSetting("opt_top_p"));
      setMaxTokens(readSetting("opt_max_tokens"));
      setContextLimit(readSetting("opt_context_limit"));
      setUseStream(readSetting("opt_stream") === "true");
      setMcpUrl(readSetting("mcp_url"));
      setMcpApiKey(readSetting("mcp_api_key"));
      setWebSearchUrl(readSetting("web_search_url"));
      setWebSearchApiKey(readSetting("web_search_api_key"));
      setAssistantName(readSetting("opt_assistant_name"));
      setAssistantAvatar(readSetting("opt_assistant_avatar"));
      setUserAvatar(readSetting("opt_user_avatar"));
      setSystemPrompt(readSetting("opt_system_prompt"));
      setMessageTemplate(readSetting("opt_message_template"));
      setSearchEnabled(readSetting("opt_search_enabled") !== "false");
      setMcpEnabled(readSetting("opt_mcp_enabled") === "true");
      setMemoryEnabled(readSetting("opt_memory_enabled") === "true");
    };
    syncFromLocal();
    window.addEventListener("settings:update", syncFromLocal);
    return () => window.removeEventListener("settings:update", syncFromLocal);
  }, []);

  useEffect(() => {
    if (tab === "logs") {
      setLogs(readLogs());
      setRequestLogs(readRequestLogs());
    }
  }, [tab]);

  const checkSupabaseConnection = async () => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      setSupabaseStatus({
        loading: false,
        ok: false,
        text: "未配置 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY"
      });
      return;
    }
    if (!supabase) {
      setSupabaseStatus({
        loading: false,
        ok: false,
        text: "Supabase 客户端初始化失败"
      });
      return;
    }
    setSupabaseStatus({ loading: true, ok: null, text: "正在检测..." });
    try {
      const { count, error } = await supabase
        .from("chat_sessions")
        .select("id", { count: "exact", head: true });
      if (error) {
        setSupabaseStatus({
          loading: false,
          ok: false,
          text: `连接失败：${error.message}`
        });
        return;
      }
      setSupabaseStatus({
        loading: false,
        ok: true,
        text: `连接成功，chat_sessions 当前 ${count ?? 0} 条`
      });
    } catch (err) {
      setSupabaseStatus({
        loading: false,
        ok: false,
        text: `连接失败：${err?.message || String(err)}`
      });
    }
  };

  useEffect(() => {
    if (tab !== "logs") return;
    checkSupabaseConnection();
  }, [tab]);

  useEffect(() => {
    const onRequestLogsUpdate = () => {
      if (tab !== "logs") return;
      setRequestLogs(readRequestLogs());
    };
    window.addEventListener("requestlogs:update", onRequestLogsUpdate);
    return () =>
      window.removeEventListener("requestlogs:update", onRequestLogsUpdate);
  }, [tab]);

  useEffect(() => {
    const onModelsUpdate = () => {
      const providers = readApiProvidersFromLocal();
      try {
        setAddedModels(
          normalizeAddedModels(
            JSON.parse(readSetting("opt_added_models", "[]")),
            providers
          )
        );
      } catch {
        setAddedModels([]);
      }
      setModelId(readSetting("api_model"));
    };
    window.addEventListener("models:update", onModelsUpdate);
    return () => window.removeEventListener("models:update", onModelsUpdate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const remoteList = await loadMemoriesFromSupabase();
      if (!cancelled) setMemoryList(remoteList);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onMemoryUpdate = () => {
      setMemoryList(readMemoryListFromLocal());
    };
    window.addEventListener("memory:update", onMemoryUpdate);
    return () => window.removeEventListener("memory:update", onMemoryUpdate);
  }, []);

  useEffect(() => {
    if (memoryMenuIndex == null || showMemoryRename || deleteMemoryIndex != null) return;
    const onClick = (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".memory-dropdown") || target.closest(".memory-item.is-active"))
      ) {
        return;
      }
      setMemoryMenuIndex(null);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [memoryMenuIndex, showMemoryRename, deleteMemoryIndex]);

  useEffect(() => {
    if (memoryMenuIndex != null && memoryMenuIndex >= memoryList.length) {
      setMemoryMenuIndex(null);
      setShowMemoryRename(false);
    }
    if (deleteMemoryIndex != null && deleteMemoryIndex >= memoryList.length) {
      setDeleteMemoryIndex(null);
    }
  }, [memoryList, memoryMenuIndex, deleteMemoryIndex]);

  useEffect(
    () => () => {
      if (memoryPressTimerRef.current) {
        clearTimeout(memoryPressTimerRef.current);
        memoryPressTimerRef.current = null;
      }
    },
    []
  );


  const handleSaveProvider = () => {
    const trimmedProviderId = String(providerId || "").trim();
    if (!trimmedProviderId) {
      setModelError("请先新增并选择一个 API 供应商");
      return;
    }
    const nextProvidersRaw = Array.isArray(apiProviders) ? [...apiProviders] : [];
    const existingIdx = nextProvidersRaw.findIndex((p) => p.id === trimmedProviderId);
    const nextProvider = {
      id: trimmedProviderId,
      name: String(providerName || "").trim() || trimmedProviderId,
      url: apiUrl.trim(),
      key: apiKey.trim(),
      enabled: providerEnabled
    };
    if (existingIdx >= 0) {
      nextProvidersRaw[existingIdx] = nextProvider;
    } else {
      nextProvidersRaw.unshift(nextProvider);
    }
    const nextProviders = normalizeApiProviders(nextProvidersRaw);
    const normalizedModels = normalizeAddedModels(addedModels, nextProviders);
    const selectedModel = findAddedModelBySelection(normalizedModels, modelId);
    const nextModelId = selectedModel
      ? modelKeyOf(selectedModel)
      : normalizedModels[0]
      ? modelKeyOf(normalizedModels[0])
      : "";

    setApiProviders(nextProviders);
    setAddedModels(normalizedModels);
    setModelId(nextModelId);

    writeSetting("opt_api_providers", JSON.stringify(nextProviders));
    writeSetting("api_url", nextProvider.url);
    writeSetting("api_key", nextProvider.key);
    writeSetting("opt_added_models", JSON.stringify(normalizedModels));
    writeSetting("api_model", nextModelId);
    emitModelsUpdate();
    setApiSavedHint("供应商已保存");
    setTimeout(() => setApiSavedHint(""), 1200);
  };

  const handleSaveMcp = () => {
    writeSetting("mcp_url", mcpUrl.trim());
    writeSetting("mcp_api_key", mcpApiKey.trim());
    writeSetting("opt_mcp_enabled", mcpEnabled ? "true" : "false");
    setApiSavedHint("MCP 设置已保存");
    setTimeout(() => setApiSavedHint(""), 1200);
  };

  const handleSaveSearch = () => {
    writeSetting("web_search_url", webSearchUrl.trim());
    writeSetting("web_search_api_key", webSearchApiKey.trim());
    writeSetting("opt_search_enabled", searchEnabled ? "true" : "false");
    setApiSavedHint("搜索设置已保存");
    setTimeout(() => setApiSavedHint(""), 1200);
  };

  const handleSavePersonal = async () => {
    writeSetting("opt_temperature", temperature);
    writeSetting("opt_top_p", topP);
    writeSetting("opt_max_tokens", maxTokens);
    writeSetting("opt_context_limit", contextLimit);
    writeSetting("opt_stream", useStream ? "true" : "false");
    writeSetting("opt_assistant_name", assistantName.trim());
    writeSetting("opt_assistant_avatar", assistantAvatar.trim());
    writeSetting("opt_user_avatar", userAvatar.trim());
    writeSetting("opt_system_prompt", systemPrompt.trim());
    writeSetting("opt_memory_enabled", memoryEnabled ? "true" : "false");
    writeSetting("opt_message_template", messageTemplate.trim());
    setSaved(true);
    emitModelsUpdate();
    setTimeout(() => setSaved(false), 1200);
  };

  const handleSaveMemories = async () => {
    const syncedMemories = await upsertMemoriesToSupabase(memoryList);
    setMemoryList(syncedMemories);
    setMemoryMenuIndex(null);
    setShowMemoryRename(false);
    setDeleteMemoryIndex(null);
    setMemorySyncText(`已保存到云端（${syncedMemories.length} 条）`);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const handleMemoryRename = () => {
    if (editingMemoryIndex == null || editingMemoryIndex < 0) return;
    const content = editingMemoryText.trim();
    if (!content) return;
    const next = [...memoryList];
    if (!next[editingMemoryIndex]) return;
    next[editingMemoryIndex] = {
      ...next[editingMemoryIndex],
      content,
      updatedAt: Date.now()
    };
    setMemoryList(next.filter((m) => m?.content));
    setShowMemoryRename(false);
    setMemoryMenuIndex(null);
    setEditingMemoryIndex(null);
    setEditingMemoryText("");
  };

  const handleMemoryDelete = () => {
    if (deleteMemoryIndex == null || deleteMemoryIndex < 0) return;
    const next = memoryList.filter((_, i) => i !== deleteMemoryIndex);
    setMemoryList(next);
    setDeleteMemoryIndex(null);
    setMemoryMenuIndex(null);
  };

  const handleAvatarUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAvatarCropTarget("assistant");
      setAvatarCropSrc(dataUrl);
      setAvatarCropZoom(1);
      setAvatarCropX(0);
      setAvatarCropY(0);
      setAvatarNaturalSize({ w: 0, h: 0 });
      setAvatarCropOpen(true);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleUserAvatarUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAvatarCropTarget("user");
      setAvatarCropSrc(dataUrl);
      setAvatarCropZoom(1);
      setAvatarCropX(0);
      setAvatarCropY(0);
      setAvatarNaturalSize({ w: 0, h: 0 });
      setAvatarCropOpen(true);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const avatarCropMetrics = useMemo(() => {
    const w = avatarNaturalSize.w || 1;
    const h = avatarNaturalSize.h || 1;
    const baseScale = Math.max(AVATAR_CROP_FRAME / w, AVATAR_CROP_FRAME / h);
    const scale = baseScale * avatarCropZoom;
    const drawW = w * scale;
    const drawH = h * scale;
    const maxOffsetX = Math.max(0, (drawW - AVATAR_CROP_FRAME) / 2);
    const maxOffsetY = Math.max(0, (drawH - AVATAR_CROP_FRAME) / 2);
    return { scale, drawW, drawH, maxOffsetX, maxOffsetY };
  }, [avatarNaturalSize, avatarCropZoom]);

  useEffect(() => {
    if (!avatarCropOpen) return;
    setAvatarCropX((v) =>
      Math.max(-avatarCropMetrics.maxOffsetX, Math.min(avatarCropMetrics.maxOffsetX, v))
    );
    setAvatarCropY((v) =>
      Math.max(-avatarCropMetrics.maxOffsetY, Math.min(avatarCropMetrics.maxOffsetY, v))
    );
  }, [avatarCropMetrics.maxOffsetX, avatarCropMetrics.maxOffsetY, avatarCropOpen]);

  const handleConfirmAvatarCrop = () => {
    const img = avatarCropImgRef.current;
    if (!img || !avatarNaturalSize.w || !avatarNaturalSize.h) return;
    const { scale, maxOffsetX, maxOffsetY } = avatarCropMetrics;
    const clampedX = Math.max(-maxOffsetX, Math.min(maxOffsetX, avatarCropX));
    const clampedY = Math.max(-maxOffsetY, Math.min(maxOffsetY, avatarCropY));
    const drawW = avatarNaturalSize.w * scale;
    const drawH = avatarNaturalSize.h * scale;
    const left = (AVATAR_CROP_FRAME - drawW) / 2 + clampedX;
    const top = (AVATAR_CROP_FRAME - drawH) / 2 + clampedY;
    const sx = (0 - left) / scale;
    const sy = (0 - top) / scale;
    const sSize = AVATAR_CROP_FRAME / scale;

    const outSize = 512;
    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, outSize, outSize);
    ctx.save();
    ctx.beginPath();
    ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, outSize, outSize);
    ctx.restore();

    const dataUrl = canvas.toDataURL("image/png");
    if (avatarCropTarget === "assistant") {
      setAssistantAvatar(dataUrl);
      writeSetting("opt_assistant_avatar", dataUrl);
    } else {
      setUserAvatar(dataUrl);
      writeSetting("opt_user_avatar", dataUrl);
    }
    setAvatarCropOpen(false);
  };

  const handleClearLogs = () => {
    writeLogs([]);
    setLogs([]);
    writeRequestLogs([]);
    setRequestLogs([]);
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    setModelError("");
    try {
      const endpoint = buildModelsEndpoint(apiUrl);
      if (!endpoint) throw new Error("请先填写 API URL");
      const res = await fetch(endpoint, {
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        }
      });
      const rawText = await res.text();
      if (!res.ok) {
        const preview = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
        throw new Error(
          `HTTP ${res.status} ${res.statusText}。响应预览：${preview || "空"}`
        );
      }
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        const preview = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
        throw new Error(
          `返回的不是 JSON。可能是地址/鉴权有误。响应预览：${preview || "空"}`
        );
      }
      const list =
        data?.data?.map((m) => m.id).filter(Boolean) ??
        data?.models?.map((m) => (m.name ? m.name.replace(/^models\//, "") : m.id)).filter(Boolean) ??
        [];
      setModels(list);
      if (list.length) {
        setModelCandidate(list[0]);
      }
    } catch (err) {
      setModelError(err.message || String(err));
    } finally {
      setLoadingModels(false);
    }
  };

  const handleAddModel = () => {
    if (!modelCandidate) return;
    if (!providerId) {
      setModelError("请先选择或创建 API 供应商");
      return;
    }
    const nextItem = { providerId, id: modelCandidate };
    const exists = addedModels.some((m) => modelKeyOf(m) === modelKeyOf(nextItem));
    if (exists) return;
    const next = [nextItem, ...addedModels];
    setAddedModels(next);
    if (!modelId) {
      setModelId(modelKeyOf(nextItem));
    }
    writeSetting("opt_added_models", JSON.stringify(next));
    emitModelsUpdate();
  };

  const handleRemoveModel = (key) => {
    const next = addedModels.filter((m) => modelKeyOf(m) !== key);
    setAddedModels(next);
    writeSetting("opt_added_models", JSON.stringify(next));
    if (modelId === key) {
      const fallback = next[0] ? modelKeyOf(next[0]) : "";
      setModelId(fallback);
      writeSetting("api_model", fallback);
    }
    emitModelsUpdate();
  };

  const handleAddProvider = () => {
    const nextId = `provider_${Date.now()}`;
    const nextName = `供应商 ${apiProviders.length + 1}`;
    const next = [
      ...apiProviders,
      { id: nextId, name: nextName, url: "", key: "" }
    ];
    setApiProviders(next);
    providerIdRef.current = nextId;
    setProviderId(nextId);
    setProviderName(nextName);
    setApiUrl("");
    setApiKey("");
    setProviderEnabled(true);
    setApiProviderDetailOpen(true);
  };

  const openProviderDetail = (id) => {
    const provider = apiProviders.find((p) => p.id === id);
    if (!provider) return;
    providerIdRef.current = provider.id;
    setProviderId(provider.id);
    setProviderName(provider.name || "");
    setApiUrl(provider.url || "");
    setApiKey(provider.key || "");
    setProviderEnabled(provider.enabled !== false);
    setApiProviderDetailOpen(true);
  };

  const handleDeleteProvider = () => {
    if (!providerId) return;
    const current = Array.isArray(apiProviders) ? [...apiProviders] : [];
    const nextProvidersRaw = current.filter((p) => p.id !== providerId);
    const nextProviders = normalizeApiProviders(nextProvidersRaw);

    const fallbackProvider = nextProviders[0] || null;
    const nextAddedModels = normalizeAddedModels(
      addedModels.filter((m) => m.providerId !== providerId),
      nextProviders
    );
    const nextModelId = nextAddedModels[0] ? modelKeyOf(nextAddedModels[0]) : "";

    setApiProviders(nextProviders);
    providerIdRef.current = fallbackProvider?.id || "";
    setProviderId(fallbackProvider?.id || "");
    setProviderName(fallbackProvider?.name || "");
    setApiUrl(fallbackProvider?.url || "");
    setApiKey(fallbackProvider?.key || "");
    setProviderEnabled(fallbackProvider?.enabled !== false);
    setApiProviderDetailOpen(false);
    setAddedModels(nextAddedModels);
    setModelId(nextModelId);

    writeSetting("opt_api_providers", JSON.stringify(nextProviders));
    writeSetting("api_url", fallbackProvider?.url || "");
    writeSetting("api_key", fallbackProvider?.key || "");
    writeSetting("opt_added_models", JSON.stringify(nextAddedModels));
    writeSetting("api_model", nextModelId);
    emitModelsUpdate();

    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="tools-shell">
      <div className="navbar bg-base-100 shadow-sm app-navbar">
        <div className="navbar-start">
          <button
            type="button"
            className="btn btn-ghost btn-circle"
            aria-label="返回"
            onClick={() => (window.location.hash = "#/")}
          >
            <ArrowBigLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="navbar-center">
          <div className="navbar-title-stack">
            <div className="navbar-title-text">API 工具</div>
          </div>
        </div>
        <div className="navbar-end" />
      </div>
      <div className="page-shell">
      <div className="tabs tabs-border">
        <label className="tab">
          <input
            type="radio"
            name="tools_tabs"
            checked={tab === "api"}
            onChange={() => setTab("api")}
          />
          <Wrench className="size-4 me-2" />
          API 设置
        </label>
        <div className="tab-content p-2 bg-transparent border-0">
        {tab === "api" && (
          <>
            {!apiProviderDetailOpen ? (
              <>
                <div className="page-card">
                  <div className="page-card-title">供应商</div>
                  <div className="form-row">
                    {apiProviders.length === 0 && (
                      <div className="page-card-desc">暂无供应商，先新增一个</div>
                    )}
                    {apiProviders.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="table">
                          <tbody>
                            {apiProviders.map((p, idx) => (
                              <tr
                                key={p.id}
                                className="cursor-pointer"
                                role="button"
                                tabIndex={0}
                                onClick={() => openProviderDetail(p.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openProviderDetail(p.id);
                                  }
                                }}
                              >
                                <th>{idx + 1}</th>
                                <td>{p.name || p.id}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  <div className="memory-actions">
                    <button className="form-btn ghost" type="button" onClick={handleAddProvider}>
                      新增供应商
                    </button>
                  </div>
                </div>

                <div className="page-card">
                  <div className="page-card-title">MCP</div>
                  <div className="form-row">
                    <label className="form-label" htmlFor="mcpUrl">MCP 地址</label>
                    <input
                      id="mcpUrl"
                      className="form-input"
                      placeholder="https://mcp.example.com/call"
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">开启 MCP 工具</label>
                    <label className="form-toggle">
                      <input
                        type="checkbox"
                        checked={mcpEnabled}
                        onChange={(e) => setMcpEnabled(e.target.checked)}
                      />
                      <span>启用 MCP</span>
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="form-label" htmlFor="mcpApiKey">MCP Key</label>
                    <input
                      id="mcpApiKey"
                      className="form-input"
                      placeholder="可选"
                      value={mcpApiKey}
                      onChange={(e) => setMcpApiKey(e.target.value)}
                    />
                  </div>
                </div>

                <div className="page-card">
                  <div className="page-card-title">搜索</div>
                  <div className="form-row">
                    <label className="form-label" htmlFor="webSearchUrl">搜索地址</label>
                    <input
                      id="webSearchUrl"
                      className="form-input"
                      placeholder="https://search.example.com?q={query}"
                      value={webSearchUrl}
                      onChange={(e) => setWebSearchUrl(e.target.value)}
                    />
                    <div className="form-hint">
                      如果包含 {`{query}`} 会用 GET，否则用 POST 发送 {"{query}"}。
                    </div>
                  </div>
                  <div className="form-row">
                    <label className="form-label">开启搜索工具</label>
                    <label className="form-toggle">
                      <input
                        type="checkbox"
                        checked={searchEnabled}
                        onChange={(e) => setSearchEnabled(e.target.checked)}
                      />
                      <span>启用搜索</span>
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="form-label" htmlFor="webSearchApiKey">搜索 Key</label>
                    <input
                      id="webSearchApiKey"
                      className="form-input"
                      placeholder="可选"
                      value={webSearchApiKey}
                      onChange={(e) => setWebSearchApiKey(e.target.value)}
                    />
                  </div>
                </div>

                <div className="page-card">
                  <div className="page-card-title">默认聊天模型</div>
                  <div className="form-row">
                    <select
                      id="modelId"
                      className="form-input"
                      value={modelId}
                      onChange={(e) => {
                        setModelId(e.target.value);
                        writeSetting("api_model", e.target.value);
                        emitModelsUpdate();
                      }}
                    >
                      <option value="">请选择</option>
                      {addedModels
                        .filter((m) =>
                          (apiProviders.find((p) => p.id === m.providerId)?.enabled !== false)
                        )
                        .map((m) => (
                          <option key={modelKeyOf(m)} value={modelKeyOf(m)}>
                            {m.id} ({apiProviders.find((p) => p.id === m.providerId)?.name || m.providerId})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {mcpDirty && (
                  <button className="form-btn" type="button" onClick={handleSaveMcp}>
                    保存 MCP 设置
                  </button>
                )}
                {searchDirty && (
                  <button className="form-btn" type="button" onClick={handleSaveSearch}>
                    保存搜索设置
                  </button>
                )}
                {apiSavedHint && <div className="form-hint">{apiSavedHint}</div>}
              </>
            ) : (
              <div className="page-card provider-detail-card">
                <div className="memory-actions">
                  <button
                    className="form-btn ghost"
                    type="button"
                    onClick={() => setApiProviderDetailOpen(false)}
                    aria-label="返回供应商列表"
                  >
                    <ArrowBigLeft className="h-5 w-5" />
                  </button>
                </div>
                <div className="form-row">
                  <label className="form-label" htmlFor="providerName">供应商名称</label>
                  <input
                    id="providerName"
                    className="form-input"
                    placeholder="例如 OpenAI / OpenRouter"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label className="form-label" htmlFor="apiUrl">API URL</label>
                  <input
                    id="apiUrl"
                    className="form-input"
                    placeholder="https://example.com/v1/chat"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label className="form-label" htmlFor="apiKey">API Key</label>
                  <input
                    id="apiKey"
                    className="form-input"
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <div className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>是否启用</span>
                    <input
                      type="checkbox"
                      className="toggle"
                      checked={providerEnabled}
                      onChange={(e) => setProviderEnabled(e.target.checked)}
                    />
                  </div>
                </div>
                {providerDirty && (
                  <button className="form-btn" type="button" onClick={handleSaveProvider}>
                    保存供应商
                  </button>
                )}
                {apiSavedHint && <div className="form-hint">{apiSavedHint}</div>}
                {modelError && <div className="form-error">{modelError}</div>}
                {models.length > 0 && (
                  <div className="form-row">
                    <label className="form-label" htmlFor="modelCandidate">
                      从已拉取模型中添加
                    </label>
                    <select
                      id="modelCandidate"
                      className="form-input"
                      value={modelCandidate}
                      onChange={(e) => setModelCandidate(e.target.value)}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button className="form-btn" type="button" onClick={handleAddModel}>
                      添加到已添加模型
                    </button>
                  </div>
                )}
                <div className="form-row">
                  <label className="form-label">当前供应商已添加模型</label>
                  <div className="memory-list">
                    {addedModels
                      .filter((m) => m.providerId === providerId)
                      .map((m) => (
                        <div className="memory-item" key={modelKeyOf(m)}>
                          <div className="memory-text">{m.id}</div>
                          <div className="memory-actions">
                            <button
                              className="form-btn ghost"
                              type="button"
                              onClick={() => handleRemoveModel(modelKeyOf(m))}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    {addedModels.filter((m) => m.providerId === providerId).length === 0 && (
                      <div className="page-card-desc">当前供应商还没有已添加模型</div>
                    )}
                  </div>
                </div>
                <div className="provider-detail-fab">
                  <button className="btn btn-outline" type="button" onClick={handleDeleteProvider}>
                    删除供应商
                  </button>
                  <button className="btn" type="button" onClick={handleFetchModels}>
                    {loadingModels ? "加载中..." : "拉取模型"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </div>

        <label className="tab">
          <input
            type="radio"
            name="tools_tabs"
            checked={tab === "personal"}
            onChange={() => setTab("personal")}
          />
          <BookHeart className="size-4 me-2" />
          个性化
        </label>
        <div className="tab-content p-2 bg-transparent border-0">
        {tab === "personal" && (
          <div className="page-card">
            <div className="page-card-title">个性化设置</div>
            <div className="form-row">
              <label className="form-label" htmlFor="assistantName">
                助手昵称
              </label>
              <input
                id="assistantName"
                className="form-input"
                placeholder="例如 Kelivo"
                value={assistantName}
                onChange={(e) => setAssistantName(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="assistantAvatar">
                头像链接
              </label>
              <input
                id="assistantAvatar"
                className="form-input"
                placeholder="https://..."
                value={assistantAvatar}
                onChange={(e) => setAssistantAvatar(e.target.value)}
              />
              <div className="memory-actions">
                <label className="form-btn ghost" htmlFor="assistantAvatarUpload">
                  本地上传
                </label>
                <input
                  id="assistantAvatarUpload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  style={{ display: "none" }}
                />
                {assistantAvatar && (
                  <button
                    className="form-btn ghost"
                    type="button"
                    onClick={() => {
                      setAssistantAvatar("");
                      writeSetting("opt_assistant_avatar", "");
                    }}
                  >
                    清除
                  </button>
                )}
              </div>
              {assistantAvatar && (
                <div className="avatar-preview">
                  <img src={assistantAvatar} alt="assistant avatar" />
                </div>
              )}
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="userAvatar">
                用户头像
              </label>
              <input
                id="userAvatar"
                className="form-input"
                placeholder="https://..."
                value={userAvatar}
                onChange={(e) => setUserAvatar(e.target.value)}
              />
              <div className="memory-actions">
                <label className="form-btn ghost" htmlFor="userAvatarUpload">
                  本地上传
                </label>
                <input
                  id="userAvatarUpload"
                  type="file"
                  accept="image/*"
                  onChange={handleUserAvatarUpload}
                  style={{ display: "none" }}
                />
                {userAvatar && (
                  <button
                    className="form-btn ghost"
                    type="button"
                    onClick={() => {
                      setUserAvatar("");
                      writeSetting("opt_user_avatar", "");
                    }}
                  >
                    清除
                  </button>
                )}
              </div>
              {userAvatar && (
                <div className="avatar-preview">
                  <img src={userAvatar} alt="user avatar" />
                </div>
              )}
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="systemPrompt">
                System Prompt
              </label>
              <textarea
                id="systemPrompt"
                className="form-textarea"
                placeholder="你是一个有帮助的助手..."
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
              />
              <div className="token-row">
                <span className="token-label">变量：</span>
                <button
                  className="token-chip"
                  type="button"
                  onClick={() =>
                    setSystemPrompt((prev) =>
                      prev ? `${prev}{current_datetime}` : "{current_datetime}"
                    )
                  }
                >
                  {`{current_datetime}`}
                </button>
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">记忆库</label>
              <label className="form-toggle">
                <input
                  type="checkbox"
                  checked={memoryEnabled}
                  onChange={(e) => setMemoryEnabled(e.target.checked)}
                />
                <span>启用记忆</span>
              </label>
              <div className="memory-list">
                {memoryList.length === 0 && (
                  <div className="page-card-desc">暂无记忆</div>
                )}
                {memoryList.map((item, idx) => (
                  <div
                    className={`memory-item${memoryMenuIndex === idx ? " is-active" : ""}`}
                    key={`${item.id ?? "local"}-${idx}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMemoryMenuIndex(idx);
                      setShowMemoryRename(false);
                      setDeleteMemoryIndex(null);
                    }}
                    onTouchStart={() => {
                      memoryPressTimerRef.current = setTimeout(() => {
                        setMemoryMenuIndex(idx);
                        setShowMemoryRename(false);
                        setDeleteMemoryIndex(null);
                      }, 550);
                    }}
                    onTouchEnd={() => {
                      if (memoryPressTimerRef.current) {
                        clearTimeout(memoryPressTimerRef.current);
                        memoryPressTimerRef.current = null;
                      }
                    }}
                    onTouchCancel={() => {
                      if (memoryPressTimerRef.current) {
                        clearTimeout(memoryPressTimerRef.current);
                        memoryPressTimerRef.current = null;
                      }
                    }}
                  >
                    <div className="memory-time">
                      ID: {item.id ?? "-"}
                    </div>
                    <div className="memory-text">{item.content}</div>
                    <div className="memory-time">
                      {formatDateTime(item.updatedAt)}
                    </div>
                    {memoryMenuIndex === idx && !showMemoryRename && (
                      <ul
                        className="menu dropdown-content session-dropdown memory-dropdown"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <li>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingMemoryIndex(idx);
                              setEditingMemoryText(item.content);
                              setShowMemoryRename(true);
                              setDeleteMemoryIndex(null);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="session-menu-text">修改</span>
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteMemoryIndex(idx);
                              setMemoryMenuIndex(null);
                              setShowMemoryRename(false);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="session-menu-text">删除</span>
                          </button>
                        </li>
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="memory-add">
                <input
                  className="form-input"
                  placeholder="新增记忆..."
                  value={memoryDraft}
                  onChange={(e) => setMemoryDraft(e.target.value)}
                />
                <button
                  className="form-btn"
                  type="button"
                  onClick={() => {
                    const val = memoryDraft.trim();
                    if (!val) return;
                    setMemoryList([{ content: val, updatedAt: Date.now() }, ...memoryList]);
                    setMemoryDraft("");
                  }}
                >
                  添加
                </button>
              </div>
              <div className="memory-actions" style={{ marginTop: "8px" }}>
                <button className="form-btn" type="button" onClick={handleSaveMemories}>
                  保存记忆到云端
                </button>
              </div>
              {memorySyncText && <div className="form-hint">{memorySyncText}</div>}
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="messageTemplate">
                聊天内容模板（用 {"{input}"} 代表用户输入）
              </label>
              <textarea
                id="messageTemplate"
                className="form-textarea"
                placeholder="请用要点回答：{input}"
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
                rows={3}
              />
            </div>
            <div className="form-row">
              <div className="page-card-title">聊天参数</div>
              <label className="form-label" htmlFor="temperature">
                temperature
              </label>
              <input
                id="temperature"
                className="form-input"
                placeholder="例如 0.7"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="topP">
                top_p
              </label>
              <input
                id="topP"
                className="form-input"
                placeholder="例如 0.9"
                value={topP}
                onChange={(e) => setTopP(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="maxTokens">
                max_tokens
              </label>
              <input
                id="maxTokens"
                className="form-input"
                placeholder="例如 512"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="contextLimit">
                上下文消息数量
              </label>
              <input
                id="contextLimit"
                className="form-input"
                placeholder="例如 20（只保留最近 20 条）"
                value={contextLimit}
                onChange={(e) => setContextLimit(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label className="form-label" htmlFor="streamToggle">
                stream
              </label>
              <label className="form-toggle">
                <input
                  id="streamToggle"
                  type="checkbox"
                  checked={useStream}
                  onChange={(e) => setUseStream(e.target.checked)}
                />
                <span>启用流式</span>
              </label>
            </div>
            <div className="page-card">
              <div className="page-card-title">字号调节（临时）</div>
              <div className="form-row">
                <label className="form-label">聊天正文（消息/输入框）: {uiFontChat}px</label>
                <input
                  type="range"
                  min="14"
                  max="30"
                  step="1"
                  value={uiFontChat}
                  onChange={(e) => setUiFontChat(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">导航栏标题: {uiFontNavbar}px</label>
                <input
                  type="range"
                  min="16"
                  max="32"
                  step="1"
                  value={uiFontNavbar}
                  onChange={(e) => setUiFontNavbar(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">小字号（时间/ID/模型名）: {uiFontSmall}px</label>
                <input
                  type="range"
                  min="10"
                  max="20"
                  step="1"
                  value={uiFontSmall}
                  onChange={(e) => setUiFontSmall(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label className="form-label">其他正文字号（全局）: {uiFontBody}px</label>
                <input
                  type="range"
                  min="12"
                  max="24"
                  step="1"
                  value={uiFontBody}
                  onChange={(e) => setUiFontBody(e.target.value)}
                />
              </div>
              <div className="memory-actions">
                <button
                  className="form-btn ghost"
                  type="button"
                  onClick={() => {
                    setUiFontChat("21");
                    setUiFontNavbar("20");
                    setUiFontSmall("14");
                    setUiFontBody("16");
                  }}
                >
                  恢复默认
                </button>
              </div>
            </div>
            <button className="form-btn" type="button" onClick={handleSavePersonal}>
              保存
            </button>
            {saved && <div className="form-hint">已保存</div>}
          </div>
        )}
        </div>

        <label className="tab">
          <input
            type="radio"
            name="tools_tabs"
            checked={tab === "logs"}
            onChange={() => setTab("logs")}
          />
          <FileClock className="size-4 me-2" />
          日志
        </label>
        <div className="tab-content p-2 bg-transparent border-0">
        {tab === "logs" && (
          <div className="page-card">
            <div className="page-card-title">请求日志</div>
            <div className="form-row">
              <button
                className="form-btn"
                type="button"
                onClick={checkSupabaseConnection}
                disabled={supabaseStatus.loading}
              >
                {supabaseStatus.loading ? "检测中..." : "检测 Supabase 连接"}
              </button>
              <div className="page-card-desc">
                {supabaseStatus.ok === true
                  ? `Supabase: 已连接 · ${supabaseStatus.text}`
                  : supabaseStatus.ok === false
                  ? `Supabase: 未连接 · ${supabaseStatus.text}`
                  : "Supabase: 未检测"}
              </div>
            </div>
            <div className="form-row">
              <button
                className="form-btn"
                type="button"
                onClick={() => {
                  setLogs(readLogs());
                  setRequestLogs(readRequestLogs());
                }}
              >
                刷新
              </button>
              <button className="form-btn ghost" type="button" onClick={handleClearLogs}>
                清空
              </button>
            </div>
            <div className="log-list">
              <div className="log-item">
              <div className="log-title">
                <span>最近 3 次请求（完整内容）</span>
              </div>
                {requestLogs.length === 0 && (
                  <div className="page-card-desc">暂无请求</div>
                )}
                {requestLogs.map((log) => (
                  <div className="log-item" key={log.id}>
                    <div className="log-title">
                      <span>{formatDateTime(log.at)}</span>
                      <span className="log-tag request">request</span>
                    </div>
                    {log.requestJson && <pre className="log-pre">{log.requestJson}</pre>}
                    {(log.responseStatus || log.responseError || log.responseText || log.responseJson) && (
                      <>
                        <div className="log-title">
                          <span>
                            {log.responseAt ? formatDateTime(log.responseAt) : "响应"}
                          </span>
                          <span className="log-tag response">response</span>
                        </div>
                      {log.responseJson ? (
                        <pre className="log-pre">{log.responseJson}</pre>
                      ) : (
                        log.responseText && (
                          <pre className="log-pre">{String(log.responseText)}</pre>
                        )
                      )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        </div>
        </div>
      </div>
      {avatarCropOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setAvatarCropOpen(false)}
        >
          <div className="app-modal rename-modal avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-title">裁剪头像</div>
            <div className="avatar-crop-frame-wrap">
              <div className="avatar-crop-frame">
                {avatarCropSrc && (
                  <img
                    ref={avatarCropImgRef}
                    src={avatarCropSrc}
                    alt="avatar crop"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setAvatarNaturalSize({
                        w: img.naturalWidth || 0,
                        h: img.naturalHeight || 0
                      });
                    }}
                    style={{
                      width: `${avatarCropMetrics.drawW}px`,
                      height: `${avatarCropMetrics.drawH}px`,
                      transform: `translate(${avatarCropX}px, ${avatarCropY}px)`
                    }}
                  />
                )}
              </div>
            </div>
            <div className="form-row avatar-crop-controls">
              <label className="form-label">缩放</label>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={avatarCropZoom}
                onChange={(e) => setAvatarCropZoom(Number(e.target.value))}
              />
              <label className="form-label">左右</label>
              <input
                type="range"
                min={-avatarCropMetrics.maxOffsetX}
                max={avatarCropMetrics.maxOffsetX}
                step="1"
                value={avatarCropX}
                onChange={(e) => setAvatarCropX(Number(e.target.value))}
              />
              <label className="form-label">上下</label>
              <input
                type="range"
                min={-avatarCropMetrics.maxOffsetY}
                max={avatarCropMetrics.maxOffsetY}
                step="1"
                value={avatarCropY}
                onChange={(e) => setAvatarCropY(Number(e.target.value))}
              />
            </div>
            <div className="memory-actions">
              <button className="form-btn ghost" type="button" onClick={() => setAvatarCropOpen(false)}>
                取消
              </button>
              <button className="form-btn" type="button" onClick={handleConfirmAvatarCrop}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
      {memoryMenuIndex != null && showMemoryRename && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowMemoryRename(false);
            setMemoryMenuIndex(null);
            setEditingMemoryIndex(null);
            setEditingMemoryText("");
          }}
        >
          <div className="app-modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-content">
              <div className="rename-title">修改记忆</div>
              <input
                type="text"
                className="input rename-input"
                placeholder="输入新的内容"
                value={editingMemoryText}
                onChange={(e) => setEditingMemoryText(e.target.value)}
              />
              <div className="modal-actions">
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => {
                    setShowMemoryRename(false);
                    setMemoryMenuIndex(null);
                    setEditingMemoryIndex(null);
                    setEditingMemoryText("");
                  }}
                >
                  取消
                </button>
                <button className="btn btn-outline btn-sm" type="button" onClick={handleMemoryRename}>
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteMemoryIndex != null && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDeleteMemoryIndex(null);
          }}
        >
          <div className="app-modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-content">
              <div className="rename-title">确认删除该记忆？</div>
              <div className="modal-actions">
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => setDeleteMemoryIndex(null)}
                >
                  取消
                </button>
                <button className="btn btn-outline btn-sm" type="button" onClick={handleMemoryDelete}>
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HomePage() {
  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="page-title">Kelivo PWA</div>
        <div className="page-sub">选择要进入的页面</div>
      </header>
      <div className="page-grid">
        <a className="page-card" href="#/chat">
          <div className="page-card-title">进入聊天</div>
          <div className="page-card-desc">AI 对话与消息记录</div>
        </a>
        <a className="page-card" href="#/tools">
          <div className="page-card-title">API 工具</div>
          <div className="page-card-desc">API 配置与调试</div>
        </a>
      </div>
    </div>
  );
}

function SessionsPage() {
  const [sessions, setSessions] = useState(() => readSessions());
  const [menuSessionId, setMenuSessionId] = useState(null);
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSessionId, setDeleteSessionId] = useState(null);
  const [query, setQuery] = useState("");
  const [importHint, setImportHint] = useState("");
  const importInputRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    let cancelled = false;
    (async () => {
      const remote = await fetchSessionsFromSupabase();
      if (cancelled) return;
      if (remote.length) {
        writeSessions(remote);
        setSessions(remote);
        notifySessionsUpdate();
      } else {
        const local = readSessions();
        if (local.length) queueSupabaseSync(local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const pressTimerRef = useRef(null);

  const refresh = () => setSessions(readSessions());

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const onSessionsUpdate = () => refresh();
    window.addEventListener("sessions:update", onSessionsUpdate);
    return () =>
      window.removeEventListener("sessions:update", onSessionsUpdate);
  }, []);

  const isMessageLike = (item) =>
    item &&
    typeof item === "object" &&
    (item.role ||
      item.position ||
      item.content ||
      item.text ||
      item.message ||
      item.value);

  const normalizeImportedMessages = (list) => normalizeSessionMessages(list);

  const normalizeImportedSessions = (raw) => {
    if (!raw) return [];
    let candidates = [];
    if (Array.isArray(raw)) {
      const allMsgs = raw.every((item) => isMessageLike(item));
      if (allMsgs) {
        candidates = [{ messages: raw }];
      } else {
        candidates = raw;
      }
    } else if (raw.sessions && Array.isArray(raw.sessions)) {
      candidates = raw.sessions;
    } else if (raw.messages && Array.isArray(raw.messages)) {
      candidates = [
        {
          id: raw.id || raw.uuid,
          title: raw.title || raw.name,
          createdAt: raw.createdAt || raw.created_at,
          updatedAt: raw.updatedAt || raw.updated_at,
          messages: raw.messages
        }
      ];
    } else {
      return [];
    }

    const now = Date.now();
    return candidates
      .map((s, idx) => {
        if (!s) return null;
        const msgs = normalizeImportedMessages(s.messages || s);
        if (!msgs.length) return null;
        const first = msgs[0];
        const last = msgs[msgs.length - 1];
        const sourceCreatedRaw = s.createdAt || s.created_at || s.createdAtIso;
        const sourceCreated =
          typeof sourceCreatedRaw === "number"
            ? sourceCreatedRaw
            : Date.parse(sourceCreatedRaw);
        const sourceUpdatedRaw = s.updatedAt || s.updated_at || s.updatedAtIso;
        const sourceUpdated =
          typeof sourceUpdatedRaw === "number"
            ? sourceUpdatedRaw
            : Date.parse(sourceUpdatedRaw);
        const createdAt = Number.isFinite(sourceCreated)
          ? sourceCreated
          : first?.createdAt || last?.createdAt || now;
        const updatedAt = Number.isFinite(sourceUpdated)
          ? sourceUpdated
          : last?.createdAt || now;
        return {
          id: String(s.id || crypto?.randomUUID?.() || `${now}-${idx}`),
          title: s.title || s.name || `导入对话 ${idx + 1}`,
          messages: msgs,
          createdAt,
          updatedAt
        };
      })
      .filter(Boolean);
  };

  const handleImportFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const parsed = JSON.parse(text);
        const imported = normalizeImportedSessions(parsed);
        if (!imported.length) {
          setImportHint("未识别到可导入的聊天记录");
          return;
        }
        const existing = readSessions();
        const existingIds = new Set(existing.map((s) => String(s.id)));
        const merged = [
          ...imported.map((s) =>
            existingIds.has(String(s.id))
              ? { ...s, id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` }
              : s
          ),
          ...existing
        ];
        setSessions(merged);
        writeSessions(merged);
        notifySessionsUpdate();
        setImportHint(`已导入 ${imported.length} 个对话`);
      } catch (err) {
        setImportHint("导入失败：JSON 格式不正确");
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const handleDelete = (id) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    writeSessions(next);
    deleteSessionFromSupabase(id);
    if (readCurrentSessionId() === id) {
      writeCurrentSessionId(next[0]?.id || "");
    }
    setMenuSessionId(null);
    setShowRename(false);
    setDeleteSessionId(null);
  };

  const handleRename = () => {
    if (!menuSessionId) return;
    const nextTitle = renameValue.trim() || "新对话";
    const next = sessions.map((s) =>
      s.id === menuSessionId ? { ...s, title: nextTitle } : s
    );
    setSessions(next);
    writeSessions(next);
    setMenuSessionId(null);
    setShowRename(false);
    setDeleteSessionId(null);
  };

  const escapeRegExp = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightText = (text, keyword) => {
    if (!keyword) return text;
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, "ig");
    return String(text)
      .split(regex)
      .filter(Boolean)
      .map((part, idx) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <span className="match-highlight" key={`m-${idx}`}>
            {part}
          </span>
        ) : (
          <span key={`t-${idx}`}>{part}</span>
        )
      );
  };

  const buildPreview = (text, keyword) => {
    if (!keyword || !text) return "";
    const raw = String(text);
    const lower = raw.toLowerCase();
    const k = keyword.toLowerCase();
    const idx = lower.indexOf(k);
    if (idx === -1) return "";
    const padding = 24;
    const start = Math.max(0, idx - padding);
    const end = Math.min(raw.length, idx + k.length + padding);
    const snippet = raw.slice(start, end);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < raw.length ? "…" : "";
    return `${prefix}${snippet}${suffix}`;
  };

  const normalizedQuery = query.trim();
  const qLower = normalizedQuery.toLowerCase();

  const filteredSessions = sessions
    .map((s) => {
      if (!normalizedQuery) return { session: s, titleMatch: false, preview: "" };
      const title = (s.title || "").toLowerCase();
      const titleMatch = title.includes(qLower);
      const msgs = Array.isArray(s.messages) ? s.messages : [];
      let preview = "";
      if (!titleMatch) {
        for (const m of msgs) {
          const text = m?.content?.text || "";
          if (text.toLowerCase().includes(qLower)) {
            preview = buildPreview(text, normalizedQuery);
            break;
          }
        }
      }
      return { session: s, titleMatch, preview };
    })
    .filter((item) => {
      if (!normalizedQuery) return true;
      if (item.titleMatch) return true;
      return Boolean(item.preview);
    });

  useEffect(() => {
    if (!menuSessionId || showRename || deleteSessionId) return;
    const onClick = (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".session-dropdown") || target.closest(".session-item.is-active"))
      ) {
        return;
      }
      setMenuSessionId(null);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menuSessionId, showRename, deleteSessionId]);



  return (
    <div className="sessions-shell">
      <div className="navbar bg-base-100 shadow-sm app-navbar">
        <div className="navbar-start">
          <button
            type="button"
            className="btn btn-ghost btn-circle"
            aria-label="返回"
            onClick={() => (window.location.hash = "#/chat")}
          >
            <ArrowBigLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="navbar-center">
          <div className="navbar-title-stack">
            <div className="navbar-title-text">管理历史对话</div>
          </div>
        </div>
        <div className="navbar-end" />
      </div>
      <div className="page-shell">
      <div className="page-card session-card">
        <label className="input session-search-input">
          <Search className="h-[1em] session-search-ico" />
          <input
            type="search"
            className="grow"
            placeholder="搜索聊天记录"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="session-import-row">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => importInputRef.current?.click()}
          >
            导入聊天记录（JSON）
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
          {importHint && <span className="session-import-hint">{importHint}</span>}
        </div>
        <div className="session-list">
          {filteredSessions
            .slice()
            .sort((a, b) => b.session.updatedAt - a.session.updatedAt)
            .map(({ session: s, titleMatch, preview }, idx, arr) => (
              <button
                key={s.id}
                className={`session-item${menuSessionId === s.id ? " is-active" : ""}${idx === arr.length - 1 ? " is-last" : ""}`}
                onClick={() => {
                  if (menuSessionId === s.id) return;
                  writeCurrentSessionId(s.id);
                  window.location.hash = "#/chat";
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuSessionId(s.id);
                  setRenameValue(s.title || "");
                  setShowRename(false);
                }}
                onTouchStart={() => {
                  pressTimerRef.current = setTimeout(() => {
                    setMenuSessionId(s.id);
                    setRenameValue(s.title || "");
                    setShowRename(false);
                  }, 550);
                }}
                onTouchEnd={() => {
                  if (pressTimerRef.current) {
                    clearTimeout(pressTimerRef.current);
                    pressTimerRef.current = null;
                  }
                }}
              >
                <div className="session-date">
                  {formatDateTime(s.updatedAt)}
                </div>
                <div className="session-title">
                  {titleMatch
                    ? highlightText(s.title || "新对话", normalizedQuery)
                    : s.title || "新对话"}
                </div>
                {preview && (
                  <div className="session-preview">
                    {highlightText(preview, normalizedQuery)}
                  </div>
                )}
                {menuSessionId === s.id && !showRename && (
                  <ul
                    className="menu dropdown-content session-dropdown"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <li>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowRename(true);
                          setDeleteSessionId(null);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="session-menu-text">重命名</span>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteSessionId(menuSessionId);
                          setMenuSessionId(null);
                          setShowRename(false);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="session-menu-text">删除</span>
                      </button>
                    </li>
                  </ul>
                )}
              </button>
            ))}
          {filteredSessions.length === 0 && (
            <div className="page-card-desc">暂无会话</div>
          )}
        </div>
      </div>
      </div>
      {menuSessionId && showRename && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowRename(false);
            setMenuSessionId(null);
          }}
        >
          <div className="app-modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-content">
              <div className="rename-title">重命名聊天</div>
              <input
                type="text"
                className="input rename-input"
                placeholder="输入新的标题"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
              <div className="modal-actions">
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => {
                    setShowRename(false);
                    setMenuSessionId(null);
                  }}
                >
                  取消
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={handleRename}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteSessionId && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDeleteSessionId(null);
          }}
        >
          <div className="app-modal rename-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rename-content">
              <div className="rename-title">确认删除该对话？</div>
              <div className="modal-actions">
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => setDeleteSessionId(null)}
                >
                  取消
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => handleDelete(deleteSessionId)}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [settingsReady, setSettingsReady] = useState(() => !isSupabaseEnabled());
  const route = useHashRoute();
  const isChat = route.startsWith("/chat");
  const isSessions = route.startsWith("/sessions");
  const isTools = route.startsWith("/tools");
  const isHome = !isChat && !isSessions && !isTools;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await hydrateSettingsFromSupabase();
        await loadMemoriesFromSupabase();
      } finally {
        if (active) setSettingsReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!settingsReady) {
    return <div className="RouteShell" />;
  }

  return (
    <div className="RouteShell">
      <div className={`RouteView${isChat ? " is-active" : ""}`}>
        <ChatPage />
      </div>
      <div className={`RouteView${isSessions ? " is-active" : ""}`}>
        <SessionsPage />
      </div>
      <div className={`RouteView${isTools ? " is-active" : ""}`}>
        <ToolsPage />
      </div>
      <div className={`RouteView${isHome ? " is-active" : ""}`}>
        <HomePage />
      </div>
    </div>
  );
}
