import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If env vars aren't set (e.g. Supabase hasn't been configured yet),
// export null so the app can skip analytics calls instead of crashing.
export const supabase = url && key ? createClient(url, key) : null;
