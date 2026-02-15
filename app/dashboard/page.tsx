"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CourseTree, StudyGoalTree, TreeItem } from "@/lib/types";
import { mockCourseTrees, mockStudyGoalTrees } from "@/lib/mocks/trees";
import PhysicsGraph from "./PhysicsGraph";
import { buildGraphFromClass, type ClassEntry, type ClassNamesPayload } from "./utils";

interface CanvasClassItem {
  className: string;
}

function buildCanvasCourseTrees(classNames: string[]): CourseTree[] {
  return classNames.map((name, index) => ({
    source: "canvas",
    course: {
      id: index + 1,
      name,
      course_code: name,
      syllabus_body: null,
      workflow_state: "available",
    },
    modules: [],
    assignments: [],
  }));
}

function parseStoredClassNames(rawValue: string | null): string[] {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    if (Array.isArray(parsed)) {
      return parsed
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(Boolean);
    }

    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { classes?: unknown }).classes)) {
      return ((parsed as { classes: unknown[] }).classes as unknown[])
        .map((item) => {
          if (item && typeof item === "object" && "className" in item) {
            const className = (item as CanvasClassItem).className;
            return typeof className === "string" ? className.trim() : "";
          }
          return "";
        })
        .filter(Boolean);
    }

    return [];
  } catch {
    return [];
  }
}

function MindmapNode({
  label,
  variant = "default",
  children,
}: {
  label: string;
  variant?: "center" | "assignment" | "default";
  children?: React.ReactNode;
}) {
  const base = "rounded-lg px-4 py-2 font-sans text-sm transition-colors";
  const variants = {
    center: "bg-[#537aad] font-medium text-[#fffbf9]",
    assignment: "border border-[#537aad]/40 bg-[#fffbf9] text-[#537aad]/90",
    default: "border border-[#537aad]/30 bg-[#fffbf9] text-[#537aad]",
  };
  return (
    <div className="flex flex-col items-center gap-4">
      <div className={`${base} ${variants[variant]}`}>{label}</div>
      {children && (
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {children}
        </div>
      )}
    </div>
  );
}

function Connector() {
  return <div className="h-4 w-px bg-[#537aad]/25 sm:h-px sm:w-4 sm:min-w-4" aria-hidden />;
}

function StudyGoalMindmap({ tree }: { tree: StudyGoalTree }) {
  return (
    <div className="flex flex-col items-center">
      <MindmapNode label={tree.name} variant="center">
        <Connector />
        <div className="flex flex-wrap justify-center gap-3">
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
  | { id: string; label: string; type: "course"; classEntry: ClassEntry; courseTree?: CourseTree }
  | { id: string; label: string; type: "goal"; tree: StudyGoalTree };

export default function DashboardPage() {
  const [courseTrees, setCourseTrees] = useState<CourseTree[]>(mockCourseTrees);
  const [studyGoalTrees, setStudyGoalTrees] = useState<StudyGoalTree[]>(mockStudyGoalTrees);
  const [classNamesPayload, setClassNamesPayload] = useState<ClassNamesPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadFromStorage = useCallback(async () => {
    if (typeof window === "undefined") return;
    const source = localStorage.getItem("knot_onboard_source");
    if (source === "canvas") {
      const canvasTrees = buildCanvasCourseTrees(
        parseStoredClassNames(localStorage.getItem("knot_canvas_class_names") ?? "[]")
      );
      setCourseTrees(canvasTrees);
      const first = canvasTrees[0];
      if (first) setSelectedId(`course-${first.course.id}`);
    } else if (source === "manual") {
      const stored = JSON.parse(localStorage.getItem("knot_study_goals") || "[]");
      setStudyGoalTrees(stored);
      const first = stored[0];
      if (first) setSelectedId(`goal-${first.id}`);
    } else {
      setSelectedId(`course-${mockCourseTrees[0]?.course.id ?? ""}`);
    }
  }, []);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    fetch("/classNames.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load"))))
      .then((data: ClassNamesPayload) => setClassNamesPayload(data))
      .catch(() => setClassNamesPayload(null));
  }, []);

  useEffect(() => {
    if (!classNamesPayload?.classes?.length) return;
    const firstClassId = `class-${classNamesPayload.classes[0].courseId ?? classNamesPayload.classes[0].className}-0`;
    setSelectedId((prev) => {
      const validIds = new Set(
        classNamesPayload.classes.map((c, i) => `class-${c.courseId ?? c.className}-${i}`)
      );
      return prev != null && validIds.has(prev) ? prev : firstClassId;
    });
  }, [classNamesPayload?.classes?.length]);

  const allItems: DashboardItem[] = [
    ...(classNamesPayload?.classes?.length
      ? classNamesPayload.classes.map((c, i) => ({
          id: `class-${c.courseId ?? c.className}-${i}`,
          label: c.className,
          type: "course" as const,
          classEntry: c,
        }))
      : courseTrees.map((t) => ({
          id: `course-${t.course.id}`,
          label: t.course.course_code || t.course.name,
          type: "course" as const,
          classEntry: { className: t.course.course_code || t.course.name },
          courseTree: t,
        }))),
    ...studyGoalTrees.map((t) => ({
      id: `goal-${t.id}`,
      label: t.name,
      type: "goal" as const,
      tree: t,
    })),
  ];

  const selected = selectedId ? allItems.find((i) => i.id === selectedId) : null;

  return (
    <div className="flex min-h-screen bg-[#fffbf9] font-sans">
      {/* Sidebar */}
      <aside
        className="flex w-56 shrink-0 flex-col border-r border-[#537aad]/10 bg-[#fffbf9]"
        style={{ backgroundColor: "color-mix(in srgb, #fffbf9 99%, #537aad 1%)" }}
      >
        <div className="flex items-center justify-between border-b border-[#537aad]/10 px-4 py-4">
          <Link href="/" className="font-serif text-[1.05rem] tracking-tight text-[#537aad] hover:opacity-80">
            knot.
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-[#537aad]/60">
            courses & goals
          </p>
          {allItems.length === 0 ? (
            <p className="px-2 text-sm text-[#537aad]/60">no items yet. complete onboarding first.</p>
          ) : (
            <ul className="space-y-1">
              {allItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === item.id
                        ? "bg-[#537aad] text-[#fffbf9]"
                        : "text-[#537aad] hover:bg-[#537aad]/10"
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="border-t border-[#537aad]/10 p-3">
          <Link
            href="/onboard"
            className="block rounded-lg border border-[#537aad]/40 px-3 py-2 text-center text-sm text-[#537aad] transition-colors hover:bg-[#537aad]/5"
          >
            add course or goal
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="border-b border-[#537aad]/10 px-6 py-4 sm:px-8">
          <h1 className="font-serif text-xl font-normal tracking-tight text-[#537aad] md:text-2xl">
            {selected ? selected.label : "select a course or goal"}
          </h1>
          <p className="mt-1 font-sans text-sm text-[#537aad]/80">
            {selected?.type === "course"
              ? "course at center, units and concepts orbit"
              : "documents and links for your study goal"}
          </p>
        </div>

        <div className="p-6 sm:p-8 md:p-10">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-[#537aad]/30 bg-[#fffbf9] p-12 text-center">
              <p className="text-[#537aad]/70">select a course or study goal from the sidebar.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-4 sm:p-6 md:p-8">
              {selected.type === "course" ? (
                <div className="min-h-[500px] h-[60vh]">
                  <PhysicsGraph graphData={buildGraphFromClass(selected.classEntry)} />
                </div>
              ) : (
                <StudyGoalMindmap tree={selected.tree} />
              )}
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-6 font-sans text-sm text-[#537aad]/80">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-md bg-[#537aad]" />
              topic / unit
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-md border border-[#537aad]/40" />
              assignment / exam
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
