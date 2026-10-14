/**
 * execution-sweeper — scheduled (rate 5 min). Requests finalization of ACTIVE executions
 * older than EXECUTION_HORIZON_MINUTES so that missing evidence eventually yields a final
 * INCOMPLETE → WAIT (or UNCERTAIN → REVIEW) instead of waiting forever. Never RELEASE.
 */
import { awsRuntime } from "@seqseal/aws";

export async function handler(): Promise<{ finalized: string[] }> {
  const rt = await awsRuntime("execution-sweeper");
  const horizonMs = Number(process.env.EXECUTION_HORIZON_MINUTES ?? "30") * 60_000;
  const now = Date.now();
  const finalized: string[] = [];
  for (const e of await rt.pipeline.store.listExecutions(500)) {
    if (e.status !== "ACTIVE") continue;
    if (now - Date.parse(e.created_at) < horizonMs) continue;
    await rt.pipeline.finalize(e.execution_id, "HORIZON_REACHED");
    finalized.push(e.execution_id);
  }
  rt.log.info("sweep_completed", { finalized });
  return { finalized };
}
