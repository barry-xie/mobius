"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as d3 from "d3-force";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// ─── Design tokens (landing page blue: #537aad, lighter: #7a9bc7, highlight: #a8c4e8) ───
const COLORS = {
  bg: "#fffbf9",
  primary: "#7a9bc7",
  primaryLight: "#a8c4e8",
  border: "#cbd5e1",
  shadow: "rgba(122,155,199,0.22)",
  glow: "rgba(168,196,232,0.22)",
  glowStrong: "rgba(168,196,232,0.08)",
  link: "#9ca3af",
} as const;

// ─── Course graph data ──────────────────────────────────────────────────────
type GraphNode = {
  id: string;
  name: string;
  val: number;
  radius: number;
  targetRadius?: number;
  variant: "center" | "unit" | "assignment";
};

type GraphLink = { source: string; target: string };

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

// Gentle orbital drift around center
function orbitForce(strength: number) {
  let nodes: { fx?: number | null; fy?: number | null; x?: number; y?: number; vx?: number; vy?: number }[] = [];
  return Object.assign(
    function () {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.fx != null || n.fy != null) continue;
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const r = Math.hypot(x, y);
        if (r < 2) continue;
        const tx = -y / r;
        const ty = x / r;
        n.vx = (n.vx ?? 0) + tx * strength;
        n.vy = (n.vy ?? 0) + ty * strength;
      }
    },
    {
      initialize: (n: unknown[]) => {
        nodes = n as typeof nodes;
      },
    }
  );
}

// Hub-and-spoke: every node links to center only (no chains)
// Larger radii so text fits; center 80, units 42–56, assignments 40–52
const COURSE_GRAPH_DATA = {
  nodes: [
    { id: "course", name: "Computer Science 101", val: 36, radius: 80, variant: "center" as const, fx: 0, fy: 0 },
    { id: "algorithms", name: "Algorithms", val: 14, radius: 42 + (hash("algorithms") % 14), targetRadius: 90 + (hash("algorithms") % 110), variant: "unit" as const },
    { id: "data-structures", name: "Data Structures", val: 14, radius: 42 + (hash("data-structures") % 14), targetRadius: 90 + (hash("data-structures") % 110), variant: "unit" as const },
    { id: "web-dev", name: "Web Dev", val: 14, radius: 42 + (hash("web-dev") % 14), targetRadius: 90 + (hash("web-dev") % 110), variant: "unit" as const },
    { id: "oop", name: "OOP", val: 14, radius: 42 + (hash("oop") % 14), targetRadius: 90 + (hash("oop") % 110), variant: "unit" as const },
    { id: "networking", name: "Networking", val: 14, radius: 42 + (hash("networking") % 14), targetRadius: 90 + (hash("networking") % 110), variant: "unit" as const },
    { id: "quiz-1", name: "Quiz 1", val: 8, radius: 40 + (hash("quiz-1") % 12), targetRadius: 90 + (hash("quiz-1") % 110), variant: "assignment" as const },
    { id: "essay", name: "Essay", val: 8, radius: 40 + (hash("essay") % 12), targetRadius: 90 + (hash("essay") % 110), variant: "assignment" as const },
    { id: "final-project", name: "Final Project", val: 8, radius: 40 + (hash("final-project") % 12), targetRadius: 90 + (hash("final-project") % 110), variant: "assignment" as const },
    { id: "midterm", name: "Midterm", val: 8, radius: 40 + (hash("midterm") % 12), targetRadius: 90 + (hash("midterm") % 110), variant: "assignment" as const },
    { id: "lab-1", name: "Lab 1", val: 8, radius: 40 + (hash("lab-1") % 12), targetRadius: 90 + (hash("lab-1") % 110), variant: "assignment" as const },
    { id: "lab-2", name: "Lab 2", val: 8, radius: 40 + (hash("lab-2") % 12), targetRadius: 90 + (hash("lab-2") % 110), variant: "assignment" as const },
  ] as GraphNode[],
  links: [
    { source: "course", target: "algorithms" },
    { source: "course", target: "data-structures" },
    { source: "course", target: "web-dev" },
    { source: "course", target: "oop" },
    { source: "course", target: "networking" },
    { source: "course", target: "quiz-1" },
    { source: "course", target: "essay" },
    { source: "course", target: "final-project" },
    { source: "course", target: "midterm" },
    { source: "course", target: "lab-1" },
    { source: "course", target: "lab-2" },
  ] as GraphLink[],
};

// ─── Concept topic sidebar ───────────────────────────────────────────────────
const SIDEBAR_WIDTH = 420;

function ConceptSidebar({
  node,
  isClosing,
  onClose,
  onTransitionEnd,
}: {
  node: GraphNode | null;
  isClosing: boolean;
  onClose: () => void;
  onTransitionEnd: () => void;
}) {
  const isOpen = !!node && !isClosing;

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName === "width" && isClosing) onTransitionEnd();
  };

  return (
    <div
      className="shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
      style={{ width: isOpen ? SIDEBAR_WIDTH : 0 }}
      onTransitionEnd={handleTransitionEnd}
    >
      <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-[#537aad]/15 bg-[#fffbf9]">
        {node && (
          <>
            <div className="flex items-center justify-between border-b border-[#537aad]/10 px-5 py-4">
              <h3 className="font-serif text-lg font-normal tracking-tight text-[#537aad]">{node.name}</h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-[#537aad]/50 transition-colors hover:bg-[#537aad]/10 hover:text-[#537aad]"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
              {(() => {
                const mastery = Math.min(100, (hash(String(node.id)) % 85) + 15);
                return (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wider text-[#537aad]/60">
                        Mastery
                      </span>
                      <span className="text-xs font-medium tabular-nums text-[#537aad]/80">
                        {mastery}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#537aad]/10">
                      <div
                        className="h-full rounded-full bg-[#537aad] transition-[width] duration-500"
                        style={{ width: `${mastery}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
              <button
                type="button"
                className="w-full rounded-lg border border-[#537aad]/40 py-3 text-sm font-medium text-[#537aad] transition-colors hover:bg-[#537aad]/5"
              >
                Generate quiz
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ─── PhysicsGraph component ─────────────────────────────────────────────────
export default function PhysicsGraph() {
  const fgRef = useRef<{ d3Force: (name: string, force?: unknown) => unknown } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ w: 800, h: 500 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [centerNodeId, setCenterNodeId] = useState<string | null>("course");
  const selectedNodeRef = useRef<GraphNode | null>(null);
  selectedNodeRef.current = selectedNode;
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

  // When center node changes: translate entire graph as a rigid body so clicked node is at center, then fix all nodes
  const prevCenterRef = useRef<string | null>(null);
  useEffect(() => {
    const centerId = centerNodeId ?? "course";
    const nodes = COURSE_GRAPH_DATA.nodes as (GraphNode & { x?: number; y?: number; fx?: number; fy?: number })[];
    const isUserClick = prevCenterRef.current !== null && prevCenterRef.current !== centerId;

    if (isUserClick) {
      const centerNode = nodes.find((n) => String(n.id) === centerId);
      if (centerNode && (centerNode.x != null || centerNode.y != null)) {
        const dx = 0 - (centerNode.x ?? 0);
        const dy = 0 - (centerNode.y ?? 0);
        nodes.forEach((n) => {
          n.x = (n.x ?? 0) + dx;
          n.y = (n.y ?? 0) + dy;
          if (String(n.id) === centerId) {
            n.fx = 0;
            n.fy = 0;
          } else {
            delete n.fx;
            delete n.fy;
          }
        });
        (fgRef.current as { d3ReheatSimulation?: () => void } | null)?.d3ReheatSimulation?.();
      }
    } else {
      const centerIdToFix = centerId;
      nodes.forEach((n) => {
        if (String(n.id) === centerIdToFix) {
          n.fx = 0;
          n.fy = 0;
        } else {
          delete n.fx;
          delete n.fy;
        }
      });
      if (prevCenterRef.current === null) {
        (fgRef.current as { d3ReheatSimulation?: () => void } | null)?.d3ReheatSimulation?.();
      }
    }
    prevCenterRef.current = centerId;
  }, [centerNodeId]);

  useEffect(() => {
    const config = () => {
      const fg = fgRef.current;
      if (!fg) return false;

      // Softer repulsion — graceful, less stiff
      fg.d3Force("charge", d3.forceManyBody().strength(-180));

      // Gentle collide with minimal padding
      fg.d3Force(
        "collide",
        d3.forceCollide().radius((d) => ((d as GraphNode).radius ?? 28) * 1.15)
      );

      // Radial force — each node has its own distance (spread out)
      fg.d3Force(
        "radial",
        d3.forceRadial((d) => (d as GraphNode).targetRadius ?? 150, 0, 0)
      );

      fg.d3Force("orbit", null);

      // Softer link tethers — variable distance per link (spread)
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

  // Shared radius so visible circle and hitbox always match
  const getNodeRadius = useCallback((node: Record<string, unknown>) => Number(node.radius) || 32, []);

  const sidebarClosingRef = useRef(false);
  sidebarClosingRef.current = sidebarClosing;
  const centerNodeIdRef = useRef<string | null>(null);
  centerNodeIdRef.current = centerNodeId;

  const nodeCanvasObject = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D) => {
      const x = Number(node.x) || 0;
      const y = Number(node.y) || 0;
      const r = getNodeRadius(node);
      const current = selectedNodeRef.current;
      const selected =
        current &&
        !sidebarClosingRef.current &&
        String((node as { id?: unknown }).id) === String(current.id);
      const centerId = centerNodeIdRef.current ?? "course";
      const isCenter = String((node as { id?: unknown }).id) === centerId;

      ctx.save();

      if (selected) {
        const glowR = r * 2;
        const gradient = ctx.createRadialGradient(x, y, r * 0.6, x, y, glowR);
        gradient.addColorStop(0, COLORS.glow);
        gradient.addColorStop(0.5, COLORS.glowStrong);
        gradient.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      ctx.shadowColor = selected ? COLORS.glow : COLORS.shadow;
      ctx.shadowBlur = selected ? 12 : 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = selected ? 0 : 2;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = selected ? COLORS.primaryLight : isCenter ? COLORS.primary : COLORS.border;
      ctx.lineWidth = selected ? 2.5 : isCenter ? 2 : 1;
      ctx.stroke();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      const label = (node.name as string) ?? "";
      const maxW = r * 1.85;
      let fontSize = isCenter ? 11 : 9;
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      let w = ctx.measureText(label).width;
      while (w > maxW && fontSize > 6) {
        fontSize -= 1;
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        w = ctx.measureText(label).width;
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = selected ? COLORS.primaryLight : COLORS.primary;
      ctx.fillText(label, x, y);

      ctx.restore();
    },
    [getNodeRadius]
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
    (node: { id?: string | number; name?: string; variant?: string; [key: string]: unknown }, _ev: MouseEvent) => {
      const id = String((node as GraphNode).id);
      setSelectedNode(node as GraphNode);
      setSidebarClosing(false);
      setCenterNodeId(id);
    },
    []
  );

  const handleBackgroundClick = useCallback(() => {
    if (selectedNodeRef.current) setSidebarClosing(true);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSidebarClosing(true);
  }, []);

  const handleSidebarTransitionEnd = useCallback(() => {
    setSelectedNode(null);
    setSidebarClosing(false);
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl border border-[#537aad]/15 bg-[#fffbf9]" style={{ minHeight: "500px" }}>
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <ForceGraph2D
          ref={fgRef as any}
          width={size.w}
          height={size.h}
          backgroundColor={COLORS.bg}
          linkColor={COLORS.link}
          linkWidth={1.5}
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={nodePointerAreaPaint}
          graphData={COURSE_GRAPH_DATA}
          cooldownTicks={Infinity}
          d3AlphaDecay={0.0228}
          d3VelocityDecay={0.25}
        minZoom={0.3}
        maxZoom={2}
        enableNodeDrag={true}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
      />
      </div>
      <ConceptSidebar
        node={selectedNode}
        isClosing={sidebarClosing}
        onClose={handleSidebarClose}
        onTransitionEnd={handleSidebarTransitionEnd}
      />
    </div>
  );
}
