-- Run this in your Supabase SQL Editor (Dev Project)
-- https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql/new

create or replace function exec_sql(query text)
returns void
language plpgsql
security definer
as $$
begin
  execute query;
end;
$$;

-- Grant permissions to allow API access
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO anon;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO authenticated;

-- Force schema cache reload
NOTIFY pgrst, 'reload schema';
