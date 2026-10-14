# Changelog

## 0.1.0 — 2026-10

Initial draft of PWPS 0.1 (Linear Verification Profile).

- Specification (`SPEC.md`): states, zones, constraints (`REQUIRED`, `BEFORE`, `AFTER`, `WITHIN`, `FORBIDDEN`),
  evidence requirements, first-class uncertainty, canonicalization, hashing, conformance levels.
- JSON Schema `schema/pwps-0.1.schema.json`.
- Reference implementation: parser (YAML core schema / JSON, size, depth and alias limits), structural and semantic
  validator with stable diagnostic codes, strict / compatible modes, canonicalizer, SHA-256 hash, compiler,
  reference rule evaluator.
- CLI: `validate`, `inspect`, `hash`, `canonicalize`, `compile`, `eval`.
- Conformance fixtures: valid, invalid, canonical (pinned hashes), evaluation cases.
- Examples: inbound delivery (IDP-01), equipment handoff, minimal.
