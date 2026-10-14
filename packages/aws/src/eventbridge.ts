import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { EVENT_SOURCE, DomainEvent } from "@seqseal/contracts";
import type { EventSink } from "@seqseal/pipeline";

/** Publishes domain events to the custom bus: Source "seqseal", DetailType = event_type. */
export class EventBridgeSink implements EventSink {
  constructor(
    private readonly busName: string,
    private readonly client = new EventBridgeClient({}),
  ) {}

  async publish(events: DomainEvent[]) {
    for (let i = 0; i < events.length; i += 10) {
      const batch = events.slice(i, i + 10);
      const r = await this.client.send(
        new PutEventsCommand({
          Entries: batch.map((e) => ({
            EventBusName: this.busName,
            Source: EVENT_SOURCE,
            DetailType: e.event_type,
            Detail: JSON.stringify(e),
            Time: new Date(e.occurred_at),
          })),
        }),
      );
      if (r.FailedEntryCount) {
        const failed = (r.Entries ?? []).map((x, j) => (x.ErrorCode ? `${batch[j]?.name}:${x.ErrorCode}` : null)).filter(Boolean);
        const err = new Error(`EventBridge PutEvents failed for ${failed.join(", ")}`);
        err.name = "EventBridgePublishError";
        throw err;
      }
    }
  }
}

/** Extract the DomainEvent from an SQS message body delivered by an EventBridge rule. */
export function domainEventFromSqsBody(body: string): DomainEvent {
  const envelope = JSON.parse(body) as { detail?: unknown; source?: string };
  const detail = envelope.detail ?? envelope;
  return DomainEvent.parse(detail);
}
