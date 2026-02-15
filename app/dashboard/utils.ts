/**
 * Builds graph data for the bubble map from classNames.json.
 * Supports both formats:
 * - addConcepts.js: { className, concepts: string[] }
 * - Concepts API: { courseId, className, units: [{ topics: [{ subtopics: [...] }] }] }
 * Bubble map generation works after addConcepts.js or the concepts API runs.
 */

export type UnitEntry = {
  unit_id?: string;
  unit_name?: string;
  topics?: Array<{
    topic_id?: string;
    topic_name?: string;
    subtopics?: Array<{ subtopic_id?: string; subtopic_name?: string }>;
  }>;
};

export type ClassEntry = {
  courseId?: string;
  className: string;
  /** From addConcepts.js: flat concept names */
  concepts?: string[];
  /** From concepts API: units → topics → subtopics */
  units?: UnitEntry[];
};

export type ClassNamesPayload = {
  classes: ClassEntry[];
  classNames?: string[];
  updatedAt?: string;
};

export type GraphNode = {
  id: string;
  name: string;
  val: number;
  radius: number;
  targetRadius?: number;
  variant: "center" | "concept";
  /** Full unit data for sidebar (topics/subtopics) when node is a unit */
  unitData?: UnitEntry;
  /** Initial position to reduce physics jitter on first render */
  x?: number;
  y?: number;
};

export type GraphLink = { source: string; target: string };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function slugify(s: string): string {
  return s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase() || `node-${hash(s)}`;
}

/** Extract only UNITS for bubblemap nodes. Topics/subtopics shown in sidebar on click. */
function extractUnits(entry: ClassEntry): Array<{ name: string; unitData: UnitEntry }> {
  if (Array.isArray(entry.units) && entry.units.length > 0) {
    return entry.units
      .filter((u): u is UnitEntry => u != null && typeof u?.unit_name === "string" && u.unit_name.trim().length > 0)
      .map((unit) => ({ name: unit.unit_name!.trim(), unitData: unit }));
  }
  /** Fallback: addConcepts.js flat concepts treated as unit-like nodes (no topic/subtopic detail) */
  if (Array.isArray(entry.concepts) && entry.concepts.length > 0) {
    return entry.concepts
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .map((name) => ({ name: name.trim(), unitData: { unit_name: name.trim() } }));
  }
  return [];
}

export function buildGraphFromClass(entry: ClassEntry): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const className = typeof entry.className === "string" ? entry.className.trim() : "Course";
  const centerId = slugify(className);
  const centerNode: GraphNode = {
    id: centerId,
    name: className,
    val: 30,
    radius: 85,
    targetRadius: 0,
    variant: "center",
  };

  const units = extractUnits(entry);
  const n = units.length;
  const conceptNodes: GraphNode[] = units.map(({ name, unitData }, i) => {
    const uniqueId = unitData?.unit_id ?? `unit-${i}`;
    const id = slugify(`${className}-${uniqueId}`);
    const radius = 48 + (hash(id) % 12);
    const targetRadius = 110 + (hash(id) % 68);
    const angle = n > 0 ? (2 * Math.PI * i) / n - Math.PI / 2 : 0;
    const r = targetRadius;
    return {
      id,
      name,
      val: 12,
      radius,
      targetRadius,
      variant: "concept" as const,
      unitData,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    };
  });

  const nodes = [centerNode, ...conceptNodes];
  const links: GraphLink[] = conceptNodes.map((n) => ({ source: centerId, target: n.id }));

  return { nodes, links };
}

/** Get the graph node id for a unit (for selection/syncing with sidebar). */
export function getUnitNodeId(classEntry: ClassEntry, unit: UnitEntry, index: number): string {
  const className = typeof classEntry.className === "string" ? classEntry.className.trim() : "Course";
  const uniqueId = unit?.unit_id ?? `unit-${index}`;
  return slugify(`${className}-${uniqueId}`);
}
