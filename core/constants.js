// ================================================================
// CONSTANTS - Configuración global y mapeo de columnas
// ================================================================

// ----- URL DE LA API (Google Apps Script) -----
export const API_URL = 'https://script.google.com/macros/s/AKfycbyeWTfXZfCV7UuTJTYP4ipMQIQTOU7cDse75FVe6lxj897vNIx0z2-3UG6ogSK4T_aERw/exec';

// ----- MAPEO DE COLUMNAS DE GOOGLE SHEETS -----
// Centraliza todos los nombres de columnas para evitar strings mágicos.
export const COLUMNAS = {
    // Leads / Campañas
    ID_PROMETEO: 'ID PROMETEO',
    NOMBRES: 'NOMBRES',
    NOMBRE: 'NOMBRE',
    ASESOR_ULTIMO_CONTACTO: 'ASESOR ULT TIP DF SN CONTC',
    ASESOR_NOMBRE_RAW: 'ASESOR_NOMBRE_RAW',
    ASESOR_EMAIL: 'ASESOR_EMAIL',
    ASESOR_NOMBRE: 'ASESOR_NOMBRE',
    CARRERA: 'CARRERA',
    PROGRAMA: 'PROGRAMA',
    MODALIDAD: 'MODALIDAD',
    MODALIDAD_INGRESO: 'MODALIDAD INGRESO',
    BENEFICIO: 'BENEFICIO',
    BENEFICIO_ADICIONAL: 'BENEFICIO_ADICIONAL',
    BENEFICIO_ENGANCHE: 'BENEFICIO_ENGANCHE',
    BOLETA: 'BOLETA',
    BOLETA_FINAL: 'BOLETA_FINAL',
    BOLETA_CON_BECA: 'BOLETA_CON_BECA',
    BOLETA_PROCEDENCIA: 'BOLETA_PROCEDENCIA',
    BOLETA_COLEGIO: 'BOLETA DE COLEGIO',
    INSTITUCION_PROCEDENCIA: 'INSTITUCION_PROCEDENCIA',
    TIPO_INSTITUCION_PROCEDENCIA: 'TIPO_INSTITUCION_PROCEDENCIA',
    CARRERA_PROCEDENCIA: 'CARRERA_PROCEDENCIA',
    TIEMPO_OFRECIDO: 'TIEMPO_OFRECIDO',
    DESCUENTO_PRECIOS: 'DESCUENTO_PRECIOS',
    COLEGIO: 'COLEGIO',
    STATUS_GESTION: 'STATUS DE GESTION',
    FECHA_COMPROMISO_PAGO: 'FECHA COMPROMISO DE PAGO',
    FECHA_PAGO_COMPLETO: 'FECHA DE PAGO COMPLETO',
    FECHA_PROMESA_PAGO: 'FECHA DE PROMESA DE PAGO',
    FECHA_PAGO: 'FECHA DE PAGO',
    FECHA_ULT_MODIFICACION: 'FECHA_ULT_MODIFICACION',
    COMENTARIOS_HISTORIAL: 'COMENTARIOS_HISTORIAL',
    TIPO_ALUMNO: 'TIPO_ALUMNO',
    NUMERO_CUOTAS: 'NUMERO_CUOTAS',

    // Perfilamiento
    POR_QUE_ELIGIO_CARRERA: 'POR_QUE_ELIGIO_CARRERA',
    QUE_BUSCA_UNIVERSIDAD: 'QUE_BUSCA_UNIVERSIDAD',
    QUIEN_FINANCIARA: 'QUIEN_FINANCIARA',
    QUE_LE_FALTA: 'QUE_LE_FALTA',
    OTRAS_OPCIONES: 'OTRAS_OPCIONES',
    COMENTARIOS_PERFIL: 'COMENTARIOS_PERFIL',
    ACCIONES_DEFINIDAS: 'ACCIONES_DEFINIDAS',

    // Contacto
    TELEFONO_2: 'TELEFONO 2',
    TELEFONO_3: 'TELEFONO 3',
    EMAIL: 'EMAIL',
    DNI: 'NUMERO DE DOCUMENTO', // O 'DNI' dependiendo de la hoja
};

// ----- ESTADOS DE GESTIÓN (MAPEO Y ETIQUETAS) -----
export const STATUS = {
    VP_VIVA: 'VALORES_VALORACIONES_POSITIVAS_VIVA',
    VP_MUERTA: 'VALORES_VALORACIONES_POSITIVAS_MUERTA',
    PP_VIVA: 'VALORES_PROMESA_DE_PAGO_VIVA',
    PP_MUERTA: 'VALORES_PROMESA_DE_PAGO_MUERTA',
    PERDIDO: 'VALORES_PERDIDO',
    SIN_CONTACTO: 'VALORES_SIN_CONTACTO',
    VOLVER_A_LLAMAR: 'VALORES_VOLVER_A_LLAMAR',
    BLACK_LIST: 'VALORES_BLACK_LIST',
    PAGO_COMPLETO: 'PAGO COMPLETO',
    PAGO_FRACCIONADO: 'PAGO FRACCIONADO',
};

export const STATUS_CLASES = {
    [STATUS.VP_VIVA]: 'status-vp',
    [STATUS.VP_MUERTA]: 'status-vp',
    [STATUS.PP_VIVA]: 'status-pp',
    [STATUS.PP_MUERTA]: 'status-pp',
    [STATUS.PAGO_COMPLETO]: 'status-pago',
    [STATUS.PAGO_FRACCIONADO]: 'status-pago',
    [STATUS.PERDIDO]: 'status-perdido',
    [STATUS.SIN_CONTACTO]: 'status-sin',
    [STATUS.VOLVER_A_LLAMAR]: 'status-vll',
    [STATUS.BLACK_LIST]: 'status-black',
};

export const STATUS_LABELS = {
    [STATUS.VP_VIVA]: 'VP Viva',
    [STATUS.VP_MUERTA]: 'VP Muerta',
    [STATUS.PP_VIVA]: 'PP Viva',
    [STATUS.PP_MUERTA]: 'PP Muerta',
    [STATUS.PERDIDO]: 'Perdido',
    [STATUS.SIN_CONTACTO]: 'Sin Contacto',
    [STATUS.VOLVER_A_LLAMAR]: 'Volver a Llamar',
    [STATUS.BLACK_LIST]: 'Black List',
    [STATUS.PAGO_COMPLETO]: 'Pago Completo',
    [STATUS.PAGO_FRACCIONADO]: 'Pago Fraccionado',
};

// ----- PRECIOS BASE -----
export const PRECIOS_BASE = {
    MATRICULA: 475,
    ADMISION: 250,
};

// ----- ROLES -----
export const ROLES = {
    ASESOR: 'ASESOR',
    SUPERVISOR: 'SUPERVISOR',
    ADMISION: 'ADMISION',
};

export function esRolSupervisorOAdmision(rol) {
    return rol === ROLES.SUPERVISOR || rol === ROLES.ADMISION;
}

// ----- OPCIONES PARA SELECTORES (Catálogos estáticos) -----
export const SELECT_OPTIONS = {
    beneficio: ['Beca Impacto', 'Beca Potencia'],
    descuentoPrecios: [
        { value: '0',   label: 'Matrícula S/475 - E. Admisión S/250' },
        { value: '80',  label: 'Matrícula S/95 - E. Admisión S/50' },
        { value: '100', label: 'Matrícula S/0 - E. Admisión S/0' }
    ],
    tiempo: ['Traslado +2', '2 años', '2 años y medio', '3 años', '3 años y medio', '4 años'],
    tipoAlumno: ['ALUMNO REGULAR', 'ALUMNO ETU'],
    cuotas: ['5 cuotas', '6 cuotas']
};

export const TIPOS_INSTITUCION_PROCEDENCIA = ['UNIVERSIDAD', 'INSTITUTO'];

// ----- MAPEO CARRERA -> ESPECIALIZACIÓN ETU -----
// Solo estas carreras pueden marcarse como "ALUMNO ETU". El nombre de la
// especialización (columna derecha) es el que sale impreso en las
// Condiciones Comerciales cuando corresponde. Hardcodeado a propósito
// (igual que en el script viejo de Cargos): no depende de ningún catálogo
// de Sheets, así que si se agrega/quita una carrera ETU hay que tocar
// este objeto directamente.
export const CARRERAS_ETU = {
    'Diseño Digital de Interiores': 'Diseño Digital e Interiorismo',
    'Diseño Gráfico Publicitario': 'Diseño y Gestión Publicitaria',
    'Diseño Gráfico y Marketing Digital': 'Diseño y Gestión de Marca Digital',
    'Comunicación y Marketing Digital': 'Comunicación y Gestión de Marca Digital',
    'Comunicación Audiovisual y Cine': 'Comunicación y Producción Audiovisual',
    'Comunicación y Publicidad Transmedia': 'Comunicación y Gestión Publicitaria'
};

// ----- COPIA OCULTA (BCC) POR DEFECTO PARA ENVÍO DE CC, POR CAMPAÑA -----
// Único lugar donde se define esta lista — condiciones-comerciales.js la
// usa para pintar los checkboxes de Vista 2. Todos van marcados por
// defecto (incluido onboarding), pero el supervisor puede desmarcar
// cualquiera antes de enviar — nada va forzado.
export const BCC_DEFAULT_CC = {
    '26.2': ['onboarding@ucal.edu.pe', 'azamora@ucal.edu.pe', 'renriquez@ucal.edu.pe'],
    '27.1': ['onboarding@ucal.edu.pe', 'mquiroz@ucal.edu.pe']
};

// ----- CLAVES DE CACHÉ (sessionStorage) -----
export const CACHE_KEYS = {
    USER: 'bl_user',
    LEADS_RAW: (email, rol, campana) => `bl_leads_raw_${email}_${rol}_${campana}`,
    VPPP_RESUMEN: (email, rol, campanas) => `bl_vppp_resumen_${email}_${rol}_${campanas.slice().sort().join('|')}`,
    LEAD_DETAIL: (id, campana, email) => `bl_detail_${id}_${campana}_${email}`,
    LEAD_SELECTED: (id, campana) => `bl_selected_${id}_${campana}`,
    PAYMENTS: (id, campana) => `bl_payments_${id}_${campana}`,
    SOLICITUDES_CC: (email, rol, incluirResueltas) => `bl_solicitudes_cc_${email}_${rol}_${incluirResueltas}`,
    FILTROS_ESTADO: 'bl_filtros_estado',
    BOLETAS: 'bl_boletas',
    BENEFICIOS: 'bl_beneficios',
    INSTITUCIONES_PROCEDENCIA: 'bl_instituciones_procedencia',
    CARRERAS_PROCEDENCIA: 'bl_carreras_procedencia',
};