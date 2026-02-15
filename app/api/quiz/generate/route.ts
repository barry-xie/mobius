import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { QuizRequest, QuizQuestion } from "@/lib/types/quiz";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as QuizRequest;
    const { courseName, unitName, topics, mode, topicScores, questionCount } = body;

    if (!topics?.length) {
      return NextResponse.json({ error: "No topics provided" }, { status: 400 });
    }

    const totalQuestions = questionCount ?? (mode === "diagnostic" ? Math.max(topics.length * 2, 6) : 8);

    // Build topic/subtopic listing for the prompt
    const topicListing = topics
      .map((t) => {
        const subs = t.subtopics?.length
          ? t.subtopics.map((s) => `  - ${s.subtopicName}`).join("\n")
          : "  (no subtopics)";
        return `- ${t.topicName}\n${subs}`;
      })
      .join("\n");

    // For practice mode, tell Gemini which topics are weak
    let focusInstruction = "";
    if (mode === "practice" && topicScores) {
      const weakTopics = topics
        .filter((t) => (topicScores[t.topicId] ?? 0) < 70)
        .map((t) => `${t.topicName} (score: ${topicScores[t.topicId] ?? 0}%)`);
      if (weakTopics.length > 0) {
        focusInstruction = `\n\nIMPORTANT: This is a PRACTICE quiz targeting weak areas. Focus most questions on these weak topics:\n${weakTopics.join("\n")}\nOnly include 1-2 questions from strong topics as reinforcement.`;
      }
    }

    const prompt = `You are a quiz generator for an educational platform.

Course: "${courseName}"
Unit: "${unitName}"
Mode: ${mode === "diagnostic" ? "Diagnostic (evenly distributed across all topics)" : "Practice (targeting weak areas)"}

Topics and subtopics in this unit:
${topicListing}
${focusInstruction}

Generate exactly ${totalQuestions} multiple-choice questions.

Rules:
- ${mode === "diagnostic" ? "Distribute questions EVENLY across all topics and subtopics" : "Focus on weak topics but include some from strong topics"}
- Each question must have exactly 4 options (A, B, C, D)
- Questions should test understanding, not just recall
- For math, programming, or technical content, use LaTeX notation wrapped in $...$ for inline or $$...$$ for block
- Include a brief explanation for each correct answer
- Tag each question with the exact topic_name and subtopic_name it belongs to
- Vary difficulty: mix easy, medium, and hard questions

Return ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "topicName": "exact topic name from above",
      "subtopicName": "exact subtopic name or null",
      "explanation": "brief explanation"
    }
  ]
}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON from response (strip any markdown fences if present)
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let parsed: { questions: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse Gemini response", raw: text.slice(0, 500) },
        { status: 502 }
      );
    }

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return NextResponse.json(
        { error: "No questions in response", raw: text.slice(0, 500) },
        { status: 502 }
      );
    }

    // Map Gemini's topicName back to topicId
    const topicMap = new Map(topics.map((t) => [t.topicName.toLowerCase(), t]));
    const subtopicMap = new Map<string, { subtopicId: string; subtopicName: string }>();
    topics.forEach((t) =>
      t.subtopics?.forEach((s) => subtopicMap.set(s.subtopicName.toLowerCase(), s))
    );

    const questions: QuizQuestion[] = parsed.questions.map((q, i) => {
      const tName = String(q.topicName ?? "");
      const sName = q.subtopicName ? String(q.subtopicName) : undefined;
      const matchedTopic = topicMap.get(tName.toLowerCase());
      const matchedSub = sName ? subtopicMap.get(sName.toLowerCase()) : undefined;

      return {
        id: String(q.id ?? `q${i + 1}`),
        question: String(q.question ?? ""),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0,
        topicId: matchedTopic?.topicId ?? tName,
        topicName: matchedTopic?.topicName ?? tName,
        subtopicId: matchedSub?.subtopicId ?? sName,
        subtopicName: matchedSub?.subtopicName ?? sName,
        explanation: q.explanation ? String(q.explanation) : undefined,
      };
    });

    return NextResponse.json({ questions });
  } catch (err) {
    console.error("Quiz generation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
