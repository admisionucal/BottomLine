export interface Env {
  ASSETS: Fetcher;
  RUMBO_DB: Hyperdrive;
  APPS_SCRIPT_URL: string;
  IMPORT_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
}

export type JsonBody = Record<string, any>;

export function jsonOk(data: JsonBody = {}) {
  return Response.json({ success: true, ...data });
}

export function jsonError(error: string, status = 200) {
  return Response.json({ success: false, error }, { status });
}
