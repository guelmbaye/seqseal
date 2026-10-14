import { issue, type PwpsIssue } from "./errors";
import { parseDuration } from "./duration";
import { EVIDENCE_AUTHORITIES, type PwpsConstraint, type PwpsDocument } from "./types";

/** Strict-order edge: `from` MUST occur strictly before `to`. */
export interface OrderEdge {
  from: string;
  to: string;
  ruleId: string;
}

/** Normalize BEFORE / AFTER / WITHIN into strict precedence edges. */
export function precedenceEdges(constraints: PwpsConstraint[]): OrderEdge[] {
  const edges: OrderEdge[] = [];
  for (const c of constraints) {
    if (c.operator === "BEFORE") edges.push({ from: c.state, to: c.reference, ruleId: c.id });
    else if (c.operator === "AFTER") edges.push({ from: c.reference, to: c.state, ruleId: c.id });
    else if (c.operator === "WITHIN") edges.push({ from: c.after, to: c.state, ruleId: c.id });
  }
  return edges;
}

/** Semantic validation (SPEC §11.2). Assumes structural validation already passed. */
export function validateSemantics(doc: PwpsDocument): PwpsIssue[] {
  const issues: PwpsIssue[] = [];
  const stateIds = new Set<string>();
  const zoneIds = new Set<string>();
  const constraintIds = new Set<string>();

  // Zones
  (doc.zones ?? []).forEach((z, i) => {
    if (zoneIds.has(z.id)) issues.push(issue("PWPS-E011", `Duplicate zone id "${z.id}"`, `/zones/${i}/id`));
    zoneIds.add(z.id);
  });

  // States
  doc.states.forEach((s, i) => {
    if (stateIds.has(s.id)) issues.push(issue("PWPS-E010", `Duplicate state id "${s.id}"`, `/states/${i}/id`));
    stateIds.add(s.id);
    if (s.zone !== undefined) {
      if (doc.zones && !zoneIds.has(s.zone)) {
        issues.push(issue("PWPS-E012", `State "${s.id}" references undeclared zone "${s.zone}"`, `/states/${i}/zone`));
      } else if (!doc.zones) {
        issues.push(issue("PWPS-W005", `State "${s.id}" references zone "${s.zone}" but no zones are declared`, `/states/${i}/zone`));
      }
    }
  });

  const known = (id: string) => stateIds.has(id);
  const referenced = new Set<string>();
  const requiredByConstraint = new Set<string>();
  const forbiddenStates = new Set<string>();
  const forbiddenTransitions: Array<{ from: string; to: string; path: string }> = [];

  doc.constraints.forEach((c, i) => {
    const base = `/constraints/${i}`;
    if (constraintIds.has(c.id)) issues.push(issue("PWPS-E020", `Duplicate constraint id "${c.id}"`, `${base}/id`));
    constraintIds.add(c.id);

    const ref = (field: string, value: string | undefined) => {
      if (value === undefined) return;
      referenced.add(value);
      if (!known(value)) {
        issues.push(issue("PWPS-E021", `${c.id} references unknown state "${value}"`, `${base}/${field}`));
      }
    };
    const notApplicable = (fields: string[]) => {
      const raw = c as unknown as Record<string, unknown>;
      for (const f of fields) {
        if (raw[f] !== undefined) {
          issues.push(issue("PWPS-E024", `Field "${f}" is not applicable to operator ${c.operator}`, `${base}/${f}`));
        }
      }
    };

    switch (c.operator) {
      case "REQUIRED":
        ref("state", c.state);
        notApplicable(["reference", "after", "duration", "transition"]);
        requiredByConstraint.add(c.state);
        break;
      case "BEFORE":
      case "AFTER":
        ref("state", c.state);
        ref("reference", c.reference);
        notApplicable(["after", "duration", "transition"]);
        if (c.state === c.reference) {
          issues.push(issue("PWPS-E022", `${c.id}: "${c.state}" cannot be ordered relative to itself`, base));
        }
        break;
      case "WITHIN": {
        ref("state", c.state);
        ref("after", c.after);
        notApplicable(["reference", "transition"]);
        if (c.state === c.after) {
          issues.push(issue("PWPS-E022", `${c.id}: "${c.state}" cannot be timed relative to itself`, base));
        }
        const ms = parseDuration(c.duration);
        if (ms === null) issues.push(issue("PWPS-E030", `${c.id}: invalid duration "${c.duration}"`, `${base}/duration`));
        else if (ms <= 0) issues.push(issue("PWPS-E031", `${c.id}: duration must be > 0`, `${base}/duration`));
        break;
      }
      case "FORBIDDEN":
        notApplicable(["reference", "after", "duration"]);
        if (c.transition) {
          ref("transition/from", c.transition.from);
          ref("transition/to", c.transition.to);
          forbiddenTransitions.push({ from: c.transition.from, to: c.transition.to, path: `${base}/transition` });
        }
        if (c.state) {
          ref("state", c.state);
          forbiddenStates.add(c.state);
        }
        break;
      default: {
        const op = (c as { operator: string }).operator;
        issues.push(issue("PWPS-E050", `Unsupported operator "${op}"`, `${base}/operator`));
      }
    }
  });

  // Required contradictions
  doc.states.forEach((s, i) => {
    if (s.required === false && requiredByConstraint.has(s.id)) {
      issues.push(
        issue("PWPS-E040", `State "${s.id}" is declared required: false but a REQUIRED constraint targets it`, `/states/${i}/required`),
      );
    }
    const isRequired = s.required === true || requiredByConstraint.has(s.id);
    if (isRequired && forbiddenStates.has(s.id)) {
      issues.push(issue("PWPS-E042", `State "${s.id}" is both required and forbidden`, `/states/${i}`));
    }
  });

  // Transitions
  (doc.transitions ?? []).forEach((t, i) => {
    if (!known(t.from)) issues.push(issue("PWPS-E023", `Transition references unknown state "${t.from}"`, `/transitions/${i}/from`));
    if (!known(t.to)) issues.push(issue("PWPS-E023", `Transition references unknown state "${t.to}"`, `/transitions/${i}/to`));
    for (const f of forbiddenTransitions) {
      if (f.from === t.from && f.to === t.to) {
        issues.push(issue("PWPS-E043", `Transition ${t.from} → ${t.to} is both declared and forbidden`, f.path));
      }
    }
  });

  // Cycles in strict ordering (only between known states).
  const edges = precedenceEdges(doc.constraints).filter((e) => known(e.from) && known(e.to) && e.from !== e.to);
  const cycle = findCycle(edges);
  if (cycle) {
    issues.push(
      issue("PWPS-E041", `Strict ordering cycle: ${cycle.states.join(" → ")} (rules: ${cycle.rules.join(", ")})`, "/constraints"),
    );
  }

  // Evidence requirements
  const stateZone = new Map(doc.states.map((s) => [s.id, s.zone]));
  (doc.evidence ?? []).forEach((e, i) => {
    if (!known(e.state)) issues.push(issue("PWPS-E060", `Evidence requirement references unknown state "${e.state}"`, `/evidence/${i}/state`));
    for (const a of e.accepted_authority ?? []) {
      if (!(EVIDENCE_AUTHORITIES as readonly string[]).includes(a)) {
        issues.push(issue("PWPS-E061", `Unknown evidence authority "${a}"`, `/evidence/${i}/accepted_authority`));
      }
    }
    if (e.zone !== undefined && doc.zones && !zoneIds.has(e.zone)) {
      issues.push(issue("PWPS-E063", `Evidence requirement references undeclared zone "${e.zone}"`, `/evidence/${i}/zone`));
    }
    const sz = stateZone.get(e.state);
    if (e.zone && sz && e.zone !== sz) {
      issues.push(issue("PWPS-W020", `Evidence zone "${e.zone}" differs from state zone "${sz}"`, `/evidence/${i}/zone`));
    }
  });

  // Failure conditions
  (doc.failure_conditions ?? []).forEach((f, i) => {
    if (!constraintIds.has(f.constraint_ref)) {
      issues.push(issue("PWPS-E062", `Failure condition "${f.id}" references unknown constraint "${f.constraint_ref}"`, `/failure_conditions/${i}/constraint_ref`));
    }
  });

  // Authoring-quality warnings
  doc.states.forEach((s, i) => {
    if (!referenced.has(s.id) && s.required !== true) {
      issues.push(issue("PWPS-W001", `State "${s.id}" is never referenced by a constraint`, `/states/${i}`));
    }
  });
  if (!doc.states.some((s) => s.terminal === true)) issues.push(issue("PWPS-W002", undefined, "/states"));
  const md = doc.metadata as { description?: unknown } | undefined;
  if (!doc.protocol.description && !(md && typeof md.description === "string")) {
    issues.push(issue("PWPS-W003", undefined, "/metadata/description"));
  }

  return issues;
}

function findCycle(edges: OrderEdge[]): { states: string[]; rules: string[] } | null {
  const adj = new Map<string, OrderEdge[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: OrderEdge[] = [];
  let found: { states: string[]; rules: string[] } | null = null;

  const visit = (node: string): boolean => {
    color.set(node, GREY);
    for (const e of adj.get(node) ?? []) {
      const c = color.get(e.to) ?? WHITE;
      stack.push(e);
      if (c === GREY) {
        const start = stack.findIndex((s) => s.from === e.to);
        const path = stack.slice(start);
        found = { states: [...path.map((p) => p.from), e.to], rules: path.map((p) => p.ruleId) };
        return true;
      }
      if (c === WHITE && visit(e.to)) return true;
      stack.pop();
    }
    color.set(node, BLACK);
    return false;
  };

  for (const node of [...adj.keys()].sort()) {
    if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return found;
  }
  return null;
}
