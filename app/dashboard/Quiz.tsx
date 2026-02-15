"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { QuizQuestion, QuizMode } from "@/lib/types/quiz";
import { generateQuiz, scoreQuiz, mergeMastery, getStoredMastery, saveStoredMastery } from "@/lib/api/quiz";
import type { UnitEntry } from "./utils";

// ─── LaTeX renderer ─────────────────────────────────────────────────────────
function renderLatex(text: string): string {
  // Block math: $$...$$
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<code>${math}</code>`;
    }
  });
  // Inline math: $...$
  result = result.replace(/\$([^$]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code>${math}</code>`;
    }
  });
  return result;
}

function LatexText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderLatex(text), [text]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Quiz component ─────────────────────────────────────────────────────────
export type QuizProps = {
  courseName: string;
  unitName: string;
  unitId: string;
  unitData: UnitEntry;
  mode: QuizMode;
  onClose: () => void;
  onComplete: (topicScores: Record<string, number>) => void;
};

type QuizState = "loading" | "error" | "active" | "results";

export default function Quiz({
  courseName,
  unitName,
  unitId,
  unitData,
  mode,
  onClose,
  onComplete,
}: QuizProps) {
  const [state, setState] = useState<QuizState>("loading");
  const [error, setError] = useState<string>("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [finalTopicScores, setFinalTopicScores] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate quiz on mount
  useEffect(() => {
    let cancelled = false;
    const topics = (unitData.topics ?? []).map((t) => ({
      topicId: t.topic_id ?? t.topic_name ?? "",
      topicName: t.topic_name ?? "Topic",
      subtopics: (t.subtopics ?? []).map((s) => ({
        subtopicId: s.subtopic_id ?? s.subtopic_name ?? "",
        subtopicName: s.subtopic_name ?? "",
      })),
    }));

    const existing = getStoredMastery(unitId);

    generateQuiz({
      courseName,
      unitName,
      topics,
      mode,
      topicScores: mode === "practice" ? existing?.topicScores : undefined,
    })
      .then((qs) => {
        if (cancelled) return;
        setQuestions(qs);
        setAnswers(new Array(qs.length).fill(null));
        setState("active");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? "Failed to generate quiz");
        setState("error");
      });

    return () => { cancelled = true; };
  }, [courseName, unitName, unitId, unitData, mode]);

  const currentQ = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;
  const answeredCount = answers.filter((a) => a !== null).length;

  const handleSelect = useCallback((optIdx: number) => {
    if (showExplanation) return; // locked after confirm
    setSelectedOption(optIdx);
  }, [showExplanation]);

  const handleConfirm = useCallback(() => {
    if (selectedOption === null) return;
    setShowExplanation(true);
    setAnswers((prev) => {
      const next = [...prev];
      next[currentIdx] = selectedOption;
      return next;
    });
  }, [selectedOption, currentIdx]);

  const handleNext = useCallback(() => {
    if (isLast) {
      // Finish quiz
      const finalAnswers = [...answers];
      finalAnswers[currentIdx] = selectedOption ?? 0;
      const { score, topicScores: ts } = scoreQuiz(questions, finalAnswers as number[]);

      // Merge with existing mastery
      const existing = getStoredMastery(unitId);
      const merged = mergeMastery(existing?.topicScores, ts, mode);
      saveStoredMastery(unitId, merged);

      setFinalScore(score);
      setFinalTopicScores(merged);
      setState("results");
      onComplete(merged);
    } else {
      setCurrentIdx((i) => i + 1);
      setSelectedOption(null);
      setShowExplanation(false);
    }
  }, [isLast, answers, currentIdx, selectedOption, questions, unitId, mode, onComplete]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="relative flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a9bc7]">
              {mode === "diagnostic" ? "Diagnostic" : "Practice"}: {unitName}
            </p>
            {state === "active" && (
              <p className="mt-0.5 text-[11px] text-[#7a9bc7]">
                Question {currentIdx + 1} of {questions.length}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-[#7a9bc7] transition-colors hover:bg-black/5"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 4L4 12M4 4l8 8" />
            </svg>
          </button>
        </div>

        {/* ── Progress bar ── */}
        {state === "active" && (
          <div className="h-1 w-full bg-black/3">
            <div
              className="h-full bg-[#537aad] transition-[width] duration-300"
              style={{ width: `${((currentIdx + (showExplanation ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>
        )}

        {/* ── Content ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* Loading */}
          {state === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#537aad]/20 border-t-[#537aad]" />
              <p className="text-[12px] text-[#7a9bc7]">Generating questions...</p>
            </div>
          )}

          {/* Error */}
          {state === "error" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <p className="text-[12px] font-medium text-red-500">Failed to generate quiz</p>
              <p className="max-w-xs text-center text-[11px] text-[#7a9bc7]">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-lg bg-[#537aad] px-4 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#46689a]"
              >
                Close
              </button>
            </div>
          )}

          {/* Active question */}
          {state === "active" && currentQ && (
            <div className="flex flex-col gap-5">
              {/* Topic tag */}
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[#537aad]/[0.07] px-2.5 py-0.5 text-[10px] font-medium text-[#537aad]">
                  {currentQ.topicName}
                </span>
                {currentQ.subtopicName && (
                  <span className="rounded-full bg-black/4 px-2.5 py-0.5 text-[10px] text-[#7a9bc7]">
                    {currentQ.subtopicName}
                  </span>
                )}
              </div>

              {/* Question */}
              <h2 className="text-[14px] font-medium leading-relaxed text-[#2c3e50]">
                <LatexText text={currentQ.question} />
              </h2>

              {/* Options */}
              <div className="flex flex-col gap-2">
                {currentQ.options.map((opt, i) => {
                  const letter = String.fromCharCode(65 + i);
                  const isSelected = selectedOption === i;
                  const isCorrect = i === currentQ.correctIndex;

                  let optClass = "border-black/8 bg-white text-[#2c3e50] hover:border-[#537aad]/30 hover:bg-[#537aad]/[0.02]";
                  if (showExplanation) {
                    if (isCorrect) {
                      optClass = "border-emerald-400 bg-emerald-50 text-emerald-800";
                    } else if (isSelected && !isCorrect) {
                      optClass = "border-red-300 bg-red-50 text-red-700";
                    } else {
                      optClass = "border-black/5 bg-black/[0.01] text-[#7a9bc7]";
                    }
                  } else if (isSelected) {
                    optClass = "border-[#537aad] bg-[#537aad]/4 text-[#537aad] ring-1 ring-[#537aad]/20";
                  }

                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelect(i)}
                      disabled={showExplanation}
                      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${optClass} ${showExplanation ? "cursor-default" : "cursor-pointer"}`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                        showExplanation && isCorrect
                          ? "bg-emerald-500 text-white"
                          : showExplanation && isSelected && !isCorrect
                          ? "bg-red-400 text-white"
                          : isSelected
                          ? "bg-[#537aad] text-white"
                          : "bg-black/5 text-[#7a9bc7]"
                      }`}>
                        {letter}
                      </span>
                      <span className="text-[12px] leading-relaxed">
                        <LatexText text={opt} />
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Explanation */}
              {showExplanation && currentQ.explanation && (
                <div className="rounded-xl bg-[#537aad]/4 border border-[#537aad]/10 px-4 py-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#537aad]">Explanation</p>
                  <p className="text-[12px] leading-relaxed text-[#4a5568]">
                    <LatexText text={currentQ.explanation} />
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {state === "results" && (
            <div className="flex flex-col gap-6">
              {/* Score circle */}
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#537aad]/20">
                  <span className="text-2xl font-bold tabular-nums text-[#537aad]">{finalScore}%</span>
                </div>
                <p className="text-[12px] font-medium text-[#537aad]">
                  {finalScore >= 70 ? "Great work!" : finalScore >= 40 ? "Good effort — keep practicing!" : "Don't worry — practice makes perfect"}
                </p>
              </div>

              {/* Per-topic breakdown */}
              <div>
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7a9bc7]">
                  Topic Mastery
                </h3>
                <div className="space-y-2.5">
                  {(unitData.topics ?? []).map((topic) => {
                    const tid = topic.topic_id ?? topic.topic_name ?? "";
                    const score = finalTopicScores[tid] ?? 0;
                    const barColor = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
                    return (
                      <div key={tid}>
                        <div className="mb-1 flex items-baseline justify-between">
                          <span className="text-[11px] font-medium text-[#2c3e50]">{topic.topic_name}</span>
                          <span className="text-[10px] font-semibold tabular-nums" style={{ color: barColor }}>
                            {score}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/4">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${score}%`, background: barColor }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Advice */}
              {finalScore < 70 && (
                <p className="text-center text-[11px] text-[#7a9bc7]">
                  Try generating practice questions to target your weak topics.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div className="shrink-0 border-t border-black/5 px-6 py-4">
          {state === "active" && !showExplanation && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedOption === null}
              className={`w-full rounded-xl py-2.5 text-[12px] font-semibold transition-all duration-150 ${
                selectedOption !== null
                  ? "bg-[#537aad] text-white shadow-sm hover:bg-[#46689a] active:scale-[0.98]"
                  : "bg-black/4 text-[#7a9bc7] cursor-not-allowed"
              }`}
            >
              Confirm
            </button>
          )}
          {state === "active" && showExplanation && (
            <button
              type="button"
              onClick={handleNext}
              className="w-full rounded-xl bg-[#537aad] py-2.5 text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[#46689a] active:scale-[0.98]"
            >
              {isLast ? "See results" : "Next question"}
            </button>
          )}
          {state === "results" && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-[#537aad] py-2.5 text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[#46689a] active:scale-[0.98]"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
