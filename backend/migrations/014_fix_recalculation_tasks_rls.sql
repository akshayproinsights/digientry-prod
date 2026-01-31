-- Fix RLS policy for recalculation_tasks table
-- Problem: Backend uses anon key (due to config) which triggers RLS.
-- Solution: Allow INSERT/UPDATE for anon (backend/background tasks).
--           Keep SELECT restricted to owner for privacy.

DROP POLICY IF EXISTS recalculation_tasks_user_isolation ON recalculation_tasks;

-- 1. Allow SELECT only for the owner (using JWT claims)
CREATE POLICY recalculation_tasks_select ON recalculation_tasks
    FOR SELECT
    USING (username = current_setting('request.jwt.claims', true)::json->>'username');

-- 2. Allow INSERT for anyone (backend needs to create tasks as anon/system)
CREATE POLICY recalculation_tasks_insert ON recalculation_tasks
    FOR INSERT
    WITH CHECK (true);

-- 3. Allow UPDATE for anyone (background worker needs to update tasks as anon/system)
CREATE POLICY recalculation_tasks_update ON recalculation_tasks
    FOR UPDATE
    USING (true);

-- 4. Allow DELETE? maybe restrict or allow db admin only.
-- existing policy was ALL, so maybe allow DELETE for owner?
CREATE POLICY recalculation_tasks_delete ON recalculation_tasks
    FOR DELETE
    USING (username = current_setting('request.jwt.claims', true)::json->>'username');
