export interface Env {
  ASSETS: Fetcher;
  RUMBO_DB: Hyperdrive;
  // URL de tu Apps Script actual. Se usa como "fallback" para las acciones
  // que todavía no migramos a Postgres (getLeads, enviarCC, etc.)
  APPS_SCRIPT_URL: string;
  // Secreto compartido para endpoints server-to-server (scripts de importación),
  // que no tienen sesión de usuario real.
  IMPORT_SECRET: string;
}

export type JsonBody = Record<string, any>;

export function jsonOk(data: JsonBody = {}) {
  return Response.json({ success: true, ...data });
}

export function jsonError(error: string, status = 200) {
  // Igual que tu backend actual: status 200 con success:false,
  // para que el frontend (que ya espera ese formato) no tenga que cambiar.
  return Response.json({ success: false, error }, { status });
}
