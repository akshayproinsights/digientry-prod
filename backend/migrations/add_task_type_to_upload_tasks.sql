-- Migration: Add task_type to upload_tasks
-- Description: Adds a task_type column to distinguish between sales and inventory upload tasks.

ALTER TABLE upload_tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'sales';

-- Optional: Create an index on task_type for faster filtering if table grows large
CREATE INDEX IF NOT EXISTS idx_upload_tasks_task_type ON upload_tasks(task_type);
