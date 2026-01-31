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
