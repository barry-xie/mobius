/** Shared quiz types — used by API route, service layer, and UI. */

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  topicId: string;
  topicName: string;
  subtopicId?: string;
  subtopicName?: string;
  explanation?: string;
};

export type QuizMode = "diagnostic" | "practice";

export type QuizRequest = {
  courseName: string;
  unitName: string;
  topics: Array<{
    topicId: string;
    topicName: string;
    subtopics: Array<{ subtopicId: string; subtopicName: string }>;
  }>;
  mode: QuizMode;
  /** For practice mode: topic scores from prior diagnostic, so Gemini targets weak areas. */
  topicScores?: Record<string, number>;
  questionCount?: number;
};

export type QuizResult = {
  questions: QuizQuestion[];
  answers: number[]; // user's selected option index per question
  score: number; // 0–100
  topicScores: Record<string, number>; // topicId → 0–100
  completedAt: string; // ISO timestamp
};
