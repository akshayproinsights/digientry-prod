-- Create upload_tasks table
CREATE TABLE IF NOT EXISTS upload_tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    progress JSONB DEFAULT '{}'::jsonb,
    duplicates JSONB DEFAULT '[]'::jsonb,
    errors JSONB DEFAULT '[]'::jsonb,
    current_file TEXT,
    current_index INTEGER DEFAULT 0,
    uploaded_r2_keys JSONB DEFAULT '[]'::jsonb,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE
);

-- Enable Row Level Security
ALTER TABLE upload_tasks ENABLE ROW LEVEL SECURITY;

-- Create policy for users to see only their own tasks
CREATE POLICY "Users can view their own upload tasks"
ON upload_tasks FOR SELECT
USING (username = current_setting('app.current_user', true));

-- Create policy for service role (backend) to insert/update
CREATE POLICY "Service role can manage all upload tasks"
ON upload_tasks FOR ALL
USING (true)
WITH CHECK (true);

-- Create index on username for faster lookups
CREATE INDEX IF NOT EXISTS idx_upload_tasks_username ON upload_tasks(username);
CREATE INDEX IF NOT EXISTS idx_upload_tasks_updated_at ON upload_tasks(updated_at);
