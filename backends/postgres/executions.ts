import { WORKFLOW_NOT_COMPLETED, WorkflowExecution } from "../backend.ts";
import { isoDate, valueOrNull } from "./utils.ts";

const TABLE_EXECUTIONS = "executions";
export const insertExecution = (
  executionId: string,
  { alias, completedAt, output, input, status }: WorkflowExecution,
): string => {
  return `INSERT INTO ${TABLE_EXECUTIONS} (id, alias, completed_at, output, input, status) VALUES('${executionId}', '${alias}', ${
    valueOrNull(
      completedAt === undefined ? undefined : isoDate(completedAt),
    )
  }, ${
    valueOrNull(output === undefined ? undefined : JSON.stringify(output))
  }, ${
    valueOrNull(input === undefined ? undefined : JSON.stringify(input))
  }, '${status}')`;
};

export const updateExecution = (
  executionId: string,
  { alias, completedAt, output, input, status }: WorkflowExecution,
): string => {
  return `UPDATE ${TABLE_EXECUTIONS} SET status='${status}', alias='${alias}', completed_at=${
    valueOrNull(
      completedAt === undefined ? undefined : isoDate(completedAt),
    )
  }, output=${
    valueOrNull(
      output !== undefined ? JSON.stringify(output) : undefined,
    )
  }, input=${
    valueOrNull(
      input !== undefined ? JSON.stringify(input) : undefined,
    )
  } WHERE id='${executionId}'`;
};

export const getExecution = (executionId: string): string => {
  return `SELECT id, alias, completed_at completedAt, output, input, status FROM ${TABLE_EXECUTIONS} WHERE id='${executionId}'`;
};

export const unlockExecution = (executionId: string): string => {
  return `UPDATE ${TABLE_EXECUTIONS} SET locked_until = NULL WHERE id='${executionId}'`;
};
const escape = (str: string): string => `'${str}'`;

const RUNNING_STATUS = `(${WORKFLOW_NOT_COMPLETED.map(escape).join(",")})`;

export const pendingExecutions = (lockInMinutes: number, limit: number) => `
UPDATE ${TABLE_EXECUTIONS}
SET locked_until = now()::timestamp + interval '${lockInMinutes} minutes'
WHERE ctid IN (
  SELECT ctid FROM ${TABLE_EXECUTIONS} i
    WHERE
      (locked_until IS NULL OR locked_until < now())
      AND status IN ${RUNNING_STATUS}
      AND EXISTS (
        SELECT 1
          FROM pending_events
          WHERE execution_id = i.id AND (visible_at IS NULL OR visible_at <= now())
      )
    LIMIT ${limit}
) RETURNING id
`;
