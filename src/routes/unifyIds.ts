import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

// Igual que parsearHistorial() en code.gs: nunca truena si el JSON viene mal.
function parsearHistorial(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

export async function unifyIds(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrincipal = String(body.idPrincipal || '').trim();
  const idsSecundarios: string[] = Array.isArray(body.idsSecundarios)
    ? body.idsSecundarios.map((x: any) => String(x).trim())
    : [String(body.idSecundario || '').trim()];
  const campana = String(body.campana || '').trim();
  const datosPredominantes = body.datosPredominantes || {};

  if (!idPrincipal || !campana) return jsonError('Falta idPrincipal o campaña.');

  const existe = await client.query(
    `select 1 from leads where id_prometeo = $1 and campana = $2 and en_base = true`,
    [idPrincipal, campana]
  );
  if (existe.rows.length === 0) return jsonError('El ID Principal debe existir en la hoja base');

  const secundariosValidos = idsSecundarios.filter((id) => id && id !== idPrincipal);
  if (secundariosValidos.length === 0) return jsonError('No hay IDs secundarios válidos');

  // NOTA: a diferencia del code.gs original (que podía tener una fila de
  // bottom por cada asesor y las fusionaba por asesor), aquí leads_bottom
  // ya garantiza UNA sola fila por lead — así que la fusión es más simple:
  // si el principal ya tiene fila, se fusiona el historial y se borra la
  // del secundario; si no, se "re-parenta" la fila del secundario al principal.
  for (const idSecundario of secundariosValidos) {
    const [principalRes, secundarioRes] = await Promise.all([
      client.query(`select comentarios_historial from leads_bottom where id_prometeo = $1 and campana = $2`, [
        idPrincipal,
        campana,
      ]),
      client.query(`select comentarios_historial from leads_bottom where id_prometeo = $1 and campana = $2`, [
        idSecundario,
        campana,
      ]),
    ]);

    if (principalRes.rows.length > 0) {
      const historialPrincipal = parsearHistorial(principalRes.rows[0].comentarios_historial);
      const historialSecundario = parsearHistorial(secundarioRes.rows[0]?.comentarios_historial);

      let historialFinal: any[];
      const modo = datosPredominantes.historial;
      if (modo === 'id1') historialFinal = historialPrincipal;
      else if (modo === 'id2') historialFinal = historialSecundario;
      else {
        historialFinal = [...historialPrincipal, ...historialSecundario].sort(
          (a, b) => new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime()
        );
      }

      await client.query(
        `update leads_bottom set comentarios_historial = $1::jsonb, actualizado_en = now()
         where id_prometeo = $2 and campana = $3`,
        [JSON.stringify(historialFinal), idPrincipal, campana]
      );
      await client.query(`delete from leads_bottom where id_prometeo = $1 and campana = $2`, [idSecundario, campana]);
    } else if (secundarioRes.rows.length > 0) {
      // El principal no tenía fila de bottom todavía: se re-parenta la del secundario.
      await client.query(
        `update leads_bottom set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
        [idPrincipal, idSecundario, campana]
      );
    }
  }

  const camposAAplicar: Record<string, string> = {};
  if (datosPredominantes.beneficio) camposAAplicar.beneficio = datosPredominantes.beneficio;
  if (datosPredominantes.boleta) camposAAplicar.boleta_final = datosPredominantes.boleta;
  if (datosPredominantes.status) camposAAplicar.estado_aprobacion = datosPredominantes.status;

  if (Object.keys(camposAAplicar).length > 0) {
    const cols = Object.keys(camposAAplicar);
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    await client.query(
      `update leads_bottom set ${sets}, actualizado_en = now() where id_prometeo = $1 and campana = $2`,
      [idPrincipal, campana, ...cols.map((c) => camposAAplicar[c])]
    );
  }

  return jsonOk({
    message: `Fusión completada: ${secundariosValidos.length} registro(s) unificado(s) al principal ${idPrincipal}`,
  });
}
