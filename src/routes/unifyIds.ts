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
  // El frontend manda confirmado:true solo después de que el usuario aceptó
  // la alerta de "este ID tiene pagos registrados y va a eliminarse".
  const confirmado = body.confirmado === true;

  if (!idPrincipal || !campana) return jsonError('Falta idPrincipal o campaña.');

  const existe = await client.query(
    `select 1 from leads where id_prometeo = $1 and campana = $2 and en_base = true`,
    [idPrincipal, campana]
  );
  if (existe.rows.length === 0) return jsonError('El ID Principal debe existir en la hoja base');

  const secundariosValidos = idsSecundarios.filter((id) => id && id !== idPrincipal);
  if (secundariosValidos.length === 0) return jsonError('No hay IDs secundarios válidos');

  // ------------------------------------------------------------------
  // Chequeo previo: ¿algún secundario tiene pagos registrados?
  // Si sí, y todavía no vino confirmado:true, se corta acá SIN escribir
  // nada, para que el frontend le pida confirmación explícita al usuario
  // (esos IDs van a desaparecer de `leads` cuando se complete la fusión).
  // ------------------------------------------------------------------
  const pagosCheck = await client.query(
    `select id_prometeo from leads_pagos where campana = $1 and id_prometeo = any($2::text[])`,
    [campana, secundariosValidos]
  );
  const idsConPago: string[] = pagosCheck.rows.map((r) => r.id_prometeo);

  if (idsConPago.length > 0 && !confirmado) {
    return Response.json({
      success: false,
      requiereConfirmacion: true,
      idsConPago,
      error:
        `El/los ID(s) ${idsConPago.join(', ')} tiene(n) pagos registrados (leads_pagos). ` +
        `Al unificar, ese registro se fusionará con el principal y se eliminará de la base de leads. ` +
        `¿Confirmas que quieres continuar?`,
    });
  }

  try {
    await client.query('begin');

    for (const idSecundario of secundariosValidos) {
      // -------------------- 1) leads_bottom (comentarios/historial) --------------------
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
        await client.query(`delete from leads_bottom where id_prometeo = $1 and campana = $2`, [
          idSecundario,
          campana,
        ]);
      } else if (secundarioRes.rows.length > 0) {
        // El principal no tenía fila de bottom todavía: se re-parenta la del secundario.
        await client.query(
          `update leads_bottom set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
          [idPrincipal, idSecundario, campana]
        );
      }

      // -------------------- 2) solicitudes (recategorización) --------------------
      // El índice único solo permite UNA solicitud PENDIENTE por (id_prometeo, campana).
      // Si el principal ya tiene una pendiente y el secundario también, se cancela la
      // del secundario antes de reasignarla para no romper esa restricción.
      const pendientePrincipal = await client.query(
        `select 1 from solicitudes where id_prometeo = $1 and campana = $2 and status = 'PENDIENTE'`,
        [idPrincipal, campana]
      );
      if (pendientePrincipal.rows.length > 0) {
        await client.query(
          `update solicitudes set status = 'CANCELADO', fecha_resolucion = now(), admin_email = $1
           where id_prometeo = $2 and campana = $3 and status = 'PENDIENTE'`,
          [sesion.email, idSecundario, campana]
        );
      }
      await client.query(
        `update solicitudes set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
        [idPrincipal, idSecundario, campana]
      );

      // -------------------- 3) solicitudes_cc (CC) --------------------
      await client.query(
        `update solicitudes_cc set id_prometeo = $1, actualizado_en = now()
         where id_prometeo = $2 and campana = $3`,
        [idPrincipal, idSecundario, campana]
      );

      // -------------------- 4) leads_pagos --------------------
      const [pagoPrincipal, pagoSecundario] = await Promise.all([
        client.query(`select * from leads_pagos where id_prometeo = $1 and campana = $2`, [idPrincipal, campana]),
        client.query(`select * from leads_pagos where id_prometeo = $1 and campana = $2`, [idSecundario, campana]),
      ]);

      if (pagoSecundario.rows.length > 0) {
        if (pagoPrincipal.rows.length === 0) {
          // El principal no tenía pagos: se re-parenta el registro del secundario.
          await client.query(
            `update leads_pagos set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
            [idPrincipal, idSecundario, campana]
          );
        } else {
          // Ambos tienen: se fusiona (se completa lo que le falte al principal
          // con lo del secundario) y se elimina el registro del secundario.
          const p = pagoPrincipal.rows[0];
          const s = pagoSecundario.rows[0];
          await client.query(
            `update leads_pagos set
               status_pago_final = $1,
               fecha_pago_completo = $2,
               fecha_promesa_pago = $3,
               actualizado_en = now()
             where id_prometeo = $4 and campana = $5`,
            [
              p.status_pago_final || s.status_pago_final || '',
              p.fecha_pago_completo || s.fecha_pago_completo || '',
              p.fecha_promesa_pago || s.fecha_promesa_pago || '',
              idPrincipal,
              campana,
            ]
          );
          await client.query(`delete from leads_pagos where id_prometeo = $1 and campana = $2`, [
            idSecundario,
            campana,
          ]);
        }
      }

      // -------------------- 5) eliminar el secundario de `leads` --------------------
      await client.query(`delete from leads where id_prometeo = $1 and campana = $2`, [idSecundario, campana]);
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

    await client.query('commit');
  } catch (e: any) {
    await client.query('rollback');
    return jsonError('Error al unificar: ' + (e?.message || String(e)));
  }

  return jsonOk({
    message: `Fusión completada: ${secundariosValidos.length} registro(s) unificado(s) al principal ${idPrincipal}. Interacciones (solicitudes, CC, pagos) reasignadas y registro(s) secundario(s) eliminado(s) de leads.`,
  });
}