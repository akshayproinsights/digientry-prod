-- Migration to enable PostgreSQL advisory locks for stock recalculation
-- Creates wrapper functions with custom names to avoid permission conflicts

-- Drop existing functions if they exist (needed when changing parameter names)
DROP FUNCTION IF EXISTS acquire_stock_lock(bigint);
DROP FUNCTION IF EXISTS release_stock_lock(bigint);

-- Wrapper function to acquire advisory lock (non-blocking)
-- Custom name avoids conflicts with system function
CREATE FUNCTION acquire_stock_lock(p_lock_id bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
    -- Use TRY variant to avoid blocking and statement timeout
    -- Returns true if lock acquired, false if already held
    RETURN pg_try_advisory_lock(p_lock_id);
END;
$$;

-- Wrapper function to release advisory lock
CREATE FUNCTION release_stock_lock(p_lock_id bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
    -- Call native PostgreSQL advisory unlock
    RETURN pg_advisory_unlock(p_lock_id);
END;
$$;

COMMENT ON FUNCTION acquire_stock_lock(bigint) IS 'Acquire advisory lock for stock recalculation';
COMMENT ON FUNCTION release_stock_lock(bigint) IS 'Release advisory lock for stock recalculation';

