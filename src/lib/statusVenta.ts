export const STATUS_PAGO = ['PAGO COMPLETO', 'PAGO FRACCIONADO'];

export const VENTA_PROVISIONAL_VIGENTE = `(l.venta_provisional_status <> '' and l.venta_provisional_en is not null
  and now() < ((((l.venta_provisional_en at time zone 'America/Lima')::date + 1) + time '10:00') at time zone 'America/Lima'))`;

export const STATUS_EFECTIVO = `(case
  when p.status_pago_final in ('PAGO COMPLETO', 'PAGO FRACCIONADO') then p.status_pago_final
  when ${VENTA_PROVISIONAL_VIGENTE} then l.venta_provisional_status
  else l.status_gestion end)`;
