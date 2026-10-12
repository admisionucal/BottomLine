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
  return guardado !== '' && guardado === String(passwordIngresada || '').trim();
}
