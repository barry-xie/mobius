"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as d3 from "d3-force";
import { type GraphNode, type GraphLink, type UnitEntry } from "./utils";
import Quiz from "./Quiz";
import type { QuizMode } from "@/lib/types/quiz";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// ─── Design tokens ───────────────────────────────────────────────────────────
const COLORS = {
  // Canvas background
  canvasBg: "#f8f7f6",
  gridColor: "rgba(0,0,0,0.06)",
  // Nodes
  nodeFill: "#ffffff",
  nodeBorder: "#d4dae3",
  nodeBorderHover: "#a8c4e8",
  nodeText: "#537aad",
  nodeTextLight: "#7a9bc7",
  nodeShadow: "rgba(83,122,173,0.08)",
  // Selection
  selectRing: "#537aad",
  selectGlow: "rgba(83,122,173,0.10)",
  // Links
  link: "rgba(83,122,173,0.10)",
  // Center node
  centerFill: "#537aad",
  centerText: "#ffffff",
  // Mastery (unused – now computed via masteryColor())
} as const;

const GRID_SPACING = 28;

// ─── Topic strength indicators ──────────────────────────────────────────────
const TOPIC_STRENGTH = {
  strong: { color: "#10b981", bg: "bg-emerald-50", text: "text-emerald-700", label: "Strong" },
  medium: { color: "#f59e0b", bg: "bg-amber-50", text: "text-amber-700", label: "Needs practice" },
  weak: { color: "#ef4444", bg: "bg-rose-50", text: "text-rose-700", label: "Struggling" },
  none: { color: "#94a3b8", bg: "bg-slate-50", text: "text-slate-500", label: "Not assessed" },
} as const;

function getTopicStrength(score: number | undefined): keyof typeof TOPIC_STRENGTH {
  if (score === undefined) return "none";
  if (score >= 70) return "strong";
  if (score >= 40) return "medium";
  return "weak";
}

/** Average mastery % from topic scores. Returns 0–100 or undefined if not assessed. */
function getUnitMastery(unitId: string): number | undefined {
  const result = getUnitTestResult(unitId);
  if (!result?.testCompleted || !result.topicScores) return undefined;
  const scores = Object.values(result.topicScores);
  if (scores.length === 0) return undefined;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** Mastery color: red → amber → green matching the sidebar bar. */
function masteryColor(pct: number): string {
  if (pct >= 70) return "#10b981";
  if (pct >= 40) return "#f59e0b";
  return "#ef4444";
}

const STORAGE_KEY = "knot_unit_test_results";

type UnitTestResult = { testCompleted: boolean; topicScores: Record<string, number> };

function getUnitTestResult(unitId: string): UnitTestResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${unitId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setUnitTestResult(unitId: string, result: UnitTestResult) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_KEY}_${unitId}`, JSON.stringify(result));
  } catch {
    /* ignore */
  }
}

// ─── Right-panel sidebar ────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 340;

function ConceptSidebar({
  node,
  isClosing,
  onClose,
  onTransitionEnd,
  onMasteryChange,
  courseName,
  onLaunchQuiz,
  masteryVersion,
}: {
  node: GraphNode | null;
  isClosing: boolean;
  onClose: () => void;
  onTransitionEnd: () => void;
  onMasteryChange?: () => void;
  courseName: string;
  onLaunchQuiz?: (mode: QuizMode) => void;
  masteryVersion?: number;
}) {
  const isOpen = !!node && !isClosing;
  const unitId = node?.unitData?.unit_id ?? node?.id ?? "";
  const [unitResult, setUnitResult] = useState<UnitTestResult | null>(null);

  useEffect(() => {
    setUnitResult(getUnitTestResult(unitId));
  }, [unitId, masteryVersion]);

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName === "width" && isClosing) onTransitionEnd();
  };

  const testCompleted = unitResult?.testCompleted ?? false;
  const mastery = getUnitMastery(unitId);

  return (
    <div
      className="shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
      style={{ width: isOpen ? SIDEBAR_WIDTH : 0 }}
      onTransitionEnd={handleTransitionEnd}
    >
      <aside
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-black/6 bg-white/90 backdrop-blur-sm"
        style={{ width: SIDEBAR_WIDTH }}
      >
        {node && (
          <>
            {/* Header */}
            <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <h3 className="font-serif text-[14px] font-normal leading-snug tracking-tight text-[#537aad]">
                  {node.name}
                </h3>
                {node.variant === "concept" && (
                  <p className="mt-1 text-[10px] font-medium text-[#7a9bc7]">
                    {node.unitData?.topics?.length ?? 0} topics
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-0.5 shrink-0 rounded-md p-1 text-[#7a9bc7] transition-colors hover:bg-black/4 hover:text-[#537aad]"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7" />
                </svg>
              </button>
            </div>

            {/* Divider */}
            <div className="mx-5 h-px bg-black/4" />

            {/* Content */}
            <div className="min-h-0 flex-1 flex flex-col gap-5 overflow-y-auto overflow-x-hidden px-5 py-4">
              {/* Mastery bar */}
              {node.variant === "concept" && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7a9bc7]">
                      Mastery
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums text-[#537aad]">
                      {mastery !== undefined ? `${mastery}%` : "0%"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/4">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: mastery !== undefined ? `${mastery}%` : "0%",
                        background: mastery !== undefined
                          ? mastery >= 70 ? "#10b981" : mastery >= 40 ? "#f59e0b" : "#ef4444"
                          : "#d4dae3",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Topics */}
              {node.unitData?.topics && node.unitData.topics.length > 0 && (
                <div>
                  <h4 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7a9bc7]">
                    Topics
                  </h4>
                  <ul className="space-y-2">
                    {node.unitData.topics.map((topic) => {
                      const topicId = topic.topic_id ?? topic.topic_name ?? "";
                      const score = unitResult?.topicScores?.[topicId];
                      const strength = getTopicStrength(score);
                      const s = TOPIC_STRENGTH[strength];
                      return (
                        <li
                          key={topicId}
                          className={`rounded-lg ${s.bg} p-3 transition-colors`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className={`text-[11px] font-medium ${s.text} truncate`}>
                                {topic.topic_name ?? "Topic"}
                              </span>
                            </div>
                            {score !== undefined && (
                              <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${s.text}`}>
                                {score}%
                              </span>
                            )}
                          </div>
                          {topic.subtopics && topic.subtopics.length > 0 && (
                            <ul className="mt-2 space-y-1 pl-3.5">
                              {topic.subtopics.map((sub) => (
                                <li key={sub.subtopic_id ?? sub.subtopic_name} className="text-[10px] leading-relaxed text-[#7a9bc7]">
                                  {sub.subtopic_name ?? "—"}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {node.variant === "center" && (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-center text-[11px] leading-relaxed text-[#7a9bc7]">
                    Click a unit node to<br />explore its topics.
                  </p>
                </div>
              )}

              {node.variant === "concept" && (!node.unitData?.topics || node.unitData.topics.length === 0) && (
                <p className="text-[11px] text-[#7a9bc7]">No topics defined for this unit yet.</p>
              )}

              {/* Actions */}
              {node.variant === "concept" && node.unitData?.topics && node.unitData.topics.length > 0 && (
                <div className="mt-auto space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onLaunchQuiz?.("diagnostic")}
                    className="w-full rounded-lg bg-[#537aad] py-2.5 text-[11px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[#46689a] hover:shadow-md active:scale-[0.98]"
                  >
                    {testCompleted ? "Retake diagnostic" : "Take diagnostic test"}
                  </button>
                  {testCompleted && (
                    <button
                      type="button"
                      onClick={() => onLaunchQuiz?.("practice")}
                      className="w-full rounded-lg border border-black/8 bg-white py-2.5 text-[11px] font-medium text-[#537aad] transition-all duration-150 hover:border-black/12 hover:shadow-sm active:scale-[0.98]"
                    >
                      Generate practice questions
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export type PhysicsGraphProps = {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  selectedNodeId?: string | null;
  onUnitSelect?: (nodeId: string | null) => void;
  courseName?: string;
};

// ─── PhysicsGraph component ─────────────────────────────────────────────────
export default function PhysicsGraph({ graphData, selectedNodeId, onUnitSelect, courseName = "Course" }: PhysicsGraphProps) {
  const fgRef = useRef<{
    d3Force: (name: string, force?: unknown) => unknown;
    centerAt: (x: number, y: number, duration?: number) => void;
    zoom: (scale: number, duration?: number) => void;
    zoomToFit?: (duration?: number, padding?: number) => void;
  } | null>(null);
  const fitPendingRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ w: 680, h: 425 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [masteryVersion, setMasteryVersion] = useState(0);
  const [quizMode, setQuizMode] = useState<QuizMode | null>(null);
  const selectedNodeRef = useRef<GraphNode | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  selectedNodeRef.current = selectedNode;
  selectedNodeIdRef.current = selectedNodeId ?? null;

  const captureNodePositions = useCallback(() => {
    graphData.nodes.forEach((n) => {
      const x = Number(n.x);
      const y = Number(n.y);
      if (!Number.isNaN(x) && !Number.isNaN(y)) {
        nodePositionsRef.current.set(String(n.id), { x, y });
      }
    });
  }, [graphData.nodes]);

  // Sync with parent-controlled selectedNodeId
  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNode(null);
      setSidebarClosing(false);
      return;
    }
    const node = graphData.nodes.find((n) => String(n.id) === String(selectedNodeId)) as GraphNode | undefined;
    if (node) {
      setSelectedNode(node);
      setSidebarClosing(false);
      const pos = nodePositionsRef.current.get(String(selectedNodeId)) ?? { x: Number(node.x), y: Number(node.y) };
      const fg = fgRef.current;
      if (fg && !Number.isNaN(pos.x) && !Number.isNaN(pos.y)) {
        fg.centerAt(pos.x, pos.y, 600);
        fg.zoom(1.6, 600);
      }
    }
  }, [selectedNodeId, graphData.nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const config = () => {
      const fg = fgRef.current;
      if (!fg) return false;

      fg.d3Force("charge", d3.forceManyBody().strength(-250));
      fg.d3Force(
        "collide",
        d3.forceCollide().radius((d) => ((d as GraphNode).radius ?? 28) * 1.5)
      );
      fg.d3Force(
        "radial",
        d3.forceRadial((d) => (d as GraphNode & { targetRadius?: number }).targetRadius ?? 150, 0, 0)
      );
      fg.d3Force("orbit", null);

      const linkForce = fg.d3Force("link") as { distance: (d: number | ((l: unknown) => number)) => { iterations: (n: number) => void }; iterations?: (n: number) => void };
      if (linkForce?.distance) {
        linkForce.distance((l: unknown) => {
          const link = l as { source?: { targetRadius?: number }; target?: { targetRadius?: number } };
          const s = link.source?.targetRadius ?? 0;
          const t = link.target?.targetRadius ?? 0;
          return Math.max(s, t) || 140;
        }).iterations(1);
      }

      return true;
    };
    if (config()) return;
    const id = requestAnimationFrame(function check() {
      if (config()) return;
      requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    fitPendingRef.current = true;
  }, [graphData]);

  const getNodeRadius = useCallback((node: Record<string, unknown>) => Number(node.radius) || 32, []);

  const sidebarClosingRef = useRef(false);
  sidebarClosingRef.current = sidebarClosing;

  // ─── Custom canvas rendering ────────────────────────────────────────────────
  // Graph-paper grid drawn via onRenderFramePre
  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const transform = ctx.getTransform();
      const invScale = 1 / transform.a;
      const left = (0 - transform.e) * invScale;
      const top = (0 - transform.f) * invScale;
      const right = (w - transform.e) * invScale;
      const bottom = (h - transform.f) * invScale;

      const spacing = GRID_SPACING;
      const startX = Math.floor(left / spacing) * spacing;
      const startY = Math.floor(top / spacing) * spacing;

      ctx.strokeStyle = COLORS.gridColor;
      ctx.lineWidth = 0.5 / globalScale;

      ctx.beginPath();
      for (let x = startX; x <= right; x += spacing) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      for (let y = startY; y <= bottom; y += spacing) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
    },
    []
  );

  const nodeCanvasObject = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale?: number) => {
      const x = Number(node.x) || 0;
      const y = Number(node.y) || 0;
      const r = getNodeRadius(node);
      const current = selectedNodeRef.current;
      const isSelected =
        current &&
        !sidebarClosingRef.current &&
        String((node as { id?: unknown }).id) === String(current.id);
      const isCenter = (node as { variant?: string }).variant === "center";
      const scale = typeof globalScale === "number" && globalScale > 0 ? globalScale : 1;

      ctx.save();

      // ── Selection ring (behind node) ──
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4 / scale, 0, 2 * Math.PI);
        ctx.strokeStyle = COLORS.selectRing;
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([3 / scale, 3 / scale]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Soft outer glow
        const glowR = r + 16 / scale;
        const gradient = ctx.createRadialGradient(x, y, r, x, y, glowR);
        gradient.addColorStop(0, COLORS.selectGlow);
        gradient.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // ── Shadow ──
      ctx.shadowColor = COLORS.nodeShadow;
      ctx.shadowBlur = isCenter ? 16 : 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = isCenter ? 3 : 2;

      // ── Node fill ──
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      if (isCenter) {
        ctx.fillStyle = COLORS.centerFill;
      } else {
        ctx.fillStyle = COLORS.nodeFill;
      }
      ctx.fill();

      // ── Border ──
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      if (!isCenter) {
        let borderColor: string = COLORS.nodeBorder;
        const unitId = String((node as GraphNode).unitData?.unit_id ?? (node as { id?: unknown }).id ?? "");
        const mastery = getUnitMastery(unitId);
        if (mastery !== undefined) {
          borderColor = masteryColor(mastery);
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isSelected ? 3 / scale : mastery !== undefined ? 2.5 / scale : 1 / scale;
        ctx.stroke();
      }

      // ── Label ──
      const label = (node.name as string) ?? "";
      const baseFontSize = isCenter ? 14 : 11;
      let fontSize = Math.max(8, Math.min(28, baseFontSize / Math.max(scale, 0.35)));
      const maxW = r * 2;
      const lineHeight = 1.3;
      const fontFamily = "system-ui, -apple-system, sans-serif";
      const fontWeight = isCenter ? "600" : "500";

      function wrapText(text: string, maxWidth: number): string[] {
        const words = text.split(/\s+/).filter(Boolean);
        if (words.length === 0) return [];
        const lines: string[] = [];
        let line = words[0];
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        for (let i = 1; i < words.length; i++) {
          const test = line + " " + words[i];
          if (ctx.measureText(test).width <= maxWidth) {
            line = test;
          } else {
            lines.push(line);
            line = words[i];
          }
        }
        lines.push(line);
        return lines;
      }

      let lines = wrapText(label, maxW);
      while (lines.length > 2 && fontSize > 7) {
        fontSize -= 0.5;
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        lines = wrapText(label, maxW);
      }
      if (lines.length > 2) lines = [lines.slice(0, -1).join(" "), lines[lines.length - 1]];

      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isCenter ? COLORS.centerText : isSelected ? COLORS.nodeText : COLORS.nodeTextLight;
      const startY = lines.length <= 1 ? y : y - ((lines.length - 1) * fontSize * lineHeight) / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, x, startY + i * fontSize * lineHeight);
      });

      ctx.restore();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getNodeRadius, masteryVersion]
  );

  const nodePointerAreaPaint = useCallback(
    (node: Record<string, unknown>, color: string, ctx: CanvasRenderingContext2D) => {
      const x = (node.x as number) ?? 0;
      const y = (node.y as number) ?? 0;
      const r = getNodeRadius(node);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    },
    [getNodeRadius]
  );

  const handleNodeClick = useCallback(
    (node: { id?: string | number; name?: string; variant?: string; x?: number; y?: number; [key: string]: unknown }, _ev: MouseEvent) => {
      const gnode = node as GraphNode;
      const nodeId = gnode?.id != null ? String(gnode.id) : null;
      setSelectedNode(gnode);
      setSidebarClosing(false);
      onUnitSelect?.(nodeId);
      const pos = nodeId ? nodePositionsRef.current.get(nodeId) : null;
      const nx = pos?.x ?? Number(node.x);
      const ny = pos?.y ?? Number(node.y);
      const fg = fgRef.current;
      if (fg && !Number.isNaN(nx) && !Number.isNaN(ny)) {
        fg.centerAt(nx, ny, 600);
        fg.zoom(1.6, 600);
      }
    },
    [onUnitSelect]
  );

  const handleBackgroundClick = useCallback(() => {
    if (selectedNodeRef.current) {
      setSidebarClosing(true);
      onUnitSelect?.(null);
      const fg = fgRef.current;
      if (fg) {
        fg.centerAt(0, 0, 800);
        fg.zoom(1.4, 800);
      }
    }
  }, [onUnitSelect]);

  const handleSidebarClose = useCallback(() => {
    setSidebarClosing(true);
    onUnitSelect?.(null);
    const fg = fgRef.current;
    if (fg) {
      fg.centerAt(0, 0, 800);
      fg.zoom(1.4, 800);
    }
  }, [onUnitSelect]);

  const handleSidebarTransitionEnd = useCallback(() => {
    setSelectedNode(null);
    setSidebarClosing(false);
  }, []);

  const handleEngineStop = useCallback(() => {
    captureNodePositions();
    if (!fitPendingRef.current || !fgRef.current) return;
    fitPendingRef.current = false;
    const sid = selectedNodeIdRef.current;
    if (sid) {
      const pos = nodePositionsRef.current.get(sid);
      const node = graphData.nodes.find((n) => String(n.id) === String(sid));
      const nx = pos?.x ?? Number(node?.x);
      const ny = pos?.y ?? Number(node?.y);
      if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
        fgRef.current.centerAt(nx, ny, 600);
        fgRef.current.zoom(1.6, 600);
        return;
      }
    }
    fgRef.current.centerAt(0, 0, 600);
    fgRef.current.zoom(1.4, 600);
  }, [captureNodePositions, graphData.nodes]);

  // Custom link paint: clean blue lines
  const linkCanvasObject = useCallback(
    (link: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as { x?: number; y?: number } | undefined;
      const target = link.target as { x?: number; y?: number } | undefined;
      if (!source?.x || !source?.y || !target?.x || !target?.y) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = "rgba(83,122,173,0.25)";
      ctx.lineWidth = 1 / globalScale;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    },
    []
  );

  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl bg-[#f8f7f6] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]">
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <ForceGraph2D
          ref={fgRef as any}
          width={size.w}
          height={size.h}
          backgroundColor={COLORS.canvasBg}
          linkCanvasObject={linkCanvasObject}
          linkCanvasObjectMode={() => "replace"}
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={nodePointerAreaPaint}
          graphData={graphData}
          cooldownTicks={Infinity}
          d3AlphaDecay={0.08}
          d3VelocityDecay={0.4}
          d3AlphaMin={0.001}
          warmupTicks={30}
          minZoom={0.2}
          maxZoom={2}
          enableNodeDrag={true}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onEngineTick={captureNodePositions}
          onEngineStop={handleEngineStop}
          onRenderFramePre={onRenderFramePre}
        />
      </div>
      <ConceptSidebar
        node={selectedNode}
        isClosing={sidebarClosing}
        onClose={handleSidebarClose}
        onTransitionEnd={handleSidebarTransitionEnd}
        onMasteryChange={() => setMasteryVersion((v) => v + 1)}
        courseName={courseName}
        onLaunchQuiz={(mode) => setQuizMode(mode)}
        masteryVersion={masteryVersion}
      />

      {/* Quiz overlay */}
      {quizMode && selectedNode?.unitData && (
        <Quiz
          courseName={courseName}
          unitName={selectedNode.name}
          unitId={selectedNode.unitData.unit_id ?? selectedNode.id}
          unitData={selectedNode.unitData}
          mode={quizMode}
          onClose={() => setQuizMode(null)}
          onComplete={() => {
            setQuizMode(null);
            setMasteryVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
