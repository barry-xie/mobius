import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const maxDuration = 30;

type Message = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const body = await request.json();
    const messages: Message[] = body.messages ?? [];
    const userMessage = messages[messages.length - 1]?.content ?? "";

    if (!userMessage.trim()) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    // Load classNames.json as context
    let classData = "No class data available.";
    try {
      const filePath = join(process.cwd(), "public", "classNames.json");
      const raw = await readFile(filePath, "utf-8");
      classData = raw;
    } catch {
      /* file might not exist yet */
    }

    // Load any stored mastery data passed from the client
    const masteryData: Record<string, unknown> = body.masteryData ?? {};

    const systemPrompt = `You are a helpful, friendly academic assistant for "knot.", an educational platform that helps students track and improve their learning across their courses.

You have access to the student's course data (from their Canvas LMS integration) below. Use it to answer questions about their classes, units, topics, subtopics, and learning progression.

COURSE DATA (from classNames.json):
${classData}

${Object.keys(masteryData).length > 0 ? `MASTERY DATA (from diagnostic tests the student has taken):\n${JSON.stringify(masteryData, null, 2)}` : "The student has not taken any diagnostic tests yet."}

Guidelines:
- Be concise but warm. Use a conversational, supportive tone.
- When discussing courses, reference actual course names, unit names, topics, and subtopics from the data.
- If asked about mastery or progress, reference their actual scores when available.
- If a course has no units/topics yet, let them know that course data is still syncing.
- For study advice, be specific to their actual topics and weak areas.
- Keep responses focused and not too long — a few sentences to a short paragraph is ideal.
- Do not use markdown headers. Use plain text with occasional bold for emphasis.
- You can reference specific topics by name to make your advice actionable.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: { role: "system" as const, parts: [{ text: systemPrompt }] },
    });

    // Build conversation contents — Gemini requires first content to be role "user"
    const contents = messages.map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: m.content }],
    }));

    const result = await model.generateContent({ contents });
    const reply = result.response.text();

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
