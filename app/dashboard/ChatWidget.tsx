"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content: "Hey! Feel free to ask me anything about your classes, learning progression, or study strategies. I have access to all your course data.",
};

const STORAGE_KEY = "knot_unit_test_results_";

/** Gather all mastery data from localStorage to send as context. */
function gatherMasteryData(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const data: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY)) {
        const unitId = key.slice(STORAGE_KEY.length);
        const raw = localStorage.getItem(key);
        if (raw) data[unitId] = JSON.parse(raw);
      }
    }
  } catch { /* ignore */ }
  return data;
}

export default function ChatWidget({ rightOffset = 0 }: { rightOffset?: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.filter((m) => m !== WELCOME_MESSAGE),
          masteryData: gatherMasteryData(),
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  return (
    <>
      {/* Chat panel */}
      {isOpen && (
        <div
          className="fixed bottom-20 z-50 flex h-[460px] w-[360px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/10 border border-black/6 transition-[right] duration-300 ease-out"
          style={{ right: rightOffset + 16 }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#537aad]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </div>
              <span className="text-[12px] font-semibold text-[#537aad]">knot assistant</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 text-[#7a9bc7] transition-colors hover:bg-black/5"
              aria-label="Close chat"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#537aad] text-white rounded-br-md"
                      : "bg-black/3 text-[#2c3e50] rounded-bl-md"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-black/3 px-4 py-3">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7a9bc7]" style={{ animationDelay: "0ms" }} />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7a9bc7]" style={{ animationDelay: "150ms" }} />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7a9bc7]" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-black/5 px-3 py-3">
            <div className="flex items-end gap-2 rounded-xl bg-black/2 border border-black/6 px-3 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                rows={1}
                className="min-h-[20px] max-h-[80px] flex-1 resize-none bg-transparent text-[12px] text-[#2c3e50] placeholder:text-[#7a9bc7]/60 focus:outline-none"
                style={{ lineHeight: "1.5" }}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 ${
                  input.trim() && !isLoading
                    ? "bg-[#537aad] text-white hover:bg-[#46689a] active:scale-95"
                    : "bg-black/4 text-[#7a9bc7]/40 cursor-not-allowed"
                }`}
                aria-label="Send"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        style={{ right: rightOffset + 16 }}
        className={`fixed bottom-4 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-300 ${
          isOpen
            ? "bg-[#537aad]/10 text-[#537aad] shadow-sm rotate-0"
            : "bg-[#537aad] text-white hover:bg-[#46689a] hover:shadow-xl hover:scale-105"
        }`}
        aria-label={isOpen ? "Close chat" : "Open chat"}
      >
        {isOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        )}
      </button>
    </>
  );
}
