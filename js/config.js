// CONFIGURACIÓN  - BOTTOM LINE ===============================

// ===== URL DE LA API (Google Apps Script) =====
const API_URL = 'https://script.google.com/macros/s/AKfycbz2RKb-BWZzk0ImTJ1R4ELGgGZT-G93ajHd_IKFgaJj4bNocLV8zXjjZODnDs6HaZFK/exec';

// ===== HOJAS EN GOOGLE SHEETS =====
const SHEET_NAMES = {
    USUARIOS: 'USUARIOS',
    BOLETAS: 'BOLETAS',
    CARRERAS: 'CARRERAS',
    SOLICITUDES: 'SOLICITUDES',

    // Campañas (dinámicas - funciones)
    getResumen: function(campana) { return campana; },
    getCSV: function(campana) { return 'bbdd' + campana; },
    getBottom: function(campana) { return 'bottom' + campana; },
    getPagos: function(campana) { return 'pagos' + campana; }
};

// ===== PRECIOS BASE =====
const PRECIOS_BASE = { matricula: 475, admision: 250 };

// ===== STATUS DE GESTIÓN =====
const STATUS_MAP = {
  'VALORES_VALORACIONES_POSITIVAS_VIVA':   'status-vp-viva',
  'VALORES_VALORACIONES_POSITIVAS_MUERTA': 'status-vp',
  'VALORES_PROMESA_DE_PAGO_VIVA':          'status-pp-viva',
  'VALORES_PROMESA_DE_PAGO_MUERTA':        'status-pp',
  'VALORES_PERDIDO':                       'status-perdido',
  'VALORES_SIN_CONTACTO':                  'status-sc',
  'VALORES_VOLVER_A_LLAMAR':               'status-vll',
  'VALORES_BLACK_LIST':                    'status-bl'
};

const STATUS_LABELS = {
  'VALORES_VALORACIONES_POSITIVAS_VIVA':   'VP Viva',
  'VALORES_VALORACIONES_POSITIVAS_MUERTA': 'VP Muerta',
  'VALORES_PROMESA_DE_PAGO_VIVA':          'PP Viva',
  'VALORES_PROMESA_DE_PAGO_MUERTA':        'PP Muerta',
  'VALORES_PERDIDO':                       'Perdido',
  'VALORES_SIN_CONTACTO':                  'Sin Contacto',
  'VALORES_VOLVER_A_LLAMAR':               'Volver a Llamar',
  'VALORES_BLACK_LIST':                    'Black List'
};

// ===== UTILIDADES COMPARTIDAS =====

/** Escapa texto antes de insertarlo en HTML (previene XSS con datos de leads/comentarios) */
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ===== OPCIONES PARA SELECTORES =====
const SELECT_OPTIONS = {
  beneficio: ['Beca Impacto', 'Beca Potencia'],
  descuentoPrecios: [
    { value: '0',   label: 'Matrícula S/475 - E. Admisión S/250' },
    { value: '80',  label: 'Matrícula S/95 - E. Admisión S/50' },
    { value: '100', label: 'Matrícula S/0 - E. Admisión S/0' }
  ],
  institucion: ['CERTUS', 'ISIL', 'TOULOUSE', 'IPAD', 'CIBERTEC', 'SENATI', 'OTRA'],
  tiempo: ['1 año', '2 años', '3 años', '4 años']
};
