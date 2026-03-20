import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowBigLeft, History, MessageCirclePlus, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const AVATAR_USER =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' rx='20' fill='%231f2a44'/><circle cx='48' cy='38' r='18' fill='%235de4c7'/><rect x='22' y='58' width='52' height='22' rx='11' fill='%2379a8ff'/></svg>";
const AVATAR_ASSISTANT =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' rx='20' fill='%231a2228'/><circle cx='48' cy='40' r='18' fill='%2379a8ff'/><rect x='20' y='60' width='56' height='20' rx='10' fill='%235de4c7'/></svg>";

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
  } catch {}
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

const writeSessions = (sessions) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  } catch {}
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
    try {
      return JSON.parse(readSetting("opt_added_models", "[]"));
    } catch {
      return [];
    }
  });
  const [chatModelId, setChatModelId] = useState(() => readSetting("api_model"));
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const initialMessages = useMemo(
    () => [
      buildMessage({
        role: "assistant",
        text: "你好！在这里输入你的问题。",
        tokens: estimateTokens("你好！在这里输入你的问题。"),
        avatar: assistantAvatar
      })
    ],
    [assistantAvatar]
  );
  const [messages, setMessages] = useState(() =>
    initialMessages.map(ensureMessageId)
  );
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
      .filter((m) => m?.content?.text)
      .map((m) => ({
        role: m.position === "right" ? "user" : "assistant",
        content: sanitizeText(getMessageTextForHistory(m))
      }));

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
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const [chatReady, setChatReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showBackBottom, setShowBackBottom] = useState(false);
  const abortRef = useRef(null);
  const [thinkOpen, setThinkOpen] = useState({});
  const suppressSaveRef = useRef(false);
  const atBottomRef = useRef(true);
  const [sessions, setSessions] = useState(() => {
    const existing = readSessions();
    if (existing.length) return existing;
    const first = {
      id: crypto?.randomUUID?.() || String(Date.now()),
      title: "新对话",
      messages: cloneMessages(initialMessages),
      updatedAt: Date.now()
    };
    writeSessions([first]);
    return [first];
  });
  const [currentSessionId, setCurrentSessionId] = useState(
    () => readCurrentSessionId() || readSessions()[0]?.id || null
  );
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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
      setShowBackBottom(!atBottom);
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [chatReady, messages]);

  useEffect(() => {
    const onHashChange = () => {
      if (!window.location.hash.startsWith("#/chat")) return;
      const storedId = readCurrentSessionId();
      if (storedId && storedId !== currentSessionId) {
        setCurrentSessionId(storedId);
      }
      const storedSessions = readSessions();
      if (storedSessions.length) {
        setSessions(storedSessions);
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
    try {
      setChatModels(JSON.parse(readSetting("opt_added_models", "[]")));
    } catch {
      setChatModels([]);
    }
  }, []);

  useEffect(() => {
    const onClick = (event) => {
      if (!modelMenuOpen) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".navbar")) {
        return;
      }
      setModelMenuOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!currentSessionId) return;
    const storedSessions = readSessions();
    if (storedSessions.length) {
      setSessions(storedSessions);
    }
    const session =
      storedSessions.find((s) => s.id === currentSessionId) ||
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
    if (!currentSessionId) return;
    if (suppressSaveRef.current) return;
    const firstUser = messages.find(
      (m) => m.position === "right" && m?.content?.text
    );
    const baseSessions = sessionsRef.current || [];
    const next = baseSessions.map((s) => {
      if (s.id !== currentSessionId) return s;
      const title =
        s.title === "新对话" && firstUser
          ? sanitizeText(firstUser.content.text).slice(0, 20)
          : s.title;
      return {
        ...s,
        title,
        messages: cloneMessages(messages),
        updatedAt: getLastMessageTime(messages)
      };
    });
    setSessions(next);
    writeSessions(next);
    notifySessionsUpdate();
  }, [messages, currentSessionId]);

  const handleNewSession = () => {
    const next = {
      id: crypto?.randomUUID?.() || String(Date.now()),
      title: "新对话",
      messages: cloneMessages(initialMessages),
      updatedAt: Date.now()
    };
    const updated = [next, ...sessions];
    setSessions(updated);
    writeSessions(updated);
    notifySessionsUpdate();
    suppressSaveRef.current = true;
    setCurrentSessionId(next.id);
    writeCurrentSessionId(next.id);
    resetList(cloneMessages(next.messages));
    setTimeout(() => {
      suppressSaveRef.current = false;
    }, 0);
  };

  const handleAction = (msg, action) => {
    const text = msg?.content?.text ?? "";
    if (action === "copy") {
      navigator.clipboard?.writeText(text);
      showToast("已复制到剪贴板");
      return;
    }
    if (action === "delete") {
      setDeleteTargetId(msg._id);
      return;
    }
    if (action === "edit") {
      setEditingId(msg._id);
      setEditingText(text);
      setEditSheetOpen(true);
      return;
    }
    if (action === "refresh") {
      if (msg?.position === "right") return;
      const idx = messages.findIndex((m) => m._id === msg._id);
      if (idx < 0) return;
      const updatedTarget = storeTailOnVariant(messages, idx);
      const truncated = [
        ...messages.slice(0, idx),
        {
          ...updatedTarget,
          content: { text: getMessageTextForHistory(updatedTarget) }
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
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
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
    let pendingId = targetMsgId || null;
    let pendingCreatedAt = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    try {
      safeSetTyping(true);
      apiUrl = readSetting("api_url");
      apiKey = readSetting("api_key");
      modelId = readSetting("api_model");
      temperature = parseNumber(readSetting("opt_temperature"), undefined);
      topP = parseNumber(readSetting("opt_top_p"), undefined);
      maxTokens = parseNumber(readSetting("opt_max_tokens"), undefined);
      ctxLimit = parseNumber(readSetting("opt_context_limit"), undefined);
      useStream = readSetting("opt_stream") === "true";
      systemPrompt = readSetting("opt_system_prompt");
      template = readSetting("opt_message_template");
      memoryEnabled = readSetting("opt_memory_enabled") === "true";
      try {
        memoryList = JSON.parse(readSetting("opt_memory_list", "[]"));
      } catch {
        memoryList = [];
      }

      if (!modelId) {
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
      if (systemPrompt) {
        messagesPayload.push({ role: "system", content: systemPrompt });
      }
      if (memoryEnabled && memoryList.length) {
        messagesPayload.push({
          role: "system",
          content: `记忆库：\n${memoryList.map((m) => `- ${m}`).join("\n")}`
        });
      }
      if (template) {
        messagesPayload.push({
          role: "system",
          content: `聊天内容模板：\n${template}`
        });
      }
      trimmed.forEach((m) => messagesPayload.push(m));

      const body = {
        model: modelId,
        messages: messagesPayload,
        stream: useStream
      };
      if (typeof temperature === "number") body.temperature = temperature;
      if (typeof topP === "number") body.top_p = topP;
      if (typeof maxTokens === "number") body.max_tokens = maxTokens;

      const pendingMsg = ensureMessageId(
        buildMessage({
          role: "assistant",
          text: "",
          tokens: 0,
          avatar: assistantAvatar,
          createdAt: pendingCreatedAt,
          isPending: true
        })
      );
      if (!pendingId) {
        appendMsg(pendingMsg);
        pendingId = pendingMsg._id;
      }

      const reqLogId = crypto?.randomUUID?.() || String(Date.now());
      appendLog({
        id: reqLogId,
        at: Date.now(),
        type: "request",
        endpoint,
        headers: apiKey ? { Authorization: "Bearer ***" } : {},
        body
      });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!useStream) {
        const rawText = await res.text();
        updateRequestLog(reqLogId, {
          responseAt: Date.now(),
          responseStatus: res.status,
          responseText: rawText
        });
        if (!res.ok) {
          showToast(`HTTP ${res.status}`);
          updateMsg(pendingId, {
            ...pendingMsg,
            content: { text: rawText || `HTTP ${res.status}` },
            isPending: false
          });
          return;
        }
        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          updateMsg(pendingId, {
            ...pendingMsg,
            content: { text: rawText },
            isPending: false
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
        updateMsg(pendingId, {
          ...pendingMsg,
          content: { text: content },
          tokens:
            typeof usageTokens === "number"
              ? usageTokens
              : estimateTokens(content),
          isPending: false
        });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let fullText = "";
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
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
              if (delta) {
                fullText += delta;
                updateMsg(pendingId, {
                  ...pendingMsg,
                  content: { text: fullText },
                  tokens: estimateTokens(fullText),
                  isPending: true
                });
              }
            } catch {
              // ignore
            }
          }
        }
      }

      updateMsg(pendingId, {
        ...pendingMsg,
        content: { text: fullText },
        tokens: estimateTokens(fullText),
        isPending: false
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        showToast("已停止生成");
      } else {
        showToast(err?.message || "请求失败");
      }
    } finally {
      safeSetTyping(false);
      setIsGenerating(false);
    }
  };

  const renderMessageContent = (message) => {
    const { content, position, createdAt, tokens } = message;
    const extracted = extractThinkAndTools(content?.text || "");
    const baseText = extracted.cleanText;
    const thinkText = extracted.thinkText;
    const toolParts = extracted.tools;
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
        <div
          className={`chat-bubble ${
            position === "right" ? "chat-bubble-primary" : ""
          }`}
        >
          {thinkText && (
            <div className="think-card">
              <div className="think-header">
                <span>思考/推理</span>
                <button
                  type="button"
                  className="think-toggle"
                  onClick={() =>
                    setThinkOpen((prev) => ({
                      ...prev,
                      [message._id]: !prev[message._id]
                    }))
                  }
                >
                  {thinkOpen[message._id] ? "收起" : "展开"}
                </button>
              </div>
              {thinkOpen[message._id] && (
                <div className="think-body">
                  <pre>{thinkText}</pre>
                </div>
              )}
            </div>
          )}
          {toolParts.map((t, idx) => (
            <div className="tool-card" key={`${t.name}-${idx}`}>
              <div className="tool-title">
                {t.type === "call" ? "工具调用" : "工具结果"} · {t.name}
              </div>
              <pre className="tool-body">{t.content}</pre>
            </div>
          ))}
          {message.isPending && !baseText && (
            <span className="loading loading-spinner loading-sm" />
          )}
          {baseText && (
            <div className="msg-content msg-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {baseText}
              </ReactMarkdown>
            </div>
          )}
        </div>
        <div className="chat-footer">
          <div className="msg-actions">
            <button
              className="msg-icon"
              onClick={() => handleAction(message, "copy")}
            >
              复制
            </button>
            {position !== "right" && (
              <button
                className="msg-icon"
                onClick={() => handleAction(message, "refresh")}
              >
                刷新
              </button>
            )}
            <button
              className="msg-icon"
              onClick={() => handleAction(message, "edit")}
            >
              编辑
            </button>
            <button
              className="msg-icon"
              onClick={() => handleAction(message, "delete")}
            >
              删除
            </button>
            {variantCount > 1 && (
              <button
                className="msg-icon"
                onClick={() =>
                  switchVariant(
                    message._id,
                    (variantIndex + 1) % variantCount
                  )
                }
              >
                {variantLabel}
              </button>
            )}
          </div>
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
    <div className="ChatPage">
      <div className="navbar bg-base-100 shadow-sm">
        <div className="navbar-start">
          <div className="dropdown">
            <div
              tabIndex={0}
              role="button"
              className="btn btn-ghost btn-circle"
              aria-label="菜单"
            >
              <ArrowBigLeft className="h-5 w-5" />
            </div>
            <ul
              tabIndex={-1}
              className="menu menu-sm dropdown-content bg-base-100 rounded-box z-[50] mt-3 w-52 p-2 shadow"
            >
              <li>
                <button
                  type="button"
                  onClick={() => (window.location.hash = "#/")}
                >
                  主页
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => (window.location.hash = "#/sessions")}
                >
                  会话
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNewSession()}>
                  新对话
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="navbar-center">
          <div className="navbar-title-stack">
            <button
              className="btn btn-ghost text-xl"
              type="button"
              onClick={(event) => {
                const target = event.target;
                if (
                  target instanceof Element &&
                  (target.closest(".model-toggle-btn") ||
                    target.closest(".model-menu"))
                ) {
                  return;
                }
                scrollToTop();
              }}
            >
              {assistantName || "Kelivo Chat"}
            </button>
            <div className="dropdown dropdown-center">
              <button
                type="button"
                className="btn btn-ghost btn-xs chat-model-sub-btn"
                onClick={() => setModelMenuOpen((v) => !v)}
              >
                {chatModelId ? `当前模型：${chatModelId}` : "未选择聊天模型"}
              </button>
              {modelMenuOpen && (
                <ul
                  tabIndex={0}
                  className="menu menu-sm dropdown-content bg-base-100 rounded-box z-[50] mt-2 w-56 p-2 shadow"
                >
                  {chatModels.length === 0 && (
                    <li className="disabled">
                      <a>暂无已添加模型</a>
                    </li>
                  )}
                  {chatModels.map((m) => (
                    <li key={m}>
                      <button
                        type="button"
                        className={chatModelId === m ? "active" : ""}
                        onClick={() => {
                          setChatModelId(m);
                          writeSetting("api_model", m);
                          setModelMenuOpen(false);
                        }}
                      >
                        {m}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
        <textarea
          ref={inputRef}
          className="textarea textarea-bordered w-full composer-input"
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
        <button
          className={`btn ${isGenerating ? "btn-error" : "btn-primary"}`}
          type="button"
          onClick={isGenerating ? handleStopGenerate : handleSend}
          disabled={!isGenerating && !inputValue.trim()}
        >
          {isGenerating ? "停止" : "发送"}
        </button>
      </div>
      {showBackBottom && (
        <button
          className="back-bottom-custom"
          type="button"
          onClick={() => triggerAutoScroll(true)}
        >
          返回底部
        </button>
      )}
      {editSheetOpen && (
        <div
          className="sheet-backdrop"
          onClick={() => {
            setEditSheetOpen(false);
            setEditingId(null);
          }}
        >
          <div className="sheet sheet-edit" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-edit-header">
              <button
                className="sheet-edit-btn ghost"
                type="button"
                onClick={() => {
                  setEditSheetOpen(false);
                  setEditingId(null);
                }}
              >
                取消
              </button>
              <div className="sheet-edit-title">编辑消息</div>
              <button
                className="sheet-edit-btn"
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
                    const truncated = [
                      ...messages.slice(0, targetIndex),
                      nextTarget
                    ];
                    resetList(truncated);

                    const historyList = buildHistoryList(
                      messages.slice(0, targetIndex)
                    );
                    historyList.push({ role: "user", content: nextText });

                    const nextAssistant = messages
                      .slice(targetIndex + 1)
                      .find((m) => m.position === "left");

                    sendChatRequest({
                      historyList,
                      targetMsgId: nextAssistant?._id,
                      appendVariant: true
                    });
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
            </div>
            <textarea
              className="sheet-edit-input"
              value={editingText}
              onChange={(event) => setEditingText(event.target.value)}
              rows={4}
            />
          </div>
        </div>
      )}
      {deleteTargetId && (
        <div
          className="modal-backdrop"
          onClick={() => setDeleteTargetId(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">是否确认删除</div>
            <div className="modal-actions">
              <button
                className="form-btn ghost"
                type="button"
                onClick={() => setDeleteTargetId(null)}
              >
                取消
              </button>
              <button
                className="form-btn"
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
      )}
    </div>
  );
}



function ToolsPage() {
  const [apiUrl, setApiUrl] = useState(() => readSetting("api_url"));
  const [apiKey, setApiKey] = useState(() => readSetting("api_key"));
  const [models, setModels] = useState([]);
  const [addedModels, setAddedModels] = useState(() => {
    try {
      return JSON.parse(readSetting("opt_added_models", "[]"));
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
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("api");
  const [logs, setLogs] = useState(() => readLogs());
  const [requestLogs, setRequestLogs] = useState(() => readRequestLogs());
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
  const [memoryEnabled, setMemoryEnabled] = useState(
    () => readSetting("opt_memory_enabled") === "true"
  );
  const [memoryList, setMemoryList] = useState(() => {
    try {
      return JSON.parse(readSetting("opt_memory_list", "[]"));
    } catch {
      return [];
    }
  });
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingMemoryIndex, setEditingMemoryIndex] = useState(null);
  const [editingMemoryText, setEditingMemoryText] = useState("");

  useEffect(() => {
    if (tab === "logs") {
      setLogs(readLogs());
      setRequestLogs(readRequestLogs());
    }
  }, [tab]);


  const handleSave = () => {
    writeSetting("api_url", apiUrl.trim());
    writeSetting("api_key", apiKey.trim());
    if (modelId) writeSetting("api_model", modelId);
    writeSetting("opt_added_models", JSON.stringify(addedModels));
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
    writeSetting("opt_memory_list", JSON.stringify(memoryList));
    writeSetting("opt_message_template", messageTemplate.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const handleAvatarUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAssistantAvatar(dataUrl);
      writeSetting("opt_assistant_avatar", dataUrl);
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
      setUserAvatar(dataUrl);
      writeSetting("opt_user_avatar", dataUrl);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
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
    if (addedModels.includes(modelCandidate)) return;
    const next = [modelCandidate, ...addedModels];
    setAddedModels(next);
    if (!modelId) {
      setModelId(modelCandidate);
    }
    writeSetting("opt_added_models", JSON.stringify(next));
  };

  const handleRemoveModel = (id) => {
    const next = addedModels.filter((m) => m !== id);
    setAddedModels(next);
    writeSetting("opt_added_models", JSON.stringify(next));
    if (modelId === id) {
      const fallback = next[0] || "";
      setModelId(fallback);
      writeSetting("api_model", fallback);
    }
  };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="page-title">API 工具</div>
        <a className="page-link" href="#/">
          返回主页
        </a>
      </header>
      <div className="tab-bar">
        <button
          className={`tab-btn ${tab === "api" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("api")}
        >
          API 设置
        </button>
        <button
          className={`tab-btn ${tab === "personal" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("personal")}
        >
          个性化
        </button>
        <button
          className={`tab-btn ${tab === "logs" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("logs")}
        >
          日志
        </button>
      </div>

      {tab === "api" && (
        <div className="page-card">
          <div className="page-card-title">API 设置</div>
        <div className="form-row">
          <label className="form-label" htmlFor="apiUrl">
            API URL
          </label>
          <input
            id="apiUrl"
            className="form-input"
            placeholder="https://example.com/v1/chat"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="apiKey">
            API Key
          </label>
          <input
            id="apiKey"
            className="form-input"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <button className="form-btn" type="button" onClick={handleSave}>
          保存
        </button>
        {saved && <div className="form-hint">已保存</div>}
        <div className="form-row">
          <button className="form-btn" type="button" onClick={handleFetchModels}>
            {loadingModels ? "加载中..." : "拉取模型列表"}
          </button>
          {modelError && <div className="form-error">{modelError}</div>}
        </div>
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
            <label className="form-label" htmlFor="modelId">
              默认聊天模型
            </label>
            <select
              id="modelId"
              className="form-input"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                writeSetting("api_model", e.target.value);
              }}
            >
              <option value="">请选择</option>
              {addedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {addedModels.length === 0 && (
              <div className="page-card-desc">请先从拉取的模型里添加</div>
            )}
          </div>
          {addedModels.length > 0 && (
            <div className="form-row">
              <label className="form-label">已添加模型</label>
              <div className="memory-list">
                {addedModels.map((m) => (
                  <div className="memory-item" key={m}>
                    <div className="memory-text">{m}</div>
                    <div className="memory-actions">
                      <button
                        className="form-btn ghost"
                        type="button"
                        onClick={() => handleRemoveModel(m)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="page-card">
          <div className="page-card-title">请求日志</div>
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
                <span className="log-tag request">request</span>
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
                  {log.endpoint && <div className="log-line">URL: {log.endpoint}</div>}
                  {log.headers && (
                    <pre className="log-pre">{JSON.stringify(log.headers, null, 2)}</pre>
                  )}
                  {log.body && (
                    <pre className="log-pre">{JSON.stringify(log.body, null, 2)}</pre>
                  )}
                  {(log.responseStatus || log.responseError || log.responseText || log.responseJson) && (
                    <>
                      <div className="log-title">
                        <span>
                          {log.responseAt ? formatDateTime(log.responseAt) : "响应"}
                        </span>
                        <span className="log-tag response">response</span>
                      </div>
                      {log.responseStatus && (
                        <div className="log-line">Status: {log.responseStatus}</div>
                      )}
                      {log.responseContentType && (
                        <div className="log-line">
                          Content-Type: {log.responseContentType}
                        </div>
                      )}
                      {log.responseError && (
                        <div className="log-line log-error">{log.responseError}</div>
                      )}
                      {log.responseJson && (
                        <pre className="log-pre">
                          {JSON.stringify(log.responseJson, null, 2)}
                        </pre>
                      )}
                      {log.responseText && !log.responseJson && (
                        <pre className="log-pre">{String(log.responseText)}</pre>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          {logs.length === 0 && <div className="page-card-desc">暂无日志</div>}
          <div className="log-list">
            {logs.map((log) => (
              <div className="log-item" key={log.id}>
                <div className="log-title">
                  <span>{formatDateTime(log.at)}</span>
                  <span className={`log-tag ${log.type}`}>{log.type}</span>
                </div>
                {log.endpoint && <div className="log-line">URL: {log.endpoint}</div>}
                {log.message && <div className="log-line">Message: {log.message}</div>}
                {log.apiUrl !== undefined && (
                  <div className="log-line">apiUrl: {String(log.apiUrl)}</div>
                )}
                {log.modelId !== undefined && (
                  <div className="log-line">modelId: {String(log.modelId)}</div>
                )}
                {log.hasApiKey !== undefined && (
                  <div className="log-line">hasApiKey: {String(log.hasApiKey)}</div>
                )}
                {log.useStream !== undefined && (
                  <div className="log-line">useStream: {String(log.useStream)}</div>
                )}
                {log.type === "request" && log.body?.model && (
                  <div className="log-line">Model: {log.body.model}</div>
                )}
                {log.type === "request" && Array.isArray(log.body?.messages) && (
                  <div className="log-line">
                    Messages: {log.body.messages.length}
                  </div>
                )}
                {log.type === "request" && Array.isArray(log.body?.messages) && (
                  <div className="log-line">
                    Last User:{" "}
                    {
                      log.body.messages
                        .filter((m) => m.role === "user")
                        .slice(-1)[0]?.content
                    }
                  </div>
                )}
                {log.status && <div className="log-line">Status: {log.status}</div>}
                {log.error && <div className="log-line log-error">{log.error}</div>}
                {log.body && (
                  <pre className="log-pre">{JSON.stringify(log.body, null, 2)}</pre>
                )}
                {log.text && (
                  <pre className="log-pre">{String(log.text).slice(0, 2000)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}


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
                <div className="memory-item" key={`${item}-${idx}`}>
                  {editingMemoryIndex === idx ? (
                    <>
                      <input
                        className="form-input"
                        value={editingMemoryText}
                        onChange={(e) => setEditingMemoryText(e.target.value)}
                      />
                      <div className="memory-actions">
                        <button
                          className="form-btn"
                          type="button"
                          onClick={() => {
                            const next = [...memoryList];
                            next[idx] = editingMemoryText.trim();
                            setMemoryList(next.filter(Boolean));
                            setEditingMemoryIndex(null);
                            setEditingMemoryText("");
                          }}
                        >
                          保存
                        </button>
                        <button
                          className="form-btn ghost"
                          type="button"
                          onClick={() => {
                            setEditingMemoryIndex(null);
                            setEditingMemoryText("");
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="memory-text">{item}</div>
                      <div className="memory-actions">
                        <button
                          className="form-btn"
                          type="button"
                          onClick={() => {
                            setEditingMemoryIndex(idx);
                            setEditingMemoryText(item);
                          }}
                        >
                          修改
                        </button>
                        <button
                          className="form-btn ghost"
                          type="button"
                          onClick={() => {
                            const next = memoryList.filter((_, i) => i !== idx);
                            setMemoryList(next);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </>
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
                  setMemoryList([val, ...memoryList]);
                  setMemoryDraft("");
                }}
              >
                添加
              </button>
            </div>
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
          <button className="form-btn" type="button" onClick={handleSave}>
            保存
          </button>
          {saved && <div className="form-hint">已保存</div>}
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
  const [query, setQuery] = useState("");
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

  const handleDelete = (id) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    writeSessions(next);
    if (readCurrentSessionId() === id) {
      writeCurrentSessionId(next[0]?.id || "");
    }
    setMenuSessionId(null);
    setShowRename(false);
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
  };

  const filteredSessions = sessions.filter((s) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const title = (s.title || "").toLowerCase();
    if (title.includes(q)) return true;
    const msgs = Array.isArray(s.messages) ? s.messages : [];
    return msgs.some((m) =>
      (m?.content?.text || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-shell">
      <header className="page-header page-header-center">
        <a className="page-link page-link-back" href="#/chat">
          ← 返回
        </a>
        <div className="page-title">会话</div>
      </header>
      <div className="page-card">
        <div className="page-card-title">全部对话</div>
        <div className="session-search">
          <Search className="session-search-icon" />
          <input
            className="form-input form-input-ghost"
            placeholder="搜索聊天记录"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="session-list">
          {filteredSessions
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((s) => (
              <button
                key={s.id}
                className="session-item"
                onClick={() => {
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
                <div className="session-title">{s.title || "新对话"}</div>
              </button>
            ))}
          {filteredSessions.length === 0 && (
            <div className="page-card-desc">暂无会话</div>
          )}
        </div>
      </div>
      {menuSessionId && !showRename && (
        <div
          className="sheet-backdrop"
          onClick={() => setMenuSessionId(null)}
        >
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <button
              className="sheet-item"
              type="button"
              onClick={() => setShowRename(true)}
            >
              重命名
            </button>
            <button
              className="sheet-item danger"
              type="button"
              onClick={() => handleDelete(menuSessionId)}
            >
              删除
            </button>
            <button
              className="sheet-item ghost"
              type="button"
              onClick={() => setMenuSessionId(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {menuSessionId && showRename && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowRename(false);
            setMenuSessionId(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">重命名聊天</div>
            <input
              className="form-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
            <div className="modal-actions">
              <button
                className="form-btn ghost"
                type="button"
                onClick={() => {
                  setShowRename(false);
                  setMenuSessionId(null);
                }}
              >
                取消
              </button>
              <button
                className="form-btn"
                type="button"
                onClick={handleRename}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  const isChat = route.startsWith("/chat");
  const isSessions = route.startsWith("/sessions");
  const isTools = route.startsWith("/tools");
  const isHome = !isChat && !isSessions && !isTools;

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

















