-- Create recalculation_tasks table for tracking background stock recalculation tasks
-- This table tracks the status of stock recalculation operations

CREATE TABLE IF NOT EXISTS recalculation_tasks (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL UNIQUE,
    username TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    message TEXT,
    progress JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_recalculation_tasks_task_id ON recalculation_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_recalculation_tasks_username ON recalculation_tasks(username);
CREATE INDEX IF NOT EXISTS idx_recalculation_tasks_status ON recalculation_tasks(status);

-- Enable RLS (Row Level Security)
ALTER TABLE recalculation_tasks ENABLE ROW LEVEL SECURITY;

-- Create RLS policy to allow users to see only their own tasks
CREATE POLICY recalculation_tasks_user_isolation ON recalculation_tasks
    FOR ALL
    USING (username = current_setting('request.jwt.claims', true)::json->>'username');

-- Grant permissions
GRANT ALL ON recalculation_tasks TO authenticated;
GRANT ALL ON recalculation_tasks TO service_role;

COMMENT ON TABLE recalculation_tasks IS 'Tracks background stock recalculation tasks to prevent UI blocking';
