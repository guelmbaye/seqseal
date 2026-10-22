/**
 * What a Ring Developer Playground capture actually proves, read from the attributes the
 * Playground normalizer records on the observation. Pure, so the evidence drawer and tests
 * share one wording.
 */
export interface RingProof {
  /** "event": bound to a Ring history event. "api-call": only a Ring API call answered. */
  kind: "event" | "api-call";
  /** What Ring supplied, in plain words. */
  label: string;
  /** Where the step's time comes from. */
  time: string;
  /** Shown when the proof is weaker than a Ring event. */
  note?: string;
}

export function ringProof(attributes: Record<string, unknown> | undefined): RingProof | undefined {
  if (!attributes || typeof attributes.api_endpoint !== "string") return undefined; // not a Playground capture
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const endpoint = str(attributes.api_endpoint)!;
  const call = `${str(attributes.api_method) ?? "GET"} ${endpoint.replace(/ava1\.ring\.device\.[A-Z0-9]+/g, "{device}")}${
    typeof attributes.api_status === "number" ? `, HTTP ${attributes.api_status}` : ""
  }`;
  const proof = str(attributes.ring_proof);
  const hasEvent = proof ? proof === "ring history event" : !!str(attributes.ring_event_type);
  const fromRing = str(attributes.time_source) === "ring history event start";
  if (hasEvent) {
    return {
      kind: "event",
      label: `Ring history event${str(attributes.ring_event_type) ? ` (${str(attributes.ring_event_type)})` : ""}, read with ${call}`,
      time: fromRing ? "Start of the Ring event" : "Capture time (Ring gave no time for the event)",
    };
  }
  return {
    kind: "api-call",
    label: `Ring API call only: ${call}`,
    time: "Capture time",
    note: "Ring's event history did not list this simulation. The Ring API answered for this device when the step was captured, but this record does not prove that the simulation itself ran. The step's time is the capture time.",
  };
}

/**
 * Who decided what for a Ring Developer Playground step. The Playground does not classify its
 * footage, so the operator binds each Ring event to a simulation and a dock zone; the verdict and
 * the action are never the operator's.
 */
export function operatorBinding(simulationSource: string | undefined, zone: string | undefined): string | undefined {
  if (!simulationSource) return undefined;
  return (
    `The Ring Developer Playground does not classify its footage, so the operator bound this Ring event to the ${simulationSource} simulation` +
    `${zone ? ` and the ${zone} zone` : ""}. The operator does not choose the verdict or the action: SEQSEAL computes both from the order and times of the steps.`
  );
}
