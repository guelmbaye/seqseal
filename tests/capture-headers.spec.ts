import { describe, expect, it } from "vitest";
import { provenanceHeaders } from "../apps/web/lib/capture-headers";

describe("console in remote mode: capture provenance forwarded to AWS", () => {
  it("keeps a Ring-derived replay labelled as one", () => {
    expect(
      provenanceHeaders({ "content-type": "application/json", "X-SeqSeal-Source-Profile": "RING_DERIVED_REPLAY", "x-seqseal-replay-run": "rdr-abc" }),
    ).toEqual({ "x-seqseal-source-profile": "RING_DERIVED_REPLAY", "x-seqseal-replay-run": "rdr-abc" });
  });
  it("forwards nothing for a live capture, and never the caller's credentials", () => {
    expect(provenanceHeaders({ "content-type": "application/json", "x-seqseal-demo-token": "t", authorization: "Bearer x" })).toEqual({});
  });
});
