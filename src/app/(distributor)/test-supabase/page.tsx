import { createClient } from "@/lib/supabase/server";

export default async function TestSupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('tenants').select('*').limit(1);
  return (
    <div>
      <h1>Supabase Test</h1>
      <pre>{JSON.stringify({ data, error }, null, 2)}</pre>
    </div>
  );
}

