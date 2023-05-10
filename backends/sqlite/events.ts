const queryEvents = (table: string, executionId: string) =>
  `SELECT id, type, timestamp, visible_at visibleAt, seq, attributes FROM ${table} WHERE execution_id='${executionId}'`;

export const queryPendingEvents = (executionId: string) =>
  `${
    queryEvents(
      "pending_events",
      executionId,
    )
  } AND (visible_at IS NULL OR strftime('%s', visible_at) <= strftime('%s', CURRENT_TIMESTAMP)) ORDER BY visible_at ASC NULLS FIRST, timestamp ASC`;
