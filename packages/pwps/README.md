# PWPS — Physical Workflow Protocol Specification

**A vendor-neutral specification for evidence-verifiable physical workflows.**
Declare physical workflow expectations. Verify them against real-world evidence.

> Status: **PWPS 0.1 — Draft / Experimental**. License: Apache-2.0.

```
Expected   ARRIVAL → STAGING → STORAGE
Rule       ORDER-02  STAGING BEFORE STORAGE

Observed   ARRIVAL → STORAGE → STAGING
ORDER-02   FAIL
```

Physical workflows usually live in SOPs, checklists and people's heads. PWPS turns the *verifiable part* of
that expectation into a small, portable, hashable document that any evaluator can check against any trustworthy
evidence source — cameras, RFID, IoT sensors or manual logs.

```yaml
- id: ORDER-02
  operator: BEFORE
  state: staging
  reference: storage
```

PWPS declares **what should happen physically**. It never contains vendor device IDs, cloud services,
AI prompts or business actions such as "hold the shipment" — those belong to the systems that consume it.

## Quick start

```bash
npm install @pwps/core          # or: pnpm add @pwps/core
npx pwps validate examples/inbound-delivery.yaml
npx pwps hash examples/inbound-delivery.yaml
npx pwps eval examples/inbound-delivery.yaml examples/timeline-wrong-order.json
```

```
✓ PWPS 0.1 valid  examples/inbound-delivery.yaml
Protocol: IDP-01@1.0.0
States: 5
Constraints: 11
Hash: sha256:6f0ad940…
```

## Library

```ts
import { validatePwps, compilePwps, hashPwps, evaluateRules } from "@pwps/core";

const protocol = compilePwps(readFileSync("inbound-delivery.yaml", "utf8"));
protocol.expectedSequence; // ["arrival", "staging", "storage", "departure", "clear"]
protocol.hash;             // "sha256:…"

const results = evaluateRules(protocol, {
  arrival: { status: "PRESENT", at: Date.parse("2026-10-18T14:00:00Z") },
  storage: { status: "PRESENT", at: Date.parse("2026-10-18T14:03:00Z") },
  staging: { status: "PRESENT", at: Date.parse("2026-10-18T14:06:00Z") },
});
results.find((r) => r.rule_id === "ORDER-02")?.status; // "FAIL"
```

## The language in 60 seconds

| Concept | Purpose |
|---|---|
| **States** | Observable physical milestones (`arrival`, `staging`, …), optionally required / terminal. |
| **Zones** | Logical physical spaces where states occur. |
| **Constraints** | `REQUIRED`, `BEFORE`, `AFTER`, `WITHIN` (ISO 8601 durations), `FORBIDDEN`. |
| **Evidence** | Which evidence classes (`DIRECT`, `CONFIGURED`, `AI_ASSISTED`, `HUMAN_CONFIRMED`) may establish a state. |
| **Uncertainty** | First-class `NOT_EVALUABLE` — evaluators never guess. |

Key semantics: strict ordering (equal timestamps are *not* ordered), inclusive `WITHIN` maximum,
and **absence is never a violation** (missing evidence is `NOT_EVALUABLE`, not `FAIL`).

## Toolchain

| Command | Description |
|---|---|
| `pwps validate <file…> [--compatible] [--json]` | Structural (JSON Schema) + semantic validation with stable error codes |
| `pwps inspect <file>` | Human summary of states and constraints |
| `pwps hash <file>` | Canonical SHA-256 content identity |
| `pwps canonicalize <file>` | Canonical JSON |
| `pwps compile <file>` | Compiled protocol graph (JSON) |
| `pwps eval <protocol> <timeline.json>` | Reference rule evaluation |

## Repository layout

```
SPEC.md                    normative specification
schema/pwps-0.1.schema.json
src/                       parser · validator · canonicalizer · hash · compiler · reference evaluator · CLI
examples/                  inbound delivery, equipment handoff, minimal
conformance/               valid / invalid / canonical / evaluation fixtures + manifest.json
test/                      conformance and unit tests
```

## Conformance

`conformance/manifest.json` drives four levels: parser, validator (stable error codes), canonicalization
(pinned hashes — YAML and reordered JSON must hash identically) and reference rule semantics.
Conformance asserts rule statuses only — never workflow verdicts or business actions.

## Why not BPMN / a state machine / a rules engine?

PWPS does not replace them. It is a deliberately narrow, verification-oriented contract for *observed physical execution*:
states, zones, ordering, timing, evidence requirements and uncertainty, with deterministic canonicalization and conformance tests.

## Reference implementation

[SEQSEAL](../../README.md) is the first consumer: it evaluates IDP-01 against Ring-derived evidence and maps the
result to an operational action through its own, separate action policy. PWPS itself has no dependency on Ring, AWS or SEQSEAL.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New core operators require normative semantics, schema changes, valid and invalid
fixtures, an evaluation example and a compatibility analysis.
