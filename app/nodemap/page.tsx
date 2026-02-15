"use client";

import Link from "next/link";
import PhysicsGraph from "./PhysicsGraph";

export default function NodeMapPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fffbf9] font-sans">
      {/* Header */}
      <header
        className="flex items-center justify-between border-b border-[#537aad]/10 px-4 py-4 sm:px-6 md:px-8"
        style={{ backgroundColor: "color-mix(in srgb, #fffbf9 99%, #537aad 1%)" }}
      >
        <Link href="/" className="font-serif text-[1.05rem] tracking-tight text-[#537aad] hover:opacity-80">
          knot.
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-[#537aad]/40 px-3 py-2 text-sm text-[#537aad] transition-colors hover:bg-[#537aad]/5"
        >
          dashboard
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden px-4 py-6 sm:px-6 md:px-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="font-serif text-xl font-normal tracking-tight text-[#537aad] md:text-2xl">
            course map
          </h1>
          <p className="mt-1 text-sm text-[#537aad]/80">
            drag nodes to rearrange — physics keeps everything spaced
          </p>
        </div>

        <div className="h-[calc(100vh-12rem)] min-h-[400px]">
          <PhysicsGraph />
        </div>
      </main>
    </div>
  );
}