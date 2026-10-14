# Contributing to PWPS

Thanks for helping keep PWPS small, portable and deterministic.

## Reporting issues

Open an issue with: the PWPS document (minimized), the command or API call, expected vs actual behavior,
and the diagnostic code if any.

## Proposing a new core operator or field

PWPS grows only from demonstrated need. A proposal MUST include:

1. **Normative semantics** — mechanically evaluable, deterministic, with explicit `NOT_EVALUABLE` behavior.
2. **Schema change** to `schema/pwps-0.1.schema.json` (or the next version's schema).
3. **A valid fixture** in `conformance/valid/`.
4. **An invalid fixture** in `conformance/invalid/` with a stable error code.
5. **An evaluation example** in `conformance/evaluation/cases.json`.
6. **A compatibility analysis** — does it change the meaning or hash of existing documents?

Proposals that add vendor fields, infrastructure, AI prompts, embedded code or business actions will be declined:
they belong to source bindings or consumer policies, not to the protocol.

## Development

```bash
pnpm install
pnpm vitest run packages/pwps
pnpm pwps validate examples/inbound-delivery.yaml
```

Rules:
- Every evaluator assumption must be written in SPEC.md. Undocumented semantics are bugs.
- Diagnostic codes are public API: never renumber, only add.
- Canonical hashes in `conformance/manifest.json` change only with an explicit, reviewed semantic change.

## Versioning

- PATCH: fixes that do not change validity, canonical form or evaluation results.
- MINOR: backward-compatible additions (new optional fields, new warnings).
- MAJOR: anything that changes the meaning of existing valid documents.

## Governance

PWPS is currently maintained by the SEQSEAL project team. It is not (yet) an industry standard and does not claim to be.
