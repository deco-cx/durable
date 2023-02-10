export default `
DO $$ BEGIN
    CREATE TYPE WORKFLOW_STATUS AS ENUM ('completed', 'canceled', 'sleeping', 'running');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS executions (
    id TEXT,
    alias TEXT NOT NULL,
    completed_at TIMESTAMP NULL,
    output JSON NULL,
    input JSON NULL,
    metadata JSON NULL,
    locked_until TIMESTAMP NULL,
    status WORKFLOW_STATUS NOT NULL DEFAULT 'running',
    PRIMARY KEY(id)
);

CREATE INDEX IF NOT EXISTS idx_executions_locked_until_status ON executions (locked_until, status);
CREATE INDEX IF NOT EXISTS idx_executions_aliases ON executions (alias);

CREATE TABLE IF NOT EXISTS pending_events (
    id TEXT,
    execution_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    attributes JSON NOT NULL,
    visible_at TIMESTAMP NULL,
    PRIMARY KEY(id, execution_id),
    CONSTRAINT fk_executions_pending_events
        FOREIGN KEY(execution_id)
            REFERENCES executions(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_events_execution_id_visible_at ON pending_events (execution_id, timestamp, visible_at);

CREATE TABLE IF NOT EXISTS history (
    id TEXT,
    execution_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    attributes JSON NOT NULL,
    visible_at TIMESTAMP NULL,
    PRIMARY KEY(id, execution_id),
    CONSTRAINT fk_executions
        FOREIGN KEY(execution_id)
            REFERENCES executions(id)
);
CREATE INDEX IF NOT EXISTS idx_history_execution_id ON history (execution_id, seq);
`;
