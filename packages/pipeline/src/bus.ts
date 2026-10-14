import { randomUUID } from "node:crypto";
import { EVENT_TYPES, EVENT_VERSION, type DomainEvent, type EventName } from "@seqseal/contracts";

/** Where domain events go: the in-process queue locally, EventBridge on AWS. */
export interface EventSink {
  publish(events: DomainEvent[]): Promise<void>;
}

export function makeEvent(
  name: EventName,
  args: { correlation_id: string; execution_id?: string; payload: Record<string, unknown>; occurred_at: string },
): DomainEvent {
  return {
    event_id: `EVT-${randomUUID()}`,
    event_type: EVENT_TYPES[name],
    name,
    event_version: EVENT_VERSION,
    occurred_at: args.occurred_at,
    correlation_id: args.correlation_id,
    ...(args.execution_id ? { execution_id: args.execution_id } : {}),
    payload: args.payload,
  };
}

/** FIFO in-process bus. `drain` is driven by the LocalRuntime. */
export class InMemoryBus implements EventSink {
  readonly queue: DomainEvent[] = [];
  readonly published: DomainEvent[] = [];
  async publish(events: DomainEvent[]) {
    this.queue.push(...events);
    this.published.push(...events);
  }
}

/** Sink that discards events (unit tests of individual steps). */
export class NullSink implements EventSink {
  async publish() {}
}
