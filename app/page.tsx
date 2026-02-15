import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#fffbf9] font-sans">
      {/* Nav, minimal bar, readable on hero and about */}
      <header
        className="fixed left-4 right-4 top-4 z-20 flex items-center justify-between rounded-2xl px-4 py-3 backdrop-blur-md sm:left-6 sm:right-6 sm:px-6 md:left-8 md:right-8 md:px-8 lg:left-10 lg:right-10 lg:px-10"
        style={{ backgroundColor: "color-mix(in srgb, #fffbf9 97%, #537aad 3%)", boxShadow: "0 4px 24px rgba(83,122,173,0.15), 0 2px 8px rgba(0,0,0,0.06)" }}
      >
        <Link
          href="/"
          className="font-serif text-[0.9375rem] tracking-tight text-[#537aad] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#537aad]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffbf9]"
        >
          knot.
        </Link>
        <nav className="flex items-center gap-4 text-[0.8125rem] lowercase tracking-wide text-[#537aad]">
          <a
            href="#about"
            className="transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#537aad]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffbf9]"
          >
            about
          </a>
          <Link
            href="/onboard"
            className="rounded-full px-3 py-1.5 text-[0.8125rem] font-medium text-[#fffbf9] transition-all hover:opacity-95 hover:shadow-[0_4px_20px_rgba(83,122,173,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#537aad] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffbf9]"
            style={{
              background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 100%)",
            }}
          >
            get started
          </Link>
        </nav>
      </header>

      {/* Hero, full viewport, gradient overlay, content left */}
      <section className="relative flex min-h-screen flex-col justify-end overflow-hidden">
        <video
          className="absolute inset-0 h-full w-full object-cover object-top"
          style={{ filter: "contrast(1.04) saturate(1.02)" }}
          src="/knot.webm"
          autoPlay
          loop
          muted
          playsInline
          aria-label="Background video of a torus knot"
        />
        {/* Gradient overlay, dark at top, cream fade at bottom */}
        <div
          className="absolute inset-0 z-[1]"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 40%, transparent 60%, rgba(255,251,249,0.15) 85%, rgba(255,251,249,0.4) 100%)",
          }}
        />
        {/* Large decorative knot. bottom right */}
        <span
          className="pointer-events-none absolute bottom-6 right-6 z-[2] font-serif font-normal tracking-tight text-[#fffbf9] sm:bottom-8 sm:right-8 md:bottom-10 md:right-10"
          style={{
            fontSize: "clamp(4rem, 15vw, 10rem)",
            lineHeight: 1,
            letterSpacing: "-0.03em",
            opacity: 0.2,
          }}
          aria-hidden
        >
          knot.
        </span>
        <div className="relative z-[50] flex flex-col justify-end px-4 pb-10 pt-16 sm:px-6 sm:pb-12 sm:pt-20 md:px-8 md:pb-14 md:pt-24 lg:px-10">
          <div className="max-w-2xl">
            <h1
              className="whitespace-normal font-serif font-normal tracking-tight sm:whitespace-nowrap"
              style={{
                fontSize: "clamp(1.75rem, 4.5vw + 1.1rem, 2.875rem)",
                letterSpacing: "-0.02em",
                lineHeight: 1.25,
                paddingBottom: "0.05em",
                background: "linear-gradient(135deg, #fffbf9 0%, #fffbf9 70%, rgba(83,122,173,0.4) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Unravel your <span className="italic">learning</span>.
            </h1>
            <p className="mt-2 font-sans text-[0.9375rem] font-medium lowercase tracking-wide text-[#fffbf9]/90 sm:mt-3" style={{ letterSpacing: "0.02em" }}>
              One place for your classes, materials, and progress.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
              <a
                href="#about"
                className="inline-flex items-center justify-center rounded-full border border-[#537aad]/40 bg-[#fffbf9]/90 px-4 py-2 text-[0.875rem] font-medium text-[#537aad] backdrop-blur-sm transition-all hover:border-[#537aad] hover:bg-[#fffbf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fffbf9] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              >
                learn more
              </a>
              <Link
                href="/onboard"
                className="inline-flex items-center justify-center rounded-full border-2 border-[#fffbf9] px-4 py-2 text-[0.875rem] font-medium text-[#fffbf9] transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(83,122,173,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fffbf9] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                style={{
                  background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 50%, #537aad 100%)",
                  backgroundSize: "200% 200%",
                }}
              >
                get started
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* about */}
      <section
        id="about"
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-24 sm:px-6 sm:py-28 md:px-8 lg:px-10"
        style={{ backgroundColor: "#fffbf9" }}
      >
        <div className="relative mx-auto w-full max-w-2xl">
          <h2
            className="font-serif font-normal tracking-tight"
            style={{
              fontSize: "clamp(1.25rem, 2.5vw + 0.75rem, 1.75rem)",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              background: "linear-gradient(135deg, #537aad 0%, #6b8fc4 50%, #537aad 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            one place to study.
          </h2>
          <div
            className="mt-6 space-y-5 font-sans text-[#537aad] sm:mt-8 sm:space-y-6"
            style={{
              fontSize: "clamp(0.875rem, 0.9vw + 0.5rem, 0.9375rem)",
              lineHeight: 1.7,
            }}
          >
            <p>
              Knot connects to <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>Canvas</mark> to pull your classes, syllabi, files, lecture notes, assignments, and exams. It ingests that material into a <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>RAG system</mark>: documents are chunked, embedded with <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>vector embeddings</mark>, and stored so each piece can be retrieved by <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>semantic similarity</mark>. That powers a <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>roadmap</mark> where units, topics, and assignments are nodes, linked to the material they cover.
            </p>
            <p>
              You take <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>diagnostic and practice quizzes</mark> on topics (or on specific exams you create). Knot identifies where you need the most help and shows it with <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>visual indicators</mark>. When you struggle, the <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>RAG pipeline</mark> retrieves the most relevant chunks from your course material, lecture notes, readings, assignment descriptions, and can surface them to help you focus. No more juggling.
            </p>
            <p>
              All of it lives in one <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>visual mindmap</mark> that connects topics and <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>tracks your progress</mark>.
            </p>
          </div>
          <p
            className="mt-8 font-serif font-normal text-[#537aad] sm:mt-10"
            style={{
              fontSize: "clamp(1rem, 1.2vw + 0.6rem, 1.1875rem)",
              letterSpacing: "-0.01em",
              lineHeight: 1.4,
            }}
          >
            Knot is the <mark className="rounded px-0.5 text-[#537aad]" style={{ backgroundColor: "rgba(83,122,173,0.2)" }}>last study tool you will ever need</mark>.
          </p>
        </div>
      </section>
    </div>
  );
}
