// Igual que calcularPerfilamientoCompleto() en code.gs: separa los 5 campos
// que llena el ASESOR de 1 campo que llena el SUPERVISOR (ACCIONES_DEFINIDAS).
const CAMPOS_ASESOR = [
  'POR_QUE_ELIGIO_CARRERA', 'QUE_BUSCA_UNIVERSIDAD', 'QUIEN_FINANCIARA',
  'QUE_LE_FALTA', 'OTRAS_OPCIONES',
];
const CAMPO_SUPERVISOR = 'ACCIONES_DEFINIDAS';

export function calcularPerfilamientoCompleto(bottomRowUpperKeys: Record<string, any>) {
  let asesorRespondidas = 0;
  CAMPOS_ASESOR.forEach((c) => {
    if (bottomRowUpperKeys[c] && String(bottomRowUpperKeys[c]).trim() !== '') asesorRespondidas++;
  });
  const asesorCompleto = asesorRespondidas === CAMPOS_ASESOR.length;
  const supervisorCompleto = !!(
    bottomRowUpperKeys[CAMPO_SUPERVISOR] && String(bottomRowUpperKeys[CAMPO_SUPERVISOR]).trim() !== ''
  );

  const estado = !asesorCompleto ? 'Pendiente Asesor' : !supervisorCompleto ? 'Pendiente Supervisor' : 'Completo';

  return {
    respondidas: asesorRespondidas + (supervisorCompleto ? 1 : 0),
    total: CAMPOS_ASESOR.length + 1,
    completo: estado === 'Completo',
    estado,
  };
}
