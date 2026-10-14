# PWPS 0.1 — Physical Workflow Protocol Specification

| | |
|---|---|
| **Status** | Draft / Experimental |
| **Version** | 0.1.0 (document field `pwps: "0.1"`) |
| **Profile** | Linear Verification Profile |
| **License** | Apache License 2.0 |
| **Reference implementation** | `@pwps/core` (this package); first consumer: SEQSEAL |

PWPS is a small, vendor-neutral, machine-readable language for declaring what a
physical workflow is supposed to look like, in a form that machines can verify
against real-world evidence.

PWPS **declares**. It does not observe, infer, release or hold.

---

## 1. Terminology

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY** are to
be interpreted as described in RFC 2119.

| Term | Meaning |
|---|---|
| **Protocol** | A PWPS document describing one expected physical workflow. |
| **State** | A semantically meaningful, observable physical milestone (e.g. `staging`). |
| **Zone** | A logical physical space in which states occur (e.g. `staging-area`). |
| **Constraint** | A verifiable commitment over states (ordering, timing, requirement, prohibition). |
| **Evidence** | Data, produced outside PWPS, that establishes the occurrence time of a state. |
| **Evaluator** | Software that evaluates constraints against evidence. |
| **Consumer** | A system that uses evaluation results (e.g. to aggregate a verdict or choose a business action). |

## 2. Design principles

1. **Declarative.** A PWPS document MUST NOT contain executable code, scripts, model prompts, or network/file instructions.
2. **Deterministic.** Every core operator has mechanically evaluable semantics. There is no `REASONABLE_ORDER`.
3. **Uncertainty is first-class.** Evaluators MUST be able to answer *not evaluable* rather than guess.
4. **Absence is never violation.** Missing evidence never makes a constraint FAIL (§8.1).
5. **Small.** PWPS 0.1 is explainable in about a minute: states, zones, constraints, evidence, uncertainty.

## 3. Separation of concerns

```
PWPS                     → what SHOULD happen physically
Evidence source          → what WAS observed (cameras, RFID, IoT, manual logs …)
Evaluator                → which constraints PASS / FAIL / are NOT_EVALUABLE
Consumer policy          → what the business does next
```

A PWPS document MUST NOT contain:

- vendor device identifiers, webhook subtypes or API fields (bind sources to zones *outside* the protocol);
- infrastructure or cloud service names;
- AI model identifiers or prompts;
- business actions or verdict → action mappings (e.g. `DEVIATED → HOLD`).

**Portability test.** A valid protocol MUST remain meaningful if the evidence source changes (camera, RFID, manual).
**Action-neutrality test.** A valid protocol MUST remain meaningful if one consumer HOLDs on violation and another REVIEWs.

## 4. Document structure

```yaml
pwps: "0.1"                 # REQUIRED — specification version
protocol:                    # REQUIRED — identity
  id: "IDP-01"
  version: "1.0.0"
  name: "Inbound Delivery Integrity"
  description: "…"           # OPTIONAL
metadata: {}                 # OPTIONAL — informative, no semantics
zones: []                    # OPTIONAL
states: []                   # REQUIRED (≥ 1)
transitions: []              # OPTIONAL — informative structure
constraints: []              # REQUIRED (≥ 1)
evidence: []                 # OPTIONAL — semantic evidence requirements
uncertainty: {}              # OPTIONAL — defaults to NOT_EVALUABLE everywhere
failure_conditions: []       # OPTIONAL — documentation over constraints
extensions: {}               # OPTIONAL — vendor/application data, ignorable
```

Documents MAY be written in YAML 1.2 (core schema) or JSON. Both MUST compile to the same semantic document.

### 4.1 Identifiers

| Kind | Pattern | Example |
|---|---|---|
| Protocol id | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` | `IDP-01` |
| State / zone id | `^[a-z][a-z0-9-]{0,63}$` (lowercase, no spaces) | `storage-transition` |
| Constraint / rule id | `^[A-Za-z][A-Za-z0-9_.:-]{0,63}$` | `ORDER-02` |

### 4.2 Versioning

`pwps` is the specification version; `protocol.version` is the semantic version of the business protocol
(`MAJOR.MINOR.PATCH`). PATCH: non-semantic correction. MINOR: backward-compatible addition. MAJOR: behavioral change.
A protocol version used to finalize any execution MUST NOT be edited in place; publish a new version instead.

## 5. States and zones

```yaml
states:
  - id: staging
    name: Staging
    required: true     # default false
    terminal: false    # default false
    zone: staging
```

A state is **required** when `required: true` or when a `REQUIRED` constraint targets it. Declaring
`required: false` while a `REQUIRED` constraint targets the state is a contradiction (`PWPS-E040`).
If `zones` is declared, every `state.zone` MUST reference a declared zone (`PWPS-E012`).
States describe observable physical meaning, never subjective judgement (`trusted_driver` is not a state).

## 6. Constraints

All constraints have `id` (unique), `operator`, optional `description`, optional `severity`
(`MANDATORY` default, or `ADVISORY` — advisory results are reported but SHOULD NOT be treated as violations by consumers).

| Operator | Fields | Semantics |
|---|---|---|
| `REQUIRED` | `state` | Authoritative evidence MUST establish `state`. |
| `BEFORE` | `state`, `reference` | t(state) < t(reference) — strict. |
| `AFTER` | `state`, `reference` | t(state) > t(reference) — strict. |
| `WITHIN` | `state`, `after`, `duration` | 0 < t(state) − t(after) ≤ duration — inclusive maximum. |
| `FORBIDDEN` | `transition: {from, to}` **or** `state` | The direct transition (consecutive observed states) or the state MUST NOT occur. |

Fields not applicable to an operator are errors (`PWPS-E024`). A constraint MUST NOT relate a state to itself (`PWPS-E022`).
`BEFORE`, `AFTER` and `WITHIN` induce a strict precedence graph; a cycle is a contradiction (`PWPS-E041`).
Unsupported operators MUST be rejected, never guessed (`PWPS-E050`).

### 6.1 Durations

ISO 8601 durations restricted to `D`, `H`, `M`, `S` designators (fractional seconds up to milliseconds), e.g. `PT30S`, `PT5M`,
`PT1H30M`, `P1DT2H`. Years and months are rejected because their length is calendar-dependent (`PWPS-E030`).
Durations MUST be greater than zero (`PWPS-E031`).

## 7. Evidence requirements

```yaml
evidence:
  - state: staging
    required: true                 # default true
    zone: staging                  # defaults to the state's zone
    accepted_authority: [DIRECT, CONFIGURED, AI_ASSISTED, HUMAN_CONFIRMED]
```

Authority classes describe the **provenance mode** of evidence, not a universal trust ranking:

| Class | Meaning |
|---|---|
| `DIRECT` | Source semantics establish the state without interpretation. |
| `CONFIGURED` | Deterministic, configured mapping from source context to the state. |
| `AI_ASSISTED` | A model proposed the state from media or signals. |
| `HUMAN_CONFIRMED` | A human reviewer confirmed candidate evidence. |

Consumers MAY apply stricter acceptance policies outside the protocol. Evidence requirements MUST stay semantic:
`zone: staging` is valid, `ring_component: 0` is not.

## 8. Evaluation semantics (reference)

Evaluation is defined over a **timeline**: for each state, one of

- `PRESENT(at, precision?)` — authoritative evidence establishes the occurrence time `at` (epoch ms; the earliest accepted occurrence when several exist);
- `ABSENT` — no evidence;
- `UNRESOLVED(reason)` — evidence exists but is not authoritative (`UNRESOLVED_EVIDENCE`), the source could not observe (`COVERAGE_GAP`), or the timestamp is unusable (`AMBIGUOUS_TIMESTAMP`).

Each constraint evaluates to exactly one status:

| Status | Meaning |
|---|---|
| `PASS` | Evidence establishes that the constraint holds. |
| `FAIL` | Evidence positively establishes a violation. |
| `NOT_EVALUABLE` | The constraint cannot be decided; a `reason` is given. |
| `NOT_APPLICABLE` | The constrained condition did not arise (e.g. a forbidden transition whose states never both occurred). |

### 8.1 Absence is never FAIL

`REQUIRED` with an `ABSENT` state is `NOT_EVALUABLE` with reason `MISSING_EVIDENCE`. Ordering or timing constraints with an
absent operand are `NOT_EVALUABLE / MISSING_EVIDENCE`. How absence aggregates (e.g. "incomplete") is a consumer decision.

### 8.2 Unresolved outranks missing

If any operand is `UNRESOLVED`, the reason is the unresolved reason, never `MISSING_EVIDENCE`.

### 8.3 Strict order and precision

For `BEFORE`/`AFTER` with operands present at `a` and `b` (precision `p = max(pa, pb)`, default 0):
`|b − a| ≤ p` → `NOT_EVALUABLE / AMBIGUOUS_ORDER`; else `PASS` iff the required order holds, otherwise `FAIL`.
Equal timestamps never satisfy strict order and MUST NOT be ordered arbitrarily.

### 8.4 WITHIN

With delta `d = t(state) − t(after)` and maximum `m`: `|d| ≤ p` → `AMBIGUOUS_ORDER`; `d < 0` → `FAIL`; `d − p > m` → `FAIL`;
`d + p ≤ m` → `PASS`; otherwise `NOT_EVALUABLE / AMBIGUOUS_TIMING`. The maximum boundary is inclusive.

### 8.5 FORBIDDEN

Forbidden state: `PRESENT` → `FAIL`; `UNRESOLVED` → `NOT_EVALUABLE`; `ABSENT` → `PASS`.
Forbidden transition: evaluated over the observed sequence (PRESENT states ordered by time, ties by declaration order).
Either operand `UNRESOLVED` → `NOT_EVALUABLE`; either `ABSENT` → `NOT_APPLICABLE`; `from` immediately followed by `to` → `FAIL`; else `PASS`.

### 8.6 Implicit requirements

A state with `required: true` and no explicit `REQUIRED` constraint behaves as if `REQUIRED` were declared with id `REQ:<state>`.

## 9. Uncertainty

```yaml
uncertainty:
  ambiguous_ordering: NOT_EVALUABLE
  required_state_unresolved: NOT_EVALUABLE
  source_coverage_gap: NOT_EVALUABLE
```

In PWPS 0.1 the only permitted outcome is `NOT_EVALUABLE`; the section makes the behavior explicit and reserves room for
future profiles. Consumers MUST NOT convert `NOT_EVALUABLE` into `PASS`.

## 10. Canonicalization and hashing

`canonicalize(protocol)` produces canonical JSON:

1. Parse YAML/JSON; keep only known core properties (unknown properties never affect identity).
2. Make defaults explicit (`required: false`, `terminal: false`, `severity: MANDATORY`, `evidence.required: true`, uncertainty defaults).
3. Rewrite durations canonically (`PT300S` → `PT5M`).
4. Sort set-like arrays: `zones` (by id), `transitions`, `evidence` (by state), `accepted_authority`, `failure_conditions` (by id).
   `states` and `constraints` keep declaration order.
5. Serialize with object keys sorted by code unit, no insignificant whitespace, UTF-8.

`hash(protocol) = "sha256:" + hex(SHA-256(canonical JSON))`. Comments, indentation, key order and YAML/JSON choice MUST NOT change the hash.
A hash establishes content identity — not authorship, approval or legal validity.

## 11. Validation

### 11.1 Structural validation
Against `schema/pwps-0.1.schema.json` (JSON Schema draft-07).

### 11.2 Semantic validation
References, duplicates, contradictions, cycles, durations, applicability, evidence authorities, failure-condition references.

### 11.3 Modes
- **strict** (default): unknown core properties are errors (`PWPS-E005`).
- **compatible**: unknown core properties are ignored with `PWPS-W010`; core semantic incompatibilities still fail.

### 11.4 Diagnostic codes
Codes are stable public identifiers (see `src/errors.ts`). Errors: `E001–E005` document, `E010–E013` states/zones,
`E020–E050` constraints, `E060–E063` evidence/failure conditions, `E070` limits, `E080` parse.
Warnings: `W001` unreferenced state, `W002` no terminal state, `W003` missing description, `W005` zones undeclared,
`W010` ignored property, `W020` evidence/state zone mismatch.

## 12. Security considerations

1. PWPS documents may be untrusted. Parsers MUST enforce size and nesting limits, reject duplicate keys, bound YAML aliases and
   use only the YAML core schema (no custom tags).
2. Documents are data. Embedded code, prompts and network/file instructions are prohibited and rejected in strict mode.
3. Validation establishes well-formedness, not authenticity. A valid protocol can still be operationally wrong; humans remain
   responsible for authoring appropriate requirements.
4. A valid protocol evaluated against untrustworthy evidence does not produce a trustworthy result. Evidence provenance and
   authentication are the consumer's responsibility.

## 13. Conformance

| Level | Requirement | Fixtures |
|---|---|---|
| 1 — Parser | Parse valid YAML/JSON PWPS within limits | `conformance/valid` |
| 2 — Validator | Accept valid, reject invalid with the listed codes | `conformance/invalid`, `manifest.json` |
| 3 — Canonicalization | Produce the expected canonical hash | `conformance/canonical` |
| 4 — Reference semantics (optional) | Produce the expected rule statuses | `conformance/evaluation/cases.json` |

Conformance tests assert rule statuses (e.g. `ORDER-02 = FAIL`), never workflow verdicts or business actions.

## 14. Reference API

```ts
parsePwps(source) · validatePwps(input, { mode }) · canonicalizePwps(doc) · hashPwps(doc)
compilePwps(input) → CompiledProtocol · evaluateRules(compiled, timeline) → RuleResult[]
```

CLI: `pwps validate | inspect | hash | canonicalize | compile | eval`.

## 15. Out of scope for 0.1

Loops, parallel branches, BPMN-style gateways, nested protocols, cardinality, probabilistic constraints, compensation,
learned protocols, signed artifacts, business actions. Each requires a demonstrated need, normative semantics, schema changes,
valid and invalid fixtures and a compatibility analysis (see CONTRIBUTING.md).

## 16. Relationship to other standards

PWPS does not replace BPMN, state machines or rule engines. It is a deliberately narrow, verification-oriented contract for
observed physical execution: states, zones, ordering, timing, evidence requirements and uncertainty, with deterministic
canonicalization and conformance.
