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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  Wrench,
  BookHeart,
  FileClock
} from "lucide-react";
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
    messages: cloneMessages(s.messages || [])
  }));

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

const normalizeMemoryList = (raw) => {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const normalized = raw
    .map((item) => {
      if (typeof item === "string") {
        const content = item.trim();
        if (!content) return null;
        return { content, updatedAt: now };
      }
      if (item && typeof item === "object") {
        const content = String(item.content ?? item.text ?? "").trim();
        if (!content) return null;
        const rawTime =
          item.updatedAt ??
          item.updated_at ??
          item.createdAt ??
          item.created_at;
        let updatedAt =
          typeof rawTime === "number" ? rawTime : Date.parse(rawTime);
        if (!Number.isFinite(updatedAt)) updatedAt = now;
        return { content, updatedAt };
      }
      return null;
    })
    .filter(Boolean);
  return normalized;
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
    const onModelsUpdate = () => {
      setChatModelId(readSetting("api_model"));
      try {
        setChatModels(JSON.parse(readSetting("opt_added_models", "[]")));
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
      if (target instanceof Element && target.closest(".navbar")) {
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

  useEffect(() => {
    if (!currentSessionId) return;
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
    const updated = [next, ...(sessionsRef.current || [])];
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
        memoryList = normalizeMemoryList(
          JSON.parse(readSetting("opt_memory_list", "[]"))
        );
      } catch {
        memoryList = [];
      }
      searchEnabled = readSetting("opt_search_enabled") === "true";
      mcpEnabled = readSetting("opt_mcp_enabled") === "true";
      mcpUrl = readSetting("mcp_url");
      mcpApiKey = readSetting("mcp_api_key");
      webSearchUrl = readSetting("web_search_url");
      webSearchApiKey = readSetting("web_search_api_key");

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
                `<id>${idx + 1}</id>`,
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

      const readMemoryList = () => {
        try {
          return normalizeMemoryList(
            JSON.parse(readSetting("opt_memory_list", "[]"))
          );
        } catch {
          return [];
        }
      };

      const writeMemoryList = (list) => {
        writeSetting("opt_memory_list", JSON.stringify(list));
        window.dispatchEvent(new Event("memory:update"));
      };

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
          const list = readMemoryList();
          list.unshift({ content, updatedAt: Date.now() });
          writeMemoryList(list);
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(
              { ok: true, id: 1, content },
              null,
              2
            )
          };
        }

        if (name === "edit_memory") {
          const idRaw = args?.id;
          const content = String(args?.content || "").trim();
          const list = readMemoryList();
          const idx = Number.isFinite(Number(idRaw)) ? Number(idRaw) - 1 : -1;
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
          if (idx < 0 || idx >= list.length) {
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
          writeMemoryList(list);
          return {
            tool_call_id: toolCall?.id,
            name,
            content: JSON.stringify(
              { ok: true, id: idx + 1, before, after: content },
              null,
              2
            )
          };
        }

        if (name === "delete_memory") {
          const idRaw = args?.id;
          const list = readMemoryList();
          let removed = null;
          const idx = Number.isFinite(Number(idRaw)) ? Number(idRaw) - 1 : -1;
          if (idx >= 0 && idx < list.length) {
            removed = { id: idx + 1, content: list[idx].content };
            list.splice(idx, 1);
            writeMemoryList(list);
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
        model: modelId,
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
    <div className="ChatPage bg-base-100">
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
            <div className="dropdown dropdown-center">
              <div
                tabIndex={0}
                role="button"
                className="btn m-1 chat-model-sub-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setModelMenuOpen((v) => !v);
                }}
              >
                <span className="chat-model-label">
                  {chatModelId || "未选择聊天模型"}
                </span>
                <ChevronDown className="h-3 w-3 chat-model-caret" />
              </div>
              <ul
                tabIndex={-1}
                className="dropdown-content menu bg-base-100 rounded-box z-[50] mt-2 w-56 p-2 shadow-sm"
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
                        emitModelsUpdate();
                      }}
                    >
                      {m}
                    </button>
                  </li>
                ))}
              </ul>
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
        <div className="fab composer-fab">
          <div
            tabIndex={0}
            role="button"
            className="btn btn-circle btn-secondary composer-fab-main"
          >
            <svg
              aria-label="New"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              className="size-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          </div>
          <button className="btn btn-circle composer-fab-item" type="button">
            <svg
              aria-label="Camera"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
              />
            </svg>
          </button>
          <button className="btn btn-circle composer-fab-item" type="button">
            <svg
              aria-label="Gallery"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
          </button>
          <button className="btn btn-circle composer-fab-item" type="button">
            <svg
              aria-label="Voice"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
              />
            </svg>
          </button>
        </div>
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
  const [mcpUrl, setMcpUrl] = useState(() => readSetting("mcp_url"));
  const [mcpApiKey, setMcpApiKey] = useState(() => readSetting("mcp_api_key"));
  const [webSearchUrl, setWebSearchUrl] = useState(() => readSetting("web_search_url"));
  const [webSearchApiKey, setWebSearchApiKey] = useState(() =>
    readSetting("web_search_api_key")
  );
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
  const [searchEnabled, setSearchEnabled] = useState(
    () => readSetting("opt_search_enabled") !== "false"
  );
  const [mcpEnabled, setMcpEnabled] = useState(
    () => readSetting("opt_mcp_enabled") === "true"
  );
  const [memoryEnabled, setMemoryEnabled] = useState(
    () => readSetting("opt_memory_enabled") === "true"
  );
  const [memoryList, setMemoryList] = useState(() => {
    try {
      return normalizeMemoryList(JSON.parse(readSetting("opt_memory_list", "[]")));
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
      try {
        setAddedModels(JSON.parse(readSetting("opt_added_models", "[]")));
      } catch {
        setAddedModels([]);
      }
      setModelId(readSetting("api_model"));
    };
    window.addEventListener("models:update", onModelsUpdate);
    return () => window.removeEventListener("models:update", onModelsUpdate);
  }, []);

  useEffect(() => {
    const onMemoryUpdate = () => {
      try {
        setMemoryList(
          normalizeMemoryList(JSON.parse(readSetting("opt_memory_list", "[]")))
        );
      } catch {
        setMemoryList([]);
      }
    };
    window.addEventListener("memory:update", onMemoryUpdate);
    return () => window.removeEventListener("memory:update", onMemoryUpdate);
  }, []);


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
    writeSetting("opt_search_enabled", searchEnabled ? "true" : "false");
    writeSetting("opt_mcp_enabled", mcpEnabled ? "true" : "false");
    writeSetting("mcp_url", mcpUrl.trim());
    writeSetting("mcp_api_key", mcpApiKey.trim());
    writeSetting("web_search_url", webSearchUrl.trim());
    writeSetting("web_search_api_key", webSearchApiKey.trim());
    setSaved(true);
    emitModelsUpdate();
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
    emitModelsUpdate();
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
    emitModelsUpdate();
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
      <div className="tabs tabs-lift">
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
        <div className="tab-content bg-base-100 border-base-300 p-4">
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
        <div className="form-row">
          <label className="form-label" htmlFor="mcpUrl">
            MCP 地址
          </label>
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
          <label className="form-label" htmlFor="mcpApiKey">
            MCP Key
          </label>
          <input
            id="mcpApiKey"
            className="form-input"
            placeholder="可选"
            value={mcpApiKey}
            onChange={(e) => setMcpApiKey(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="webSearchUrl">
            搜索地址
          </label>
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
          <label className="form-label" htmlFor="webSearchApiKey">
            搜索 Key
          </label>
          <input
            id="webSearchApiKey"
            className="form-input"
            placeholder="可选"
            value={webSearchApiKey}
            onChange={(e) => setWebSearchApiKey(e.target.value)}
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
                emitModelsUpdate();
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
        <div className="tab-content bg-base-100 border-base-300 p-4">
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
                  <div className="memory-item" key={`${item.content}-${idx}`}>
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
                              const content = editingMemoryText.trim();
                              if (content) {
                                next[idx] = {
                                  ...next[idx],
                                  content,
                                  updatedAt: Date.now()
                                };
                              }
                              setMemoryList(next.filter((m) => m?.content));
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
                        <div className="memory-text">{item.content}</div>
                        <div className="memory-time">
                          {formatDateTime(item.updatedAt)}
                        </div>
                        <div className="memory-actions">
                          <button
                            className="form-btn"
                            type="button"
                            onClick={() => {
                              setEditingMemoryIndex(idx);
                              setEditingMemoryText(item.content);
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
                    setMemoryList([{ content: val, updatedAt: Date.now() }, ...memoryList]);
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
        <div className="tab-content bg-base-100 border-base-300 p-4">
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
