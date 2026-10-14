import type { DomainEvent } from "@seqseal/contracts";

const COUNTED = new Set(["WorkflowReleased", "WorkflowHeld", "WorkflowReviewRequired", "WorkflowAwaitingEvidence", "SystemError", "ReceiptGenerated", "EvidenceAccepted", "EvidenceUnresolved"]);

/**
 * CloudWatch Embedded Metric Format — metrics from structured logs, no extra IAM.
 * Namespace "SEQSEAL", dimension Environment (matches the Terraform dashboard).
 */
export function emitMetrics(events: DomainEvent[], environment = process.env.SEQSEAL_ENVIRONMENT ?? "dev") {
  const counts = new Map<string, number>();
  for (const e of events) if (COUNTED.has(e.name)) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  if (!counts.size) return;
  const names = [...counts.keys()];
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{ Namespace: "SEQSEAL", Dimensions: [["Environment"]], Metrics: names.map((Name) => ({ Name, Unit: "Count" })) }],
      },
      Environment: environment,
      ...Object.fromEntries(counts),
      execution_ids: [...new Set(events.flatMap((e) => (e.execution_id ? [e.execution_id] : [])))],
      correlation_ids: [...new Set(events.map((e) => e.correlation_id))],
    }),
  );
}
