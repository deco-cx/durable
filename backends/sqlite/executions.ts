import { WORKFLOW_NOT_COMPLETED } from "../backend.ts";

const TABLE_EXECUTIONS = "executions";

const escape = (str: string): string => `'${str}'`;

const RUNNING_STATUS = `(${WORKFLOW_NOT_COMPLETED.map(escape).join(",")})`;

// No CTID <=> ROWID equivalence to sqlite and PGSQL
export const pendingExecutionsSQLite = (
  lockInMinutes: number,
  limit: number,
) => `
UPDATE ${TABLE_EXECUTIONS}
SET locked_until = DATETIME(CURRENT_TIMESTAMP, '+${lockInMinutes} minutes')
WHERE status IN ${RUNNING_STATUS} 
  AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP) 
  AND id IN (
    SELECT id 
    FROM ${TABLE_EXECUTIONS} i
    WHERE i.id = ${TABLE_EXECUTIONS}.id -- use correlated subquery
      AND EXISTS (
        SELECT 1
        FROM pending_events
        WHERE execution_id = i.id 
          AND (visible_at IS NULL OR strftime('%s', visible_at) <= strftime('%s', CURRENT_TIMESTAMP))
      )
    LIMIT ${limit}
  ) 
RETURNING id;`;
