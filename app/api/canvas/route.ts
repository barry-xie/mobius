import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";

    if (!token) {
      return NextResponse.json({ error: "Missing Canvas API token" }, { status: 400 });
    }

    const { run } = await import("@/scripts/getCanvas");
    const result = (await run({ token, writeFile: true })) as { classes?: { courseId?: string; className: string }[]; classNames?: string[] };
    const classes = Array.isArray(result?.classes)
      ? result.classes.filter((c) => c && typeof c.className === "string")
      : [];
    const classNames = classes.map((c) => c.className.trim()).filter(Boolean);

    return NextResponse.json({ classes, classNames });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Canvas data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
