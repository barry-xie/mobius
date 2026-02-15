import type { QuizRequest, QuizQuestion, QuizResult } from "@/lib/types/quiz";

const STORAGE_PREFIX = "knot_unit_test_results_";

/** Call the quiz generation API. */
export async function generateQuiz(req: QuizRequest): Promise<QuizQuestion[]> {
  const res = await fetch("/api/quiz/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Quiz generation failed (${res.status})`);
  }
  const data = await res.json();
  return data.questions as QuizQuestion[];
}

/** Score a completed quiz and compute per-topic mastery. */
export function scoreQuiz(
  questions: QuizQuestion[],
  answers: number[]
): { score: number; topicScores: Record<string, number> } {
  if (questions.length === 0) return { score: 0, topicScores: {} };

  // Group questions by topicId
  const topicCorrect: Record<string, number> = {};
  const topicTotal: Record<string, number> = {};
  let totalCorrect = 0;

  questions.forEach((q, i) => {
    const correct = answers[i] === q.correctIndex;
    if (correct) totalCorrect++;
    topicTotal[q.topicId] = (topicTotal[q.topicId] ?? 0) + 1;
    topicCorrect[q.topicId] = (topicCorrect[q.topicId] ?? 0) + (correct ? 1 : 0);
  });

  const topicScores: Record<string, number> = {};
  for (const tid of Object.keys(topicTotal)) {
    topicScores[tid] = Math.round((topicCorrect[tid] / topicTotal[tid]) * 100);
  }

  const score = Math.round((totalCorrect / questions.length) * 100);
  return { score, topicScores };
}

/** Merge new topic scores with existing ones (weighted average favoring recent). */
export function mergeMastery(
  existing: Record<string, number> | undefined,
  incoming: Record<string, number>,
  mode: "diagnostic" | "practice"
): Record<string, number> {
  if (!existing || mode === "diagnostic") {
    // Diagnostic fully replaces
    return { ...incoming };
  }
  // Practice: weighted blend (70% new, 30% old)
  const merged: Record<string, number> = { ...existing };
  for (const [tid, score] of Object.entries(incoming)) {
    const old = existing[tid];
    if (old !== undefined) {
      merged[tid] = Math.round(old * 0.3 + score * 0.7);
    } else {
      merged[tid] = score;
    }
  }
  return merged;
}

/** Read stored mastery for a unit. */
export function getStoredMastery(unitId: string): {
  testCompleted: boolean;
  topicScores: Record<string, number>;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${unitId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Save mastery for a unit. */
export function saveStoredMastery(
  unitId: string,
  topicScores: Record<string, number>
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${unitId}`,
      JSON.stringify({ testCompleted: true, topicScores })
    );
  } catch {
    /* ignore */
  }
}
