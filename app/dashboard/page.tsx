"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StudyGoalTree } from "@/lib/types";
import { mockStudyGoalTrees } from "@/lib/mocks/trees";
import PhysicsGraph from "./PhysicsGraph";
import ChatWidget from "./ChatWidget";
import TaskModal from "./TaskModal";
import TaskView from "./TaskView";
import { buildGraphFromClass, getUnitNodeId, type ClassEntry, type ClassNamesPayload, type GraphNode, type GraphLink } from "./utils";
import { getTasks, type Task } from "@/lib/api/tasks";

function MindmapNode({
  label,
  variant = "default",
  children,
}: {
  label: string;
  variant?: "center" | "assignment" | "default";
  children?: React.ReactNode;
}) {
  const base = "rounded-md px-3 py-1.5 font-sans text-xs transition-colors";
  const variants = {
    center: "bg-[#537aad] font-medium text-[#fffbf9]",
    assignment: "border border-[#537aad]/40 bg-[#fffbf9] text-[#537aad]/90",
    default: "border border-[#537aad]/30 bg-[#fffbf9] text-[#537aad]",
  };
  return (
    <div className="flex flex-col items-center gap-4">
      <div className={`${base} ${variants[variant]}`}>{label}</div>
      {children && (
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Connector() {
  return <div className="h-3 w-px bg-[#537aad]/25 sm:h-px sm:w-3 sm:min-w-3" aria-hidden />;
}

function StudyGoalMindmap({ tree }: { tree: StudyGoalTree }) {
  return (
    <div className="flex flex-col items-center">
      <MindmapNode label={tree.name} variant="center">
        <Connector />
        <div className="flex flex-wrap justify-center gap-2">
          {tree.documents.map((d, i) => (
            <MindmapNode key={`doc-${i}`} label={d.name} variant="assignment" />
          ))}
          {tree.links.map((l, i) => (
            <MindmapNode key={`link-${i}`} label={l.title} variant="assignment" />
          ))}
        </div>
      </MindmapNode>
    </div>
  );
}

type DashboardItem =
  | { id: string; label: string; type: "course"; classEntry: ClassEntry }
  | { id: string; label: string; type: "goal"; tree: StudyGoalTree };

export default function DashboardPage() {
  const [studyGoalTrees, setStudyGoalTrees] = useState<StudyGoalTree[]>(mockStudyGoalTrees);
  const [classNamesPayload, setClassNamesPayload] = useState<ClassNamesPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [tasksVersion, setTasksVersion] = useState(0);

  const loadFromStorage = useCallback(() => {
    if (typeof window === "undefined") return;
    const source = localStorage.getItem("knot_onboard_source");
    if (source === "manual") {
      const stored = JSON.parse(localStorage.getItem("knot_study_goals") || "[]");
      setStudyGoalTrees(stored);
      const first = stored[0];
      if (first) setSelectedId(`goal-${first.id}`);
    }
  }, []);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    fetch("/classNames.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load"))))
      .then((data: ClassNamesPayload) => setClassNamesPayload(data))
      .catch(() => setClassNamesPayload({ classes: [] }));
  }, []);

  const syncSelectedId = useCallback(() => {
    const classIds = Array.isArray(classNamesPayload?.classes)
      ? classNamesPayload.classes.map((c, i) => `class-${String(c.courseId ?? c.className)}-${i}`)
      : [];
    const goalIds = studyGoalTrees.map((t) => `goal-${t.id}`);
    const allIds = [...classIds, ...goalIds];
    setSelectedId((prev) => {
      if (prev != null && allIds.includes(prev)) return prev;
      return classIds[0] ?? goalIds[0] ?? null;
    });
    setSelectedUnitId(null);
    if (classIds.length > 0) {
      setExpandedCourseIds((prev) => new Set([...prev, classIds[0]]));
    }
  }, [classNamesPayload, studyGoalTrees]);

  useEffect(() => {
    syncSelectedId();
  }, [syncSelectedId]);

  const allItems: DashboardItem[] = [
    ...(Array.isArray(classNamesPayload?.classes)
      ? classNamesPayload.classes.map((c, i) => ({
          id: `class-${String(c.courseId ?? c.className)}-${i}`,
          label: c.className,
          type: "course" as const,
          classEntry: c,
        }))
      : []),
    ...studyGoalTrees.map((t) => ({
      id: `goal-${t.id}`,
      label: t.name,
      type: "goal" as const,
      tree: t,
    })),
  ];

  const selected = selectedId ? allItems.find((i) => i.id === selectedId) : null;

  const graphData = useMemo(() => {
    if (selected?.type === "course") return buildGraphFromClass(selected.classEntry);
    return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
  }, [selected?.type === "course" ? selected.classEntry : null]);

  // All tasks — load from localStorage only after mount to avoid hydration mismatch
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  useEffect(() => {
    setAllTasks(getTasks());
  }, [tasksVersion]);

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return allTasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [selectedTaskId, allTasks]);

  // Course options for the task modal
  const courseOptions = useMemo(() => {
    return allItems
      .filter((i): i is DashboardItem & { type: "course" } => i.type === "course")
      .map((i) => ({
        courseId: String(i.classEntry.courseId ?? i.classEntry.className),
        className: i.classEntry.className,
        classEntry: i.classEntry,
      }));
  }, [allItems]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8f7f6] font-sans">
      {/* ── Left sidebar ── */}
      <aside className="flex h-full w-[200px] shrink-0 flex-col overflow-hidden bg-white/80 backdrop-blur-sm">
        {/* Brand */}
        <div className="shrink-0 px-5 pb-2 pt-5">
          <Link href="/" className="font-serif text-[1.05rem] tracking-tight text-[#537aad] hover:opacity-80">
            knot.
          </Link>
        </div>

        {/* Nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-4">
          {/* ── Your tasks ── */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a9bc7]">
                Your tasks
              </p>
              <button
                type="button"
                onClick={() => setShowTaskModal(true)}
                className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] text-[#7a9bc7]/60 transition-all hover:bg-[#537aad]/6 hover:text-[#537aad]"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-60">
                  <path d="M5 2v6M2 5h6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Add
              </button>
            </div>
            {allTasks.length === 0 ? (
              <p className="px-2 text-[10px] leading-relaxed text-[#7a9bc7]/50">
                No tasks yet.
              </p>
            ) : (
              <ul className="space-y-px">
                {allTasks.map((t) => {
                  const isTaskSelected = selectedTaskId === t.id;
                  const days = Math.ceil((new Date(t.deadline + "T23:59:59").getTime() - Date.now()) / 86400000);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTaskId(t.id);
                          setSelectedUnitId(null);
                          // Auto-select the task's course
                          const courseItem = allItems.find(
                            (i) => i.type === "course" && String(i.classEntry.courseId ?? i.classEntry.className) === t.courseId
                          );
                          if (courseItem) setSelectedId(courseItem.id);
                        }}
                        title={`${t.name} — ${t.courseName}`}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-[6px] text-left text-[11px] transition-all duration-150 ${
                          isTaskSelected
                            ? "bg-[#537aad]/10 font-medium text-[#537aad]"
                            : "text-[#537aad]/70 hover:bg-[#537aad]/4 hover:text-[#537aad]"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        <span
                          className="ml-1.5 shrink-0 text-[9px] tabular-nums"
                          style={{ color: days < 0 ? "#ef4444" : days <= 3 ? "#f59e0b" : "#7a9bc7" }}
                        >
                          {days < 0 ? "overdue" : days === 0 ? "today" : `${days}d`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mb-3 h-px bg-black/4" />

          {/* ── Your courses ── */}
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7a9bc7]">
            Your courses
          </p>
          {allItems.length === 0 ? (
            <p className="px-2 text-xs leading-relaxed text-[#7a9bc7]">
              {classNamesPayload === null
                ? "Loading..."
                : "No courses yet. Connect Canvas or add a study goal."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {allItems.map((item) => {
                if (item.type === "goal") {
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(item.id);
                          setSelectedUnitId(null);
                          setSelectedTaskId(null);
                        }}
                        title={item.label}
                        className={`w-full truncate rounded-md px-2.5 py-[7px] text-left text-[11px] font-medium leading-snug transition-all duration-150 ${
                          selectedId === item.id
                            ? "bg-[#537aad] text-white shadow-sm"
                            : "text-[#537aad] hover:bg-[#537aad]/6"
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                }
                const classId = item.id;
                const isExpanded = expandedCourseIds.has(classId);
                const isActive = selectedId === classId && !selectedTaskId;
                const hasUnits = Array.isArray(item.classEntry.units) && item.classEntry.units.length > 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(classId);
                        setSelectedUnitId(null);
                        setSelectedTaskId(null);
                        if (hasUnits) {
                          setExpandedCourseIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(classId)) next.delete(classId);
                            else next.add(classId);
                            return next;
                          });
                        }
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-[7px] text-left text-[11px] font-medium leading-snug transition-all duration-150 ${
                        isActive
                          ? "bg-[#537aad] text-white shadow-sm"
                          : "text-[#537aad] hover:bg-[#537aad]/6"
                      }`}
                    >
                      <span className="truncate" title={item.label}>{item.label}</span>
                      {hasUnits && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          className={`shrink-0 ml-1 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""} ${isActive ? "opacity-70" : "opacity-40"}`}
                        >
                          <path d="M4.5 2.5L8 6L4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    {hasUnits && isExpanded && (
                      <ul className="ml-3 mt-0.5 space-y-px border-l border-[#537aad]/10 pl-2.5 pb-1">
                        {item.classEntry.units!.map((unit, i) => {
                          const unitNodeId = getUnitNodeId(item.classEntry, unit, i);
                          const isUnitSelected = selectedUnitId === unitNodeId && !selectedTaskId;
                          return (
                            <li key={unit.unit_id ?? i}>
                              <button
                                type="button"
                                onClick={() => { setSelectedUnitId(unitNodeId); setSelectedTaskId(null); }}
                                title={unit.unit_name ?? "Unit"}
                                className={`block w-full truncate rounded-[5px] px-2 py-[5px] text-left text-[11px] transition-all duration-150 ${
                                  isUnitSelected
                                    ? "bg-[#537aad]/10 font-medium text-[#537aad]"
                                    : "text-[#7a9bc7] hover:bg-[#537aad]/4 hover:text-[#537aad]"
                                }`}
                              >
                                {unit.unit_name ?? "Unit"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Bottom action */}
        <div className="shrink-0 border-t border-black/4 px-3 py-3">
          <Link
            href="/onboard"
            className="flex items-center justify-center gap-1.5 rounded-md bg-[#537aad]/6 px-2.5 py-[7px] text-[11px] font-medium text-[#537aad] transition-all duration-150 hover:bg-[#537aad]/10"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" className="opacity-60">
              <path d="M6 2.5V9.5M2.5 6H9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add course
          </Link>
        </div>
      </aside>

      {/* Sidebar divider with shadow */}
      <div className="w-px bg-black/6" />

      {/* ── Main content ── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f8f7f6]">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 bg-white/60 backdrop-blur-sm px-5 py-3 border-b border-black/4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-[15px] font-normal tracking-tight text-[#537aad]">
              {selected ? selected.label : "Select a course"}
            </h1>
          </div>
          {selected?.type === "course" && (
            <span className="shrink-0 rounded-full bg-[#537aad]/[0.07] px-2.5 py-1 text-[10px] font-medium text-[#7a9bc7]">
              {graphData.nodes.length > 1 ? `${graphData.nodes.length - 1} units` : "No units"}
            </span>
          )}
        </div>

        {/* Graph / Task area */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center rounded-xl bg-white/40">
              <div className="text-center">
                <p className="text-sm text-[#7a9bc7]">Select a course from the sidebar to begin.</p>
              </div>
            </div>
          ) : selectedTask ? (
            <div className="min-h-0 flex-1">
              <TaskView
                task={selectedTask}
                onClose={() => setSelectedTaskId(null)}
                onDeleted={() => {
                  setSelectedTaskId(null);
                  setTasksVersion((v) => v + 1);
                }}
                onEdit={() => {
                  setEditingTask(selectedTask);
                  setShowTaskModal(true);
                }}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              {selected.type === "course" ? (
                <PhysicsGraph
                  graphData={graphData}
                  selectedNodeId={selectedUnitId}
                  onUnitSelect={(id) => { setSelectedUnitId(id); setSelectedTaskId(null); }}
                  courseName={selected.classEntry.className}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl bg-white/40 p-6">
                  <StudyGoalMindmap tree={selected.tree} />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <ChatWidget rightOffset={selectedUnitId && !selectedTaskId ? 340 : 0} />

      {/* Task creation/edit modal */}
      {showTaskModal && courseOptions.length > 0 && (
        <TaskModal
          courses={courseOptions}
          initialCourseId={editingTask?.courseId}
          existingTask={editingTask ?? undefined}
          onClose={() => { setShowTaskModal(false); setEditingTask(null); }}
          onSaved={(task) => {
            setShowTaskModal(false);
            setEditingTask(null);
            setTasksVersion((v) => v + 1);
            setSelectedTaskId(task.id);
            setSelectedUnitId(null);
            // Auto-select the task's course
            const courseItem = allItems.find(
              (i) => i.type === "course" && String(i.classEntry.courseId ?? i.classEntry.className) === task.courseId
            );
            if (courseItem) setSelectedId(courseItem.id);
          }}
        />
      )}
    </div>
  );
}
