// Mismo algoritmo que hashPassword() en tu code.gs (SHA-256, hex lowercase),
// para que las contraseñas ya migradas (con prefijo "sha256:") sigan siendo
// válidas sin que nadie tenga que resetear su clave.
export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(String(password));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verificarPassword(hashGuardado: string, passwordIngresada: string): Promise<boolean> {
  const guardado = String(hashGuardado || '').trim();
  if (guardado.indexOf('sha256:') === 0) {
    const hashIngresado = await hashPassword(passwordIngresada);
    return guardado === 'sha256:' + hashIngresado;
  }
  // Compatibilidad con contraseñas en texto plano migradas desde Sheets
  // (mismo caso que verificarYMigrarPassword en code.gs).
  return guardado !== '' && guardado === String(passwordIngresada || '').trim();
}
