import { HistoryEvent } from "../../runtime/core/events.ts";
import { isoDate, valueOrNull } from "./utils.ts";

const queryEvents = (table: string, executionId: string) =>
  `SELECT id, type, timestamp, visible_at visibleAt, seq, attributes FROM ${table} WHERE execution_id='${executionId}'`;

export const queryPendingEvents = (executionId: string) =>
  `${
    queryEvents(
      "pending_events",
      executionId,
    )
  } AND (visible_at is NULL OR visible_at <= now()) ORDER BY visible_at ASC NULLS FIRST, timestamp ASC`;

export const queryHistory = (executionId: string): string =>
  `${queryEvents("history", executionId)} ORDER BY seq ASC`;

export const historyEventToValues =
  (executionId: string) =>
  ({ id, type, timestamp, visibleAt, seq, ...rest }: HistoryEvent): string => {
    return `('${id}', '${executionId}', '${type}', '${isoDate(timestamp)}', '${
      JSON.stringify(
        rest,
      )
    }', ${
      valueOrNull(visibleAt === undefined ? undefined : isoDate(visibleAt))
    }, ${seq})`;
  };

export const insertEvents = (
  table: string,
  executionId: string,
  events: HistoryEvent[],
): string => {
  return `INSERT INTO ${table} (id, execution_id, type, timestamp, attributes, visible_at, seq) VALUES ${
    events
      .map(historyEventToValues(executionId))
      .join(",")
  }`;
};

export const deleteEvents = (
  table: string,
  executionId: string,
  eventIds: HistoryEvent[],
) => {
  return `DELETE FROM ${table} WHERE execution_id='${executionId}' AND id IN (${
    eventIds
      .map(({ id }) => `'${id}'`)
      .join(",")
  })`;
};

export interface PersistedEvent {
  id: string;
  type: HistoryEvent["type"];
  timestamp: Date;
  seq: number;
  visibleAt?: Date;
  // deno-lint-ignore no-explicit-any
  attributes: any;
}

export const toHistoryEvent = ({
  id,
  type,
  timestamp,
  visibleAt,
  seq,
  attributes,
}: PersistedEvent): HistoryEvent => {
  return {
    id,
    type,
    seq,
    timestamp,
    visibleAt,
    ...attributes,
  };
};
