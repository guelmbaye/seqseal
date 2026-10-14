import type { CompiledProtocol } from "@pwps/core";
import {
  RESOLVER_VERSION,
  sha256Hex,
  type EvidenceCandidate,
  type EvidenceMappingRule,
  type NormalizedObservation,
  type SourceBinding,
  type SourceRef,
} from "@seqseal/contracts";
import type { SourceConfig } from "./config";

/* ───────────────────────────── Bindings ───────────────────────────── */

export interface BindingMatch {
  binding?: SourceBinding;
  ambiguous?: SourceBinding[];
}

/**
 * Bind an observation to a SEQSEAL logical zone (Doc 04 §16–18). Matching is
 * capability/configuration driven — never inferred from device names or component order.
 * The most specific matching binding wins; equally specific bindings to different zones
 * are ambiguous and leave the zone UNKNOWN.
 */
export function bindObservation(obs: NormalizedObservation, bindings: SourceBinding[]): BindingMatch {
  const sessionZone = typeof obs.attributes.session_zone === "string" ? obs.attributes.session_zone : undefined;
  const scored: Array<{ b: SourceBinding; score: number }> = [];
  for (const b of bindings) {
    if (!b.active || !b.source_profiles.includes(obs.source_profile)) continue;
    let score = 0;
    if (b.source_device_ref !== undefined) {
      if (b.source_device_ref !== obs.source_device_ref) continue;
      score++;
    }
    if (b.component_ref !== undefined) {
      if (!obs.source_component_refs.includes(b.component_ref)) continue;
      score++;
    }
    if (b.simulation_source !== undefined) {
      if (b.simulation_source !== obs.simulation_source) continue;
      score++;
    }
    if (b.session_zone !== undefined) {
      if (b.session_zone !== sessionZone) continue;
      score++;
    }
    if (score === 0) continue; // a binding must constrain something
    scored.push({ b, score });
  }
  if (!scored.length) return {};
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best).map((s) => s.b);
  const zones = new Set(top.map((b) => b.logical_zone));
  if (zones.size > 1) return { ambiguous: top };
  return { binding: top[0]! };
}

/* ───────────────────────────── Resolution ───────────────────────────── */

export interface InterpretationDraft {
  mapping: EvidenceMappingRule;
  state: string;
  logical_zone: string;
  observation: NormalizedObservation;
}

export type Resolution =
  | { kind: "NOT_EVIDENCE"; reason: string }
  | { kind: "UNBOUND"; reason: string }
  | { kind: "NO_MAPPING"; reason: string }
  | { kind: "CANDIDATE"; candidate: EvidenceCandidate; mapping: EvidenceMappingRule }
  | { kind: "NEEDS_INTERPRETATION"; draft: InterpretationDraft };

export function sourceRefOf(obs: NormalizedObservation): SourceRef {
  return {
    provider: obs.source_provider,
    source_profile: obs.source_profile,
    ...(obs.source_event_ref ? { source_event_ref: obs.source_event_ref } : {}),
    ...(obs.request_ref ? { request_ref: obs.request_ref } : {}),
    ...(obs.source_device_ref ? { device_ref: obs.source_device_ref } : {}),
    ...(obs.source_component_refs.length ? { component_refs: [...obs.source_component_refs] } : {}),
    ...(obs.media_session_ref ? { media_session_ref: obs.media_session_ref } : {}),
    ...(obs.simulation_source ? { simulation_source: obs.simulation_source } : {}),
    ...(obs.source_account_ref ? { account_ref: obs.source_account_ref } : {}),
  };
}

/** Deterministic, human-readable evidence identifiers derived from source + resolver version. */
export function candidateIdFor(obs: NormalizedObservation, state: string, mappingId: string): string {
  return `CAN-${state.toUpperCase()}-${sha256Hex(`${obs.observation_id}|${mappingId}|${RESOLVER_VERSION}`).slice(0, 8)}`;
}
export function evidenceIdFor(candidateId: string, suffix = ""): string {
  return candidateId.replace(/^CAN-/, "EV-") + suffix;
}

/**
 * Deterministic-first resolution (Doc 03 §13, Doc 06 §39):
 *   DIRECT → CONFIGURED_MAPPING → AI_ASSISTED (only when a mapping explicitly routes there).
 * Health events never become workflow evidence; unbound observations never become evidence.
 */
export function resolveObservation(obs: NormalizedObservation, config: SourceConfig, protocol: CompiledProtocol, now: string): Resolution {
  if (obs.family === "INTEGRATION_HEALTH") return { kind: "NOT_EVIDENCE", reason: `${obs.event_type} is integration-health metadata, never workflow evidence.` };
  if (obs.family !== "WORKFLOW_PHYSICAL") return { kind: "NOT_EVIDENCE", reason: `Unknown event type "${obs.event_type}" stored safely; no workflow state invented.` };
  const zone = obs.logical_zone;
  if (!zone) return { kind: "UNBOUND", reason: "No source binding resolves this observation to a logical zone." };

  const matches = config.mappings.filter(
    (m) =>
      m.when.logical_zone === zone &&
      m.when.event_type.includes(obs.event_type) &&
      (!m.when.event_subtype || (obs.event_subtype !== undefined && m.when.event_subtype.includes(obs.event_subtype))) &&
      (!m.when.simulation_source || (obs.simulation_source !== undefined && m.when.simulation_source.includes(obs.simulation_source))),
  );
  if (!matches.length) return { kind: "NO_MAPPING", reason: `No mapping for ${obs.event_type}${obs.event_subtype ? `.${obs.event_subtype}` : ""} in zone ${zone}.` };
  // Deterministic preference: DIRECT, then CONFIGURED_MAPPING, then AI_ASSISTED; config order breaks ties.
  const rank = { DIRECT: 0, CONFIGURED_MAPPING: 1, AI_ASSISTED: 2 } as const;
  const mapping = [...matches].sort((a, b) => rank[a.interpretation_mode] - rank[b.interpretation_mode])[0]!;
  if (!protocol.stateIndex[mapping.state]) {
    return { kind: "NO_MAPPING", reason: `Mapping ${mapping.mapping_id} targets "${mapping.state}", unknown to ${protocol.ref}.` };
  }

  if (mapping.interpretation_mode === "AI_ASSISTED") {
    return { kind: "NEEDS_INTERPRETATION", draft: { mapping, state: mapping.state, logical_zone: zone, observation: obs } };
  }

  const candidate: EvidenceCandidate = {
    candidate_id: candidateIdFor(obs, mapping.state, mapping.mapping_id),
    semantic_state: mapping.state,
    occurred_at: obs.occurred_at,
    time_precision_ms: obs.time_precision_ms ?? 0,
    logical_zone: zone,
    interpretation_mode: mapping.interpretation_mode,
    status: "CANDIDATE",
    mapping_id: mapping.mapping_id,
    observation_refs: [obs.observation_id],
    source_refs: [sourceRefOf(obs)],
    resolver_version: RESOLVER_VERSION,
    created_at: now,
  };
  return { kind: "CANDIDATE", candidate, mapping };
}

/** Startup check: every mapping targets a protocol state whose declared zone matches. */
export function validateSourceConfigAgainstProtocol(config: SourceConfig, protocol: CompiledProtocol): string[] {
  const errors: string[] = [];
  if (config.protocol !== protocol.id) errors.push(`Source config targets ${config.protocol}, active protocol is ${protocol.id}.`);
  const zones = new Set(protocol.zones.map((z) => z.id));
  for (const b of config.bindings) if (zones.size && !zones.has(b.logical_zone)) errors.push(`Binding ${b.binding_id}: unknown zone ${b.logical_zone}.`);
  for (const m of config.mappings) {
    const s = protocol.stateIndex[m.state];
    if (!s) errors.push(`Mapping ${m.mapping_id}: unknown state ${m.state}.`);
    else if (s.zone && s.zone !== m.when.logical_zone) errors.push(`Mapping ${m.mapping_id}: state ${m.state} belongs to zone ${s.zone}, not ${m.when.logical_zone}.`);
  }
  return errors;
}
