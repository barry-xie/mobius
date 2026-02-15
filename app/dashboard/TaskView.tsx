"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/api/tasks";
import { deleteTask } from "@/lib/api/tasks";
import { getStoredMastery } from "@/lib/api/quiz";
import type { QuizMode } from "@/lib/types/quiz";
import type { UnitEntry } from "./utils";
import Quiz from "./Quiz";

type Props = {
  task: Task;
  onClose: () => void;
  onDeleted: () => void;
  onEdit: () => void;
};

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr + "T23:59:59");
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function deadlineBadge(dateStr: string): { label: string; color: string } {
  const days = daysUntil(dateStr);
  if (days < 0) return { label: "Overdue", color: "#ef4444" };
  if (days === 0) return { label: "Due today", color: "#f59e0b" };
  if (days === 1) return { label: "Due tomorrow", color: "#f59e0b" };
  if (days <= 7) return { label: `${days} days left`, color: "#f59e0b" };
  return { label: `${days} days left`, color: "#10b981" };
}

export default function TaskView({ task, onClose, onDeleted, onEdit }: Props) {
  const [quizMode, setQuizMode] = useState<QuizMode | null>(null);
  const [masteryVersion, setMasteryVersion] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Build a synthetic UnitEntry from task topics for the Quiz component
  const syntheticUnit: UnitEntry = useMemo(() => ({
    unit_id: task.id,
    unit_name: task.name,
    topics: task.units.flatMap((u) =>
      u.topics.map((t) => ({
        topic_id: t.topicId,
        topic_name: t.topicName,
        subtopics: t.subtopics.map((s) => ({
          subtopic_id: s.subtopicId,
          subtopic_name: s.subtopicName,
        })),
      }))
    ),
  }), [task]);

  // Load mastery data for this task
  const mastery = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    masteryVersion; // dependency trigger
    return getStoredMastery(task.id);
  }, [task.id, masteryVersion]);

  const totalTopics = syntheticUnit.topics?.length ?? 0;
  const topicScores = mastery?.topicScores ?? {};
  const avgMastery = totalTopics > 0 && Object.keys(topicScores).length > 0
    ? Math.round(Object.values(topicScores).reduce((a, b) => a + b, 0) / Object.keys(topicScores).length)
    : null;

  const badge = deadlineBadge(task.deadline);

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteTask(task.id);
    onDeleted();
  }, [confirmDelete, task.id, onDeleted]);

  // Reset confirm on blur
  useEffect(() => {
    if (confirmDelete) {
      const t = setTimeout(() => setConfirmDelete(false), 3000);
      return () => clearTimeout(t);
    }
  }, [confirmDelete]);

  if (quizMode) {
    return (
      <Quiz
        courseName={task.courseName}
        unitName={task.name}
        unitId={task.id}
        unitData={syntheticUnit}
        mode={quizMode}
        onClose={() => setQuizMode(null)}
        onComplete={() => {
          setQuizMode(null);
          setMasteryVersion((v) => v + 1);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-white/60 backdrop-blur-sm">
      {/* Header */}
      <div className="shrink-0 border-b border-black/4 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#537aad] opacity-60">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2 className="truncate text-[15px] font-semibold text-[#2c3e50]">{task.name}</h2>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[11px] text-[#7a9bc7]">{formatDate(task.deadline)}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: badge.color }}
              >
                {badge.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-[#7a9bc7] transition-colors hover:bg-black/5"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 4L4 12M4 4l8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Mastery overview */}
        {avgMastery !== null && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a9bc7]">
              Overall mastery
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-black/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${avgMastery}%`,
                    backgroundColor: avgMastery >= 70 ? "#10b981" : avgMastery >= 40 ? "#f59e0b" : "#ef4444",
                  }}
                />
              </div>
              <span className="text-[12px] font-semibold text-[#2c3e50] tabular-nums">{avgMastery}%</span>
            </div>
          </div>
        )}

        {/* Scope */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a9bc7]">
            Scope ({totalTopics} topic{totalTopics !== 1 ? "s" : ""} across {task.units.length} unit{task.units.length !== 1 ? "s" : ""})
          </p>
          <div className="space-y-2">
            {task.units.map((unit) => (
              <div key={unit.unitId} className="rounded-lg border border-black/5 bg-white/80 p-3">
                <p className="text-[11px] font-semibold text-[#2c3e50] mb-1.5">{unit.unitName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {unit.topics.map((topic) => {
                    const score = topicScores[topic.topicId];
                    return (
                      <span
                        key={topic.topicId}
                        className="inline-flex items-center gap-1 rounded-md border border-black/5 bg-[#f8f7f6] px-2 py-1 text-[10px] text-[#537aad]"
                      >
                        {topic.topicName}
                        {score !== undefined && (
                          <span
                            className="ml-0.5 rounded-sm px-1 py-px text-[9px] font-semibold text-white"
                            style={{
                              backgroundColor: score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444",
                            }}
                          >
                            {score}%
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quiz actions */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a9bc7]">
            Study
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setQuizMode("diagnostic")}
              className="flex-1 rounded-lg bg-[#537aad] px-3 py-2.5 text-[11px] font-medium text-white transition-all hover:bg-[#46689a] active:scale-[0.98]"
            >
              {mastery?.testCompleted ? "Retake diagnostic" : "Take diagnostic"}
            </button>
            <button
              type="button"
              onClick={() => setQuizMode("practice")}
              disabled={!mastery?.testCompleted}
              className={`flex-1 rounded-lg px-3 py-2.5 text-[11px] font-medium transition-all ${
                mastery?.testCompleted
                  ? "border border-[#537aad]/20 text-[#537aad] hover:bg-[#537aad]/5 active:scale-[0.98]"
                  : "border border-black/6 text-[#7a9bc7]/40 cursor-not-allowed"
              }`}
            >
              Practice weak topics
            </button>
          </div>
          {!mastery?.testCompleted && (
            <p className="mt-1.5 text-[10px] text-[#7a9bc7]/60">Take a diagnostic first to unlock practice mode.</p>
          )}
        </div>
      </div>

      {/* Footer actions — extra right padding to avoid overlap with chat button */}
      <div className="shrink-0 flex items-center justify-between border-t border-black/4 px-6 py-3 pr-16">
        <button
          type="button"
          onClick={handleDelete}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${
            confirmDelete
              ? "bg-red-50 text-red-600 hover:bg-red-100"
              : "text-[#7a9bc7] hover:bg-black/4"
          }`}
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-[#537aad]/15 px-3 py-1.5 text-[11px] font-medium text-[#537aad] transition-all hover:bg-[#537aad]/5"
        >
          Edit task
        </button>
      </div>
    </div>
  );
}
