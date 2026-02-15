"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type OnboardMode = "canvas" | "manual" | null;

interface DocumentItem {
  name: string;
  file?: File;
}

interface LinkItem {
  title: string;
  url: string;
}

interface CanvasClassItem {
  className: string;
  courseId?: string;
}

const LOADING_PHRASES = [
  "loading...",
  "fetching your courses...",
  "organizing your roadmap...",
  "syncing assignments...",
  "almost there...",
];

export default function OnboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<OnboardMode>(null);
  const [canvasToken, setCanvasToken] = useState("");
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasLoadingPhrase, setCanvasLoadingPhrase] = useState(LOADING_PHRASES[0]);
  const [canvasPreparing, setCanvasPreparing] = useState(false);
  const [canvasError, setCanvasError] = useState("");
  const [fetchedCourses, setFetchedCourses] = useState<CanvasClassItem[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [studyGoalName, setStudyGoalName] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);

  const addDocument = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setDocuments((d) => [...d, ...Array.from(files).map((f) => ({ name: f.name, file: f }))]);
    e.target.value = "";
  };

  const removeDocument = (i: number) => setDocuments((d) => d.filter((_, j) => j !== i));

  const addLink = () => setLinks((l) => [...l, { title: "", url: "" }]);
  const removeLink = (i: number) => setLinks((l) => l.filter((_, j) => j !== i));
  const updateLink = (i: number, field: "title" | "url", value: string) => {
    setLinks((l) => l.map((x, j) => (j === i ? { ...x, [field]: value } : x)));
  };

  useEffect(() => {
    if (!canvasLoading) {
      setCanvasLoadingPhrase(LOADING_PHRASES[0]);
      return;
    }

    const pickPhrase = () => {
      setCanvasLoadingPhrase((prev) => {
        if (LOADING_PHRASES.length <= 1) return prev;
        let next = prev;
        while (next === prev) {
          next = LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)];
        }
        return next;
      });
    };

    pickPhrase();
    const interval = window.setInterval(pickPhrase, 1200);

    return () => window.clearInterval(interval);
  }, [canvasLoading]);

  const handleCanvasSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = canvasToken.trim();
    if (!token) return;

    setCanvasLoading(true);
    setCanvasError("");

    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load Canvas data");
      }

      const classes: CanvasClassItem[] = Array.isArray(data?.classes)
        ? data.classes
            .map((item: unknown) => {
              if (item && typeof item === "object" && "className" in item) {
                const row = item as CanvasClassItem;
                const className = typeof row.className === "string" ? row.className.trim() : "";
                const courseId = typeof row.courseId === "string" ? row.courseId.trim() : "";
                if (className) return { className, ...(courseId && { courseId }) };
              }
              return null;
            })
            .filter((c: CanvasClassItem | null): c is CanvasClassItem => c != null)
        : [];

      if (classes.length === 0) {
        setCanvasError("no courses found. check that your token has access to courses with assignments or files.");
        return;
      }

      const sorted = [...classes].sort((a, b) => a.className.localeCompare(b.className, undefined, { sensitivity: "base" }));
      setFetchedCourses(sorted);
      setSelectedCourseIds(new Set(sorted.map((c) => c.courseId ?? c.className)));
    } catch (err) {
      setCanvasError(err instanceof Error ? err.message : "Failed to load Canvas data");
    } finally {
      setCanvasLoading(false);
    }
  };

  const handleCourseSelectionContinue = async () => {
    const selectedCourses = fetchedCourses.filter((course) => selectedCourseIds.has(course.courseId ?? course.className));
    const selectedIds = selectedCourses.map((course) => course.courseId ?? course.className);
    if (selectedIds.length === 0 || canvasPreparing) return;

    setCanvasPreparing(true);
    setCanvasError("");

    try {
      const res = await fetch("/api/canvas/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseIds: selectedIds,
          courses: selectedCourses.map((course) => ({
            courseId: course.courseId ?? course.className,
            className: course.className,
          })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to prepare course concepts");
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("knot_canvas_token", canvasToken.trim());
        localStorage.setItem("knot_canvas_courses", JSON.stringify(selectedCourses));
        localStorage.setItem("knot_canvas_class_names", JSON.stringify(selectedCourses.map((c: CanvasClassItem) => c.className)));
        localStorage.setItem("knot_onboard_source", "canvas");
      }

      router.push("/dashboard");
    } catch (err) {
      setCanvasError(err instanceof Error ? err.message : "Failed to prepare course concepts");
    } finally {
      setCanvasPreparing(false);
    }
  };

  const toggleCourse = (courseId: string) => {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const selectAllCourses = () => setSelectedCourseIds(new Set(fetchedCourses.map((c) => c.courseId ?? c.className)));
  const deselectAllCourses = () => setSelectedCourseIds(new Set());

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const filteredLinks = links.filter((l) => l.title.trim() && l.url.trim());
    if (!studyGoalName.trim()) return;
    const studyGoal = {
      id: `sg-${Date.now()}`,
      name: studyGoalName.trim(),
      documents: documents.map((d) => ({ name: d.name })),
      links: filteredLinks,
    };
    if (typeof window !== "undefined") {
      const existing = JSON.parse(localStorage.getItem("knot_study_goals") || "[]");
      localStorage.setItem("knot_study_goals", JSON.stringify([...existing, studyGoal]));
      localStorage.setItem("knot_onboard_source", "manual");
    }
    router.push("/dashboard");
  };

  return (
    <div
      className="min-h-screen lowercase font-sans"
      style={{
        background: "linear-gradient(165deg, #fffbf9 0%, #f8f6ff 30%, #fffbf9 60%, #f0eeff 100%)",
      }}
    >
      <header
        className="flex items-center justify-between border-b border-[#537aad]/10 px-5 py-4 sm:px-8 md:px-12"
        style={{ backgroundColor: "color-mix(in srgb, #fffbf9 97%, #537aad 3%)" }}
      >
        <Link href="/" className="font-serif text-[1.05rem] tracking-tight text-[#537aad] transition-opacity hover:opacity-80">
          knot.
        </Link>
        <Link href="/" className="flex items-center gap-1.5 text-sm lowercase text-[#537aad]/80 transition-opacity hover:opacity-100">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          back
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="rounded-2xl border border-[#537aad]/10 bg-[#fffbf9]/80 p-8 shadow-[0_4px_24px_rgba(83,122,173,0.08)] backdrop-blur-sm sm:p-10">
          <h1
            className="font-serif text-2xl font-normal tracking-tight md:text-3xl"
            style={{
              background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            get started
          </h1>
          <p className="mt-2 font-sans text-sm lowercase text-[#537aad]/80">
            choose how you want to connect your learning materials.
          </p>

          {!mode ? (
            <div className="mt-10 flex flex-col gap-4">
              <button
                type="button"
                onClick={() => setMode("canvas")}
                className="group flex flex-col rounded-xl border-2 border-[#537aad]/20 bg-[#fffbf9] p-6 text-left transition-all hover:border-[#537aad]/50 hover:shadow-[0_8px_32px_rgba(83,122,173,0.12)]"
              >
                <span className="font-medium lowercase text-[#537aad]">1. connect with canvas</span>
                <span className="mt-2 text-sm lowercase leading-relaxed text-[#537aad]/70">
                  use your canvas access token to pull classes, assignments, and syllabus into a roadmap.
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                setMode("manual");
                setLinks([{ title: "", url: "" }]);
                setDocuments([]);
              }}
                className="group flex flex-col rounded-xl border-2 border-[#537aad]/20 bg-[#fffbf9] p-6 text-left transition-all hover:border-[#537aad]/50 hover:shadow-[0_8px_32px_rgba(83,122,173,0.12)]"
              >
                <span className="font-medium lowercase text-[#537aad]">2. add materials manually</span>
                <span className="mt-2 text-sm lowercase leading-relaxed text-[#537aad]/70">
                  upload documents and add links. name a study goal and we&apos;ll build a tree for you.
                </span>
              </button>
            </div>
          ) : mode === "canvas" ? (
            fetchedCourses.length > 0 ? (
              <div className="mt-10">
                <div className="rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-5">
                  <h2 className="font-medium lowercase text-[#537aad]">
                    choose courses to display
                  </h2>
                  <p className="mt-1 text-sm lowercase text-[#537aad]/70">
                    select which classes appear on your dashboard. uncheck old or irrelevant courses.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllCourses}
                      className="rounded-lg border border-[#537aad]/30 px-3 py-1.5 text-xs font-medium lowercase text-[#537aad] transition-colors hover:bg-[#537aad]/10"
                    >
                      select all
                    </button>
                    <button
                      type="button"
                      onClick={deselectAllCourses}
                      className="rounded-lg border border-[#537aad]/30 px-3 py-1.5 text-xs font-medium lowercase text-[#537aad] transition-colors hover:bg-[#537aad]/10"
                    >
                      deselect all
                    </button>
                  </div>
                  <ul className="mt-4 max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-2">
                    {fetchedCourses.map((course) => {
                      const id = course.courseId ?? course.className;
                      return (
                        <li key={id}>
                          <label
                            className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-all ${
                              selectedCourseIds.has(id)
                                ? "bg-[#537aad]/10 border border-[#537aad]/25"
                                : "border border-transparent hover:bg-[#537aad]/5"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedCourseIds.has(id)}
                              onChange={() => toggleCourse(id)}
                              className="h-4 w-4 rounded border-[#537aad]/40 accent-[#537aad] focus:ring-2 focus:ring-[#537aad]/30 focus:ring-offset-0"
                            />
                            <span className="text-sm normal-case text-[#537aad]">{course.className}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs lowercase text-[#537aad]/60">
                    {selectedCourseIds.size} of {fetchedCourses.length} selected
                  </p>
                </div>
                <div className="mt-8 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setCanvasError("");
                      setFetchedCourses([]);
                      setSelectedCourseIds(new Set());
                    }}
                    disabled={canvasPreparing}
                    className="flex items-center gap-1.5 rounded-lg border border-[#537aad]/40 px-4 py-2 text-sm font-medium lowercase text-[#537aad] transition-colors hover:bg-[#537aad]/5"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    back
                  </button>
                  <button
                    type="button"
                    onClick={handleCourseSelectionContinue}
                    disabled={selectedCourseIds.size === 0 || canvasPreparing}
                    className="rounded-lg px-4 py-2 text-sm font-medium lowercase text-[#fffbf9] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 100%)" }}
                  >
                    {canvasPreparing ? "preparing concepts..." : "continue to dashboard"}
                  </button>
                </div>
                {canvasError ? <p className="mt-3 text-sm lowercase text-red-600">{canvasError}</p> : null}
              </div>
            ) : (
            <form onSubmit={handleCanvasSubmit} className="mt-10">
              <div className="rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-5">
                <label htmlFor="token" className="block font-medium lowercase text-[#537aad]">
                  canvas access token
                </label>
                <p className="mt-1 text-sm lowercase text-[#537aad]/70">
                  generate one from canvas → profile → settings → approved integrations.
                </p>
                <input
                  id="token"
                  type="password"
                  value={canvasToken}
                  onChange={(e) => setCanvasToken(e.target.value)}
                  placeholder="paste your token here"
                  className="mt-3 w-full rounded-lg border border-[#537aad]/25 bg-[#fffbf9] px-4 py-3 lowercase text-[#537aad] placeholder:text-[#537aad]/50 focus:border-[#537aad] focus:outline-none focus:ring-2 focus:ring-[#537aad]/20"
                  required
                />
                {canvasError ? (
                  <p className="mt-3 text-sm lowercase text-red-600">{canvasError}</p>
                ) : null}
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="flex items-center gap-1.5 rounded-lg border border-[#537aad]/40 px-4 py-2 text-sm font-medium lowercase text-[#537aad] transition-colors hover:bg-[#537aad]/5"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  back
                </button>
                <button
                  type="submit"
                  disabled={canvasLoading}
                  className="rounded-lg bg-[#537aad] px-4 py-2 text-sm font-medium lowercase text-[#fffbf9] transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 100%)" }}
                >
                  {canvasLoading ? canvasLoadingPhrase : "connect and continue"}
                </button>
              </div>
            </form>
            )
          ) : (
            <form onSubmit={handleManualSubmit} className="mt-10">
              <div className="rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-5">
                <label htmlFor="goal" className="block font-medium lowercase text-[#537aad]">
                  study goal name
                </label>
                <input
                  id="goal"
                  type="text"
                  value={studyGoalName}
                  onChange={(e) => setStudyGoalName(e.target.value)}
                  placeholder="e.g. machine learning basics"
                  className="mt-2 w-full rounded-lg border border-[#537aad]/25 bg-[#fffbf9] px-4 py-3 lowercase text-[#537aad] placeholder:text-[#537aad]/50 focus:border-[#537aad] focus:outline-none focus:ring-2 focus:ring-[#537aad]/20"
                  required
                />
              </div>

              <div className="mt-6 rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-5">
                <span className="block font-medium lowercase text-[#537aad]">documents</span>
                <p className="mt-1 text-sm lowercase text-[#537aad]/70">upload files to study from.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={addDocument}
                  className="mt-3 hidden"
                  accept=".pdf,.doc,.docx,.txt,.md"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#537aad]/30 py-4 text-sm lowercase text-[#537aad]/80 transition-colors hover:border-[#537aad]/50 hover:bg-[#537aad]/5 hover:text-[#537aad]"
                >
                  <span>+ upload file</span>
                </button>
                {documents.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {documents.map((d, i) => (
                      <li key={i} className="flex items-center justify-between rounded-lg bg-[#537aad]/5 px-3 py-2">
                        <span className="truncate text-sm lowercase text-[#537aad]">{d.name}</span>
                        <button
                          type="button"
                          onClick={() => removeDocument(i)}
                          className="ml-2 rounded p-1 text-[#537aad]/70 transition-colors hover:bg-[#537aad]/10 hover:text-[#537aad]"
                          aria-label="Remove"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-6 rounded-xl border border-[#537aad]/15 bg-[#fffbf9] p-5">
                <span className="block font-medium lowercase text-[#537aad]">links</span>
                <p className="mt-1 text-sm lowercase text-[#537aad]/70">add urls (youtube, articles, etc.)</p>
                {links.map((l, i) => (
                  <div key={i} className="mt-3 flex gap-2">
                    <input
                      type="text"
                      placeholder="title"
                      value={l.title}
                      onChange={(e) => updateLink(i, "title", e.target.value)}
                      className="flex-1 rounded-lg border border-[#537aad]/25 bg-[#fffbf9] px-4 py-2 text-sm lowercase text-[#537aad] placeholder:text-[#537aad]/50 focus:border-[#537aad] focus:outline-none"
                    />
                    <input
                      type="url"
                      placeholder="url"
                      value={l.url}
                      onChange={(e) => updateLink(i, "url", e.target.value)}
                      className="flex-1 rounded-lg border border-[#537aad]/25 bg-[#fffbf9] px-4 py-2 text-sm lowercase text-[#537aad] placeholder:text-[#537aad]/50 focus:border-[#537aad] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeLink(i)}
                      className="rounded-lg border border-[#537aad]/30 p-2 text-[#537aad]/70 transition-colors hover:bg-[#537aad]/10 hover:text-[#537aad]"
                      aria-label="Remove"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLink}
                  className="mt-3 text-sm lowercase text-[#537aad] underline hover:no-underline"
                >
                  + add link
                </button>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="flex items-center gap-1.5 rounded-lg border border-[#537aad]/40 px-4 py-2 text-sm font-medium lowercase text-[#537aad] transition-colors hover:bg-[#537aad]/5"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  back
                </button>
                <button
                  type="submit"
                  className="rounded-lg px-4 py-2 text-sm font-medium lowercase text-[#fffbf9] transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 100%)" }}
                >
                  create study goal
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
