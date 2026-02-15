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

/** Extract flat concept names from ClassEntry. */
function extractConcepts(entry: ClassEntry): string[] {
  if (Array.isArray(entry.concepts) && entry.concepts.length > 0) {
    return entry.concepts.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  }
  if (Array.isArray(entry.units)) {
    const names: string[] = [];
    for (const unit of entry.units) {
      if (typeof unit?.unit_name === "string" && unit.unit_name.trim()) {
        names.push(unit.unit_name.trim());
      }
      for (const topic of unit?.topics ?? []) {
        if (typeof topic?.topic_name === "string" && topic.topic_name.trim()) {
          names.push(topic.topic_name.trim());
        }
        for (const sub of topic?.subtopics ?? []) {
          if (typeof sub?.subtopic_name === "string" && sub.subtopic_name.trim()) {
            names.push(sub.subtopic_name.trim());
          }
        }
      }
    }
    return [...new Set(names)];
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
    val: 36,
    radius: 80,
    targetRadius: 0,
    variant: "center",
  };

  const concepts = extractConcepts(entry);
  const conceptNodes: GraphNode[] = concepts.map((name) => {
    const id = slugify(`${className}-${name}`);
    const radius = 40 + (hash(id) % 16);
    const targetRadius = 90 + (hash(id) % 110);
    return {
      id,
      name,
      val: 12,
      radius,
      targetRadius,
      variant: "concept" as const,
    };
  });

  const nodes = [centerNode, ...conceptNodes];
  const links: GraphLink[] = conceptNodes.map((n) => ({ source: centerId, target: n.id }));

  return { nodes, links };
}
