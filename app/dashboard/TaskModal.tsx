"use client";

import { useCallback, useMemo, useState } from "react";
import type { ClassEntry } from "./utils";
import { generateId, saveTask, type Task, type TaskUnit } from "@/lib/api/tasks";

type CourseOption = { courseId: string; className: string; classEntry: ClassEntry };

type Props = {
  courses: CourseOption[];
  /** Pre-selected course (for editing) */
  initialCourseId?: string;
  existingTask?: Task;
  onClose: () => void;
  onSaved: (task: Task) => void;
};

export default function TaskModal({ courses, initialCourseId, existingTask, onClose, onSaved }: Props) {
  const [name, setName] = useState(existingTask?.name ?? "");
  const [deadline, setDeadline] = useState(existingTask?.deadline ?? "");
  const [selectedCourseId, setSelectedCourseId] = useState(
    existingTask?.courseId ?? initialCourseId ?? courses[0]?.courseId ?? ""
  );

  const selectedCourse = courses.find((c) => c.courseId === selectedCourseId);
  const units = selectedCourse?.classEntry.units ?? [];

  // Build initial checked set from existing task
  const initialChecked = useMemo(() => {
    const s = new Set<string>();
    if (existingTask) {
      for (const u of existingTask.units) {
        for (const t of u.topics) {
          s.add(t.topicId);
        }
      }
    }
    return s;
  }, [existingTask]);

  const [checkedTopics, setCheckedTopics] = useState<Set<string>>(initialChecked);
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set());

  const handleCourseChange = useCallback((cid: string) => {
    setSelectedCourseId(cid);
    setCheckedTopics(new Set());
    setExpandedUnits(new Set());
  }, []);

  const toggleTopic = useCallback((topicId: string) => {
    setCheckedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }, []);

  const toggleUnit = useCallback(
    (unitIndex: number) => {
      const unit = units[unitIndex];
      if (!unit?.topics?.length) return;
      const topicIds = unit.topics.map((t) => t.topic_id ?? "").filter(Boolean);
      setCheckedTopics((prev) => {
        const next = new Set(prev);
        const allChecked = topicIds.every((id) => next.has(id));
        for (const id of topicIds) {
          if (allChecked) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [units]
  );

  const toggleExpand = useCallback((idx: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const getUnitState = useCallback(
    (unitIndex: number): "none" | "some" | "all" => {
      const unit = units[unitIndex];
      if (!unit?.topics?.length) return "none";
      const topicIds = unit.topics.map((t) => t.topic_id ?? "").filter(Boolean);
      if (topicIds.length === 0) return "none";
      const checked = topicIds.filter((id) => checkedTopics.has(id)).length;
      if (checked === 0) return "none";
      if (checked === topicIds.length) return "all";
      return "some";
    },
    [units, checkedTopics]
  );

  const handleSave = useCallback(() => {
    if (!name.trim() || !deadline || !selectedCourse) return;

    const selectedUnits: TaskUnit[] = [];
    for (const unit of units) {
      if (!unit.topics?.length) continue;
      const selectedTopics = unit.topics
        .filter((t) => checkedTopics.has(t.topic_id ?? ""))
        .map((t) => ({
          topicId: t.topic_id ?? "",
          topicName: t.topic_name ?? "",
          subtopics: (t.subtopics ?? []).map((s) => ({
            subtopicId: s.subtopic_id ?? "",
            subtopicName: s.subtopic_name ?? "",
          })),
        }));
      if (selectedTopics.length > 0) {
        selectedUnits.push({
          unitId: unit.unit_id ?? "",
          unitName: unit.unit_name ?? "Unit",
          topics: selectedTopics,
        });
      }
    }

    if (selectedUnits.length === 0) return;

    const task: Task = {
      id: existingTask?.id ?? generateId(),
      courseId: selectedCourseId,
      courseName: selectedCourse.className,
      name: name.trim(),
      deadline,
      units: selectedUnits,
      createdAt: existingTask?.createdAt ?? new Date().toISOString(),
    };
    saveTask(task);
    onSaved(task);
  }, [name, deadline, units, checkedTopics, selectedCourseId, selectedCourse, existingTask, onSaved]);

  const isValid = name.trim().length > 0 && deadline.length > 0 && checkedTopics.size > 0 && !!selectedCourse;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/20 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="relative mx-4 flex max-h-[85vh] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-4">
          <h2 className="text-[13px] font-semibold text-[#537aad]">
            {existingTask ? "Edit task" : "New task"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#7a9bc7] transition-colors hover:bg-black/5"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#7a9bc7]">Task name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Midterm Exam, HW 3"
              className="w-full rounded-lg border border-black/8 bg-[#f8f7f6] px-3 py-2 text-[12px] text-[#2c3e50] placeholder:text-[#7a9bc7]/50 focus:border-[#537aad]/30 focus:outline-none focus:ring-1 focus:ring-[#537aad]/20"
            />
          </div>

          {/* Deadline */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#7a9bc7]">Deadline</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-lg border border-black/8 bg-[#f8f7f6] px-3 py-2 text-[12px] text-[#2c3e50] focus:border-[#537aad]/30 focus:outline-none focus:ring-1 focus:ring-[#537aad]/20"
            />
          </div>

          {/* Course selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#7a9bc7]">Course</label>
            <select
              value={selectedCourseId}
              onChange={(e) => handleCourseChange(e.target.value)}
              disabled={!!existingTask}
              className="w-full rounded-lg border border-black/8 bg-[#f8f7f6] px-3 py-2 text-[12px] text-[#2c3e50] focus:border-[#537aad]/30 focus:outline-none focus:ring-1 focus:ring-[#537aad]/20 disabled:opacity-50"
            >
              {courses.map((c) => (
                <option key={c.courseId} value={c.courseId}>{c.className}</option>
              ))}
            </select>
          </div>

          {/* Unit/Topic picker */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[#7a9bc7]">
              Select units &amp; topics
            </label>
            {units.length === 0 ? (
              <p className="text-[11px] text-[#7a9bc7]/60">No units available for this course.</p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto rounded-lg border border-black/6 bg-[#f8f7f6]">
                {units.map((unit, i) => {
                  if (!unit.unit_name) return null;
                  const topics = unit.topics ?? [];
                  const state = getUnitState(i);
                  const isExpanded = expandedUnits.has(i);
                  const hasTopic = topics.length > 0;

                  return (
                    <div key={unit.unit_id ?? i} className={i > 0 ? "border-t border-black/4" : ""}>
                      {/* Unit row */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => hasTopic && toggleUnit(i)}
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-black/15 transition-colors hover:border-[#537aad]/40"
                          style={{
                            backgroundColor: state === "all" ? "#537aad" : state === "some" ? "#537aad" : "transparent",
                          }}
                        >
                          {state === "all" && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 5.5L4 7.5L8 3" />
                            </svg>
                          )}
                          {state === "some" && (
                            <div className="h-1.5 w-1.5 rounded-sm bg-white" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpand(i)}
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                        >
                          <span className="truncate text-[11px] font-medium text-[#2c3e50]">{unit.unit_name}</span>
                          {hasTopic && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 10 10"
                              className={`shrink-0 opacity-30 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                            >
                              <path d="M3.5 2L7 5L3.5 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {/* Topics (expanded) */}
                      {isExpanded && hasTopic && (
                        <div className="pb-2 pl-9 pr-3 space-y-0.5">
                          {topics.map((topic) => {
                            const tid = topic.topic_id ?? "";
                            if (!tid || !topic.topic_name) return null;
                            const isChecked = checkedTopics.has(tid);
                            return (
                              <button
                                key={tid}
                                type="button"
                                onClick={() => toggleTopic(tid)}
                                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-black/3"
                              >
                                <div
                                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors"
                                  style={{
                                    borderColor: isChecked ? "#537aad" : "rgba(0,0,0,0.15)",
                                    backgroundColor: isChecked ? "#537aad" : "transparent",
                                  }}
                                >
                                  {isChecked && (
                                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M2 5.5L4 7.5L8 3" />
                                    </svg>
                                  )}
                                </div>
                                <span className="truncate text-[11px] text-[#537aad]/80">{topic.topic_name}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {checkedTopics.size > 0 && (
              <p className="mt-1.5 text-[10px] text-[#7a9bc7]/70">
                {checkedTopics.size} topic{checkedTopics.size !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-[11px] font-medium text-[#7a9bc7] transition-colors hover:bg-black/4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isValid}
            className={`rounded-lg px-4 py-1.5 text-[11px] font-medium transition-all ${
              isValid
                ? "bg-[#537aad] text-white hover:bg-[#46689a] active:scale-[0.98]"
                : "bg-black/6 text-[#7a9bc7]/50 cursor-not-allowed"
            }`}
          >
            {existingTask ? "Save changes" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
