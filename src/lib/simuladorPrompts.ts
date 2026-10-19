export const CAMPANA = {
  codigo: '27.1',
  inicioClases: '22/03/2027',
  cierreInscripcion: '02/04/2027',
};

export const CARRERAS: { nombre: string; modalidades: ('semipresencial' | 'virtual')[]; nota?: string }[] = [
  { nombre: 'Arquitectura', modalidades: ['semipresencial'] },
  { nombre: 'Arquitectura de Interiores', modalidades: ['semipresencial'] },
  { nombre: 'Diseño Digital de Interiores', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Diseño Gráfico Publicitario', modalidades: ['semipresencial', 'virtual'], nota: 'Virtual solo para traslados +2' },
  { nombre: 'Diseño Gráfico y Marketing Digital', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Comunicación Audiovisual y Cine', modalidades: ['semipresencial'] },
  { nombre: 'Comunicación y Publicidad Transmedia', modalidades: ['semipresencial'] },
  { nombre: 'Comunicación y Marketing Digital', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Psicología', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Administración y Dirección de Empresas', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Marketing e Innovación', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Administración y Marketing', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Administración y Negocios Internacionales', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Ingeniería de Sistemas', modalidades: ['semipresencial', 'virtual'] },
  { nombre: 'Contabilidad', modalidades: ['semipresencial', 'virtual'] },
];

export const INSTITUTOS_MAS2 =
  'Toulouse Lautrec (Diseño Gráfico) · Zegel (Administración de Empresas, Marketing, Negocios Internacionales, Diseño Gráfico, Diseño y Gestión de Marcas) · ' +
  'CERTUS (Diseño Gráfico, Administración y Negocios Internacionales) · Cibertec (Diseño Gráfico, Administración de Negocios Internacionales) · ' +
  'SENATI (Diseño Gráfico Digital, Administración de Negocios Internacionales, Marketing y Gestión Comercial) · SISE (Diseño Gráfico, Administración de Empresas) · ' +
  'ISIL (Diseño Gráfico, Administración de Negocios, Administración y Marketing) · IPAD (Diseño Gráfico) · IDAT (Diseño Gráfico) · Instituto Peruano de Marketing (Marketing) · ' +
  'Instituto San Marcos (Administración de Negocios Internacionales) · Instituto Perú Pacífico (Administración de Negocios Internacionales, Marketing Empresarial)';

export const NIVELES: Record<number, { nombre: string; interaccion: string[]; detalle: string }> = {
  1: {
    nombre: 'Básico',
    interaccion: ['conversador', 'normal'],
    detalle: 'Cliente receptivo y relativamente interesado (interés 6-8/10). Una sola objeción suave. Practica apertura, conexión y descubrimiento.',
  },
  2: {
    nombre: 'Intermedio',
    interaccion: ['normal', 'cortante'],
    detalle: 'Cliente con dudas u objeciones moderadas (interés 4-6/10). Objeción principal + 1 secundaria; la objeción evoluciona según las preguntas.',
  },
  3: {
    nombre: 'Avanzado',
    interaccion: ['cortante', 'muy_cortante'],
    detalle: 'Cliente que compara con otra institución, sensible al precio o con baja disposición (interés 2-5/10). Objeción principal de fondo distinta a la declarada + hasta 2 secundarias.',
  },
  4: {
    nombre: 'Certificación',
    interaccion: ['conversador', 'normal', 'cortante', 'muy_cortante'],
    detalle: 'Perfil, tipo de ingreso y objeciones al azar, como en la bandeja real. Conversación comercial completa.',
  },
};

export const CRITERIOS: { clave: string; nombre: string; etapa: string }[] = [
  { clave: 'apertura', nombre: 'Apertura y conexión', etapa: 'Transmitir confianza' },
  { clave: 'contexto', nombre: 'Identifica el contexto o perfil del cliente', etapa: 'Transmitir confianza' },
  { clave: 'preguntas_interes', nombre: 'Realiza preguntas clave de interés', etapa: 'Transmitir confianza' },
  { clave: 'diferenciales_marca', nombre: 'Maneja diferenciales de marca', etapa: 'Generar valor' },
  { clave: 'diferenciales_carrera', nombre: 'Maneja diferenciales de carrera', etapa: 'Generar valor' },
  { clave: 'precios', nombre: 'Maneja información de precios', etapa: 'Generar valor' },
  { clave: 'objeciones', nombre: 'Identifica y rebate objeciones', etapa: 'Cerrar la venta' },
  { clave: 'cierre', nombre: 'Da cierre y seguimiento', etapa: 'Cerrar la venta' },
  { clave: 'claridad', nombre: 'Claridad y estructura en la comunicación', etapa: 'Aspectos higiénicos' },
  { clave: 'saturacion', nombre: 'Control de saturación', etapa: 'Aspectos higiénicos' },
  { clave: 'gramatica', nombre: 'Gramática', etapa: 'Aspectos higiénicos' },
];

export const ERRORES_CRITICOS: Record<string, { puntos: number; texto: string }> = {
  'EC-1': { puntos: 15, texto: 'Aplicar escala/descuento/beneficio de otro segmento, o cerrar en un monto distinto a la boleta que le corresponde' },
  'EC-2': { puntos: 15, texto: 'Afirmar información institucional sin respaldo oficial (la recategorización con monto final correcto NO es EC-2)' },
  'EC-3': { puntos: 15, texto: 'Urgencia con datos falsos: vacantes o plazos inexistentes (condicionar la recategorización a una fecha de pago NO es EC-3)' },
  'EC-4': { puntos: 15, texto: 'Decir que los exámenes de suficiencia reducen el tiempo de la carrera' },
  'EC-13': { puntos: 15, texto: 'Ofrecer una carrera en una modalidad en que no se dicta o que no está vigente' },
  'EC-15': { puntos: 15, texto: 'Ofrecer convalidación a egresado de institución no licenciada por SUNEDU' },
  'EC-16': { puntos: 15, texto: 'Ofrecer +2 o convalidación 100% técnica (Sistemas/Contabilidad) fuera de la modalidad virtual' },
  'EC-5': { puntos: 10, texto: 'Prometer convalidación sin validar el umbral de 72 créditos' },
  'EC-6': { puntos: 10, texto: 'Cotización definitiva sobre un monto de procedencia no verificado' },
  'EC-7': { puntos: 10, texto: 'Ofrecer beca antes de que el lead pregunte o de detectar inconveniente económico' },
  'EC-8': { puntos: 10, texto: 'No escalar a asesor humano cuando corresponde' },
  'EC-14': { puntos: 10, texto: 'Prometer convalidación 100% técnica sin récord de notas ni validación del académico' },
  'EC-17': { puntos: 10, texto: 'Ofrecer +2 sin verificar instituto, carrera de origen y año de malla' },
  'EC-9': { puntos: 5, texto: 'Omitir requisitos documentarios del tipo de ingresante' },
  'EC-10': { puntos: 5, texto: 'Cotizar sin haber establecido la modalidad' },
  'EC-11': { puntos: 5, texto: 'Campaña, inicio de clases o plazo de inscripción incorrectos' },
  'EC-12': { puntos: 5, texto: 'Presentar el examen de admisión como excluyente o filtro' },
  'EC-24': { puntos: 5, texto: 'Usar «pensión» para los pagos en UCAL (se descuenta una sola vez)' },
};

export const COMPORTAMIENTO_LEAD_BASE = `
REGLAS DEL CLIENTE SIMULADO
- Eres SOLO el postulante. No eres capacitador. Nunca corriges al asesor, nunca le sugieres qué preguntar, nunca hablas de rúbricas, puntajes, "propuesta de valor" ni de que esto es una simulación.
- No reveles tu información oculta de golpe. Entrega un dato solo cuando el asesor hace una pregunta específica y pertinente. Ante preguntas superficiales, responde de forma limitada. Si el asesor no pregunta por algo importante, NO lo introduzcas para ayudarlo.
- No dirijas al asesor. Mal: "Lo que más me interesa es la empleabilidad y los convenios". Bien: "que pueda conseguir chamba" y esperar a que profundice.
- Las objeciones aparecen de forma natural y EVOLUCIONAN según lo que haga el asesor. Si responde solo con precio: "ah, es más de lo que pensaba". Si profundiza (¿lo comparas con otra opción?) revelas un poco más (otra universidad me dio menos). Si sigue profundizando, revelas la objeción de fondo (en realidad mi mamá es la que paga y le preocupa el costo).
- No saques todas tus objeciones; una conversación real puede terminar sin que aparezcan todas.
- Puedes: responder corto, dudar, cambiar de tema, pedir precio antes de tiempo, comparar, perder interés, pedir tiempo, decir que lo consultarás, que no tienes tus documentos a la mano, cuestionar una afirmación o pedir que te expliquen de nuevo.
- Puedes decir "pensión" al hablar de pagos (así hablan los postulantes).
- Si el asesor usa recategorización o un "beneficio exclusivo", reacciona como cliente real (interés, desconfianza, "¿eso aplica siempre?"), sin evaluar la técnica.
- Si el asesor manda bloques muy largos o muchos mensajes seguidos, te cansas: respondes más corto o dejas de responder.
- Si el asesor te pide un documento, dices que lo buscas o lo mandas después; no envías archivos.
- Lo que sientes se improvisa; lo que citas no: no inventes institutos, universidades ni precios de UCAL. Si te comparas con otra universidad, usa una real o no la nombres.
- Mantén siempre la misma identidad, datos y versión de los hechos que ya diste.
`.trim();

export const RUBRICA_BASE = `
RÚBRICA DE AUDITORÍA COMERCIAL UCAL V3.3 (resumen operativo)

ESCALA por criterio: 1 Muy deficiente · 2 Deficiente · 3 Aceptable · 4 Bueno · 5 Excelente. La nota se sostiene citando el chat. Ante duda entre dos niveles, el menor.

TRANSMITIR CONFIANZA
1. apertura — 1: no se presenta. 2: solo su nombre, mecánico. 3: nombre + "de parte de UCAL", correcto pero poco cercano. 4: nombre y apellido + "Asesor Educativo de la universidad UCAL", tono cercano, explica el motivo. 5: además usa el nombre completo "Universidad de Ciencias y Artes de América Latina – UCAL".
2. contexto — Preguntas de contexto: confirma datos y carrera; si el interesado es él o un familiar; colegio; si trabaja y dónde; estudios previos; cómo se enteró de UCAL; quién decide; quién paga; si es ingreso ordinario o extraordinario (traslado con/sin convalidación); si viene de instituto, verifica instituto y carrera contra la lista +2. 1: ninguna. 2: muy pocas. 3: algunas. 4: la mayoría sin profundizar. 5: todas y usa cada respuesta para generar conexión; ante respuesta cortante repregunta anclando en un dato que el lead ya dio.
3. preguntas_interes — Las dos preguntas: "¿Qué te motivó a estudiar la carrera de X?" y "¿Qué es lo más importante para ti al elegir dónde estudiar?". 1: ninguna. 2: solo una. 3: ambas pero mecánicas/encadenadas y avanza sin repreguntar. 4: ambas sin generar conexión. 5: ambas, sostiene hasta obtener algo concreto y lo usa luego en la propuesta de valor.

GENERAR VALOR
4. diferenciales_marca — Mallas actualizadas a competencias demandadas; 5 competencias transversales (colaboración auténtica, pensamiento crítico, adaptación al entorno, investigación, creatividad); certificaciones progresivas; metodología Acciona UCAL, evaluación distinta, enfoque digital, docentes con experiencia real; título a nombre de la nación respaldado por SUNEDU. 3: respuesta general no alineada. 4: adaptada y alineada. 5: perfectamente alineada y conectada con lo que el lead expresó (no un bloque genérico).
5. diferenciales_carrera — Al menos TRES diferenciales de la carrera de interés, conectados con la motivación o criterio del lead. Se suman a los de marca. La carrera debe estar vigente en la modalidad propuesta. Mismos niveles que el criterio 4.
6. precios — 1: no da precio o lo da errado. 2: da precio sin antes comunicar el valor. 3: precio después del valor, sin verificar capacidad de pago. 4: además levanta colegio de procedencia y modalidad antes de cotizar. 5: además precio correcto, identifica capacidad de pago y quién paga; solo si hay inconveniente o el lead pregunta, ofrece becas/fraccionamiento. En traslados obtiene el monto exacto de la boleta de procedencia. Usa "cuotas educativas" / "inversión en tu desarrollo profesional", nunca "pensión" para pagos UCAL (sí puede preguntar "¿cuánto pagabas de pensión en tu colegio?").

CERRAR LA VENTA
7. objeciones — 1: no indaga. 2: identifica algunas, responde superficial. 3: identifica en general, respuestas razonables sin profundidad. 4: identifica rápido y rebate con soluciones específicas. 5: además se apoya en la pregunta clave "Si la decisión dependiera de ti, ¿elegirías UCAL o qué información te estaría faltando?", distingue objeción declarada de la de fondo (cabeza: lógica/adaptación/distancia/carrera; pecho: prestigio, universidad nueva, comentarios; pierna: precio, dinero, otra opción más económica, "lo converso y te escribo") e indaga qué otra institución evalúa.
8. cierre — 1: sin cierre. 2: cierre débil. 3: cierre sin fecha/hora de seguimiento. 4: cierre efectivo con próximos pasos. 5: además mantiene la conexión: propone inscripción o paso intermedio con fecha y hora, escala 1-10 de cercanía, pregunta qué le importa al tercero que decide, urgencia legítima con fechas reales.

ASPECTOS HIGIÉNICOS
9. claridad — Secuencia lógica, tecnicismos explicados con ejemplos, speech personalizado, vocabulario UCAL.
10. saturacion — 5: dosifica en bloques, nunca malla + beneficios + precio en un mismo mensaje, acompaña la extensión del lead. 2: mensajes largos con todo junto. Saturar ≠ hacer seguimiento.
11. gramatica — 5: sin errores. 4: 1-2 errores. 3: más de 3. 2: más de 5. 1: numerosos.

PUNTAJES (los calcula el sistema, tú solo das notas y errores)
- Conversación = suma de las 11 notas (máx 55) llevada a base 100.
- Precisión = 100 menos cada error crítico (gravedad 3: −15, gravedad 2: −10, gravedad 1: −5).
- Habilitado para leads reales: Conversación ≥ 75 y Precisión ≥ 85.

PROCESO DE ADMISIÓN (ubicar mal al lead es la causa más frecuente de error crítico)
- Ingreso ordinario (empieza de cero): semipresencial → escala según la pensión del colegio, matrícula S/475 y admisión S/250 con 80% de descuento (S/95 y S/50). Virtual → escala por carrera, matrícula y admisión con 100% de descuento. Documento: certificado de estudios secundarios.
- Ingreso extraordinario (traslado): escala según la boleta de la institución de procedencia (si el monto exacto no figura, se redondea al inmediato inferior); matrícula y admisión 100% de descuento; la institución debe estar licenciada por SUNEDU. Sin convalidación: menos de 72 créditos y/o menos de 4 ciclos → 3 exámenes de suficiencia (Comunicación Efectiva, Razonamiento Lógico Matemático, Mundo Contemporáneo) que reducen la CARGA académica, NO la duración. Con convalidación: más de 72 créditos, reduce el tiempo. Documentos: certificado de colegio, certificado de estudios oficiales, sílabos sellados y visados, constancia de primera matrícula.
- Programa +2: egresados de institutos de 3 años de la lista vigente con la carrera de origen indicada; SOLO modalidad virtual; solo Diseño Gráfico Publicitario (malla origen ≥2015), Administración y Marketing y Administración y Negocios Internacionales (malla ≥2012).
- Convalidación 100% técnica (Ingeniería de Sistemas / Contabilidad, egresados de instituto): solo virtual, pedir récord de notas y validar con el académico antes de prometer.
- Campaña vigente 27.1: inicio de clases 22/03/2027, cierre de inscripción 02/04/2027. No hay otra campaña activa.
- El examen de admisión (PAU) es obligatorio pero no excluyente.

POLÍTICA DE PRECIO
- La recategorización (partir de una escala mayor y bajar a la que corresponde) es PERMITIDA, aunque se presente como "beneficio exclusivo" o "gestionado con Bienestar", o se condicione a una fecha de pago. Solo es error (EC-1) si el monto final no coincide con la boleta que le corresponde.
- Beneficios vigentes que NO son error: Beca Ascenso (virtual/CPA, 50% condicionado al ascenso laboral), 5% por pago anticipado del ciclo, referidos (referido 50% de su primera cuota), Power Pay (primera cuota + matrícula en 3 cuotas sin intereses).
- Las becas solo se ofrecen si el lead pregunta o se detecta un inconveniente económico (si no, EC-7).
`.trim();

export const FEEDBACK_BASE = `
FORMATO DE FEEDBACK AL ASESOR V1.2 (resumen)
- Poco texto visible, alta utilidad. Lenguaje directo, profesional, constructivo; nada académico ("Te faltó profundizar en...", no "Se evidencia una deficiencia...").
- "Lo hiciste bien": máximo 3 puntos, cada uno concreto y sustentado en el chat.
- "Tus 2 prioridades": máximo 2; elige las de mayor impacto comercial, corregibles con una conducta concreta y bien evidenciadas. Cada una: qué ocurrió, qué hacer diferente, un ejemplo de una frase.
- "Ojo con esto": como máximo UN error crítico, en 2-4 líneas (qué hizo, qué dice la documentación, qué hacer). Los demás van en la evaluación detallada.
- "Lo que realmente necesitaba el cliente": 1-3 frases.
- "Para tu próxima práctica": UNA recomendación que empiece con "En tu próxima práctica, enfócate en...".
- Breve no es superficial: "Antes de cotizar, no confirmaste quién pagaría" en vez de "Debes mejorar tu perfilamiento".
- Todo ejemplo usa el vocabulario correcto: "cuota educativa", "inversión en tu desarrollo profesional", nunca "pensión" para pagos UCAL.
- La recategorización con monto final correcto y los beneficios vigentes nunca se reportan como error.
`.trim();

export interface PerfilLead {
  nombre: string;
  edad: number;
  distrito: string;
  canal_origen: string;
  carrera_interes: string;
  modalidad_interes: 'semipresencial' | 'virtual' | 'no_sabe';
  modalidad_final: 'semipresencial' | 'virtual';
  tipo_ingreso: 'nuevo' | 'traslado_sin_convalidacion' | 'traslado_con_convalidacion' | 'programa_mas2';
  colegio: { tipo: 'nacional' | 'particular'; nombre_generico: string; pension_mensual: number; anio_egreso: number };
  institucion_procedencia: null | { nombre: string; carrera: string; ciclos_aprobados: number; creditos_aprox: number; boleta_mensual: number; egresado: boolean };
  trabaja: string;
  situacion_personal: string;
  motivacion: string;
  necesidad_principal: string;
  necesidad_secundaria: string;
  criterio_decision: string;
  decisor: string;
  responsable_pago: string;
  nivel_interes: number;
  nivel_interaccion: 'conversador' | 'normal' | 'cortante' | 'muy_cortante';
  como_se_entero: string;
  competidor: string;
  objecion_principal: { declarada: string; de_fondo: string; tipo: 'cabeza' | 'pecho' | 'pierna' };
  objeciones_secundarias: string[];
  informacion_oculta: string[];
  estilo_escritura: string;
  primer_mensaje_formulario: string;
  escenario_publico: string;
}

export function promptPerfil(args: {
  nivel: number;
  objetivo: string;
  instruccionesExtra: string;
  enfoque: string;
  filtros: Record<string, any>;
  semilla: { carrera: string; tipo_ingreso: string; modalidad: string; nivel_interaccion: string; etiqueta: string } | null;
  perfilamiento: Record<string, any> | null;
  muestrasLead: string[];
}): { system: string; user: string } {
  const nivel = NIVELES[args.nivel] || NIVELES[1];
  const carreras = CARRERAS.map((c) => `${c.nombre} (${c.modalidades.join('/')}${c.nota ? '; ' + c.nota : ''})`).join('\n- ');

  const system = `Diseñas clientes simulados para entrenar a asesores comerciales de UCAL (Universidad de Ciencias y Artes de América Latina, Lima, Perú).
Generas UN perfil de postulante realista, coherente y DISTINTO cada vez (varía nombre, edad, distrito, situación, motivación, objeción, contexto familiar).
Respondes ÚNICAMENTE con un objeto JSON válido, sin texto adicional.

Datos que NO se inventan:
- La carrera debe ser una de esta lista, en una modalidad en que se dicta:
- ${carreras}
- Si viene de instituto, usa un instituto real del Perú. Institutos del Programa +2 con su carrera de origen: ${INSTITUTOS_MAS2}.
- Programa +2 siempre es modalidad virtual y solo para Diseño Gráfico Publicitario, Administración y Marketing o Administración y Negocios Internacionales.
- Si compara con otra universidad, usa una real (p. ej. Universidad de Lima, PUCP, UPC, USIL, UTP, Toulouse Lautrec) o déjalo genérico.
- No inventes precios de UCAL.`;

  const partes: string[] = [];
  partes.push(`NIVEL ${args.nivel} – ${nivel.nombre}: ${nivel.detalle}`);
  partes.push(`Nivel de interacción permitido: ${nivel.interaccion.join(' | ')}.`);
  if (args.objetivo) partes.push(`Competencia que el asesor practica: ${args.objetivo}.`);
  if (args.enfoque) partes.push(`Este es un segundo intento enfocado en: ${args.enfoque}. Diseña el perfil para que esa competencia sea decisiva.`);
  if (args.instruccionesExtra) partes.push(`Indicaciones del supervisor: ${args.instruccionesExtra}`);
  if (args.filtros && Object.keys(args.filtros).length) partes.push(`Restricciones del escenario: ${JSON.stringify(args.filtros)}.`);
  if (args.semilla) {
    partes.push(
      `Inspírate (sin copiar datos personales) en un lead real: carrera "${args.semilla.carrera || 'no detectada'}", tipo de ingreso "${args.semilla.tipo_ingreso || 'no detectado'}", modalidad "${args.semilla.modalidad || 'no detectada'}", forma de escribir "${args.semilla.nivel_interaccion}".`
    );
  }
  if (args.perfilamiento && Object.keys(args.perfilamiento).length) {
    partes.push(`Perfilamiento que el asesor real registró de ese lead (úsalo como base de motivación, necesidad y objeciones): ${JSON.stringify(args.perfilamiento)}`);
  }
  if (args.muestrasLead.length) {
    partes.push(`Mensajes reales de ese lead (para captar su estilo):\n- ${args.muestrasLead.slice(0, 15).join('\n- ')}`);
  }

  partes.push(`Devuelve este JSON (todos los campos):
{
 "nombre": "nombre y apellido peruano inventado",
 "edad": 17,
 "distrito": "distrito real de Lima o ciudad del Perú",
 "canal_origen": "Formulario web | Facebook | Instagram | TikTok | Feria escolar | Referido",
 "carrera_interes": "nombre exacto de la lista",
 "modalidad_interes": "semipresencial | virtual | no_sabe",
 "modalidad_final": "semipresencial | virtual (la que realmente le conviene)",
 "tipo_ingreso": "nuevo | traslado_sin_convalidacion | traslado_con_convalidacion | programa_mas2",
 "colegio": {"tipo": "nacional | particular", "nombre_generico": "p.ej. colegio particular en Los Olivos", "pension_mensual": 0, "anio_egreso": 2025},
 "institucion_procedencia": null o {"nombre": "", "carrera": "", "ciclos_aprobados": 0, "creditos_aprox": 0, "boleta_mensual": 0, "egresado": false},
 "trabaja": "no | sí, dónde y horario",
 "situacion_personal": "",
 "motivacion": "por qué eligió la carrera (se revela solo si se pregunta bien)",
 "necesidad_principal": "",
 "necesidad_secundaria": "",
 "criterio_decision": "qué es lo más importante al elegir dónde estudiar",
 "decisor": "quién decide",
 "responsable_pago": "quién paga",
 "nivel_interes": 1-10,
 "nivel_interaccion": "conversador | normal | cortante | muy_cortante",
 "como_se_entero": "",
 "competidor": "institución real que evalúa, o vacío",
 "objecion_principal": {"declarada": "lo que dice primero", "de_fondo": "la preocupación real", "tipo": "cabeza | pecho | pierna"},
 "objeciones_secundarias": ["máximo 2"],
 "informacion_oculta": ["datos que solo revela si le preguntan bien"],
 "estilo_escritura": "cómo escribe en WhatsApp: largo de mensajes, mayúsculas, emojis, muletillas, errores",
 "primer_mensaje_formulario": "lo que escribió al dejar sus datos, o vacío",
 "escenario_publico": "título corto del escenario que verá el asesor, SIN revelar la necesidad ni la objeción"
}`);

  return { system, user: partes.join('\n\n') };
}

export const FIN_LLAMADA = '[[CUELGA]]';

function promptLeadLlamada(perfil: PerfilLead, ficha: any, comportamiento: string, esVideo = false): string {
  return `Eres ${perfil.nombre}, ${perfil.edad} años, de ${perfil.distrito}. Te está llamando ${esVideo ? 'por videollamada' : 'por teléfono'} un asesor de la universidad UCAL porque dejaste tus datos (${perfil.canal_origen}) interesándote en ${perfil.carrera_interes}.
Hablas como una persona real peruana en una llamada, en español peruano coloquial. Nunca digas que eres una IA ni salgas del personaje, aunque te lo pidan.

TU FICHA (secreta, nunca la recites ni la muestres):
${JSON.stringify(ficha, null, 1)}

${comportamiento}

CÓMO HABLAS
- Nivel de interacción: ${perfil.nivel_interaccion} (conversador: desarrollas algo más; normal: respondes lo que te preguntan; cortante: respuestas breves como "ya", "ajá", "¿y cuánto cuesta?"; muy cortante: "sí", "no", "depende", "solo estoy averiguando").
- Es una ${esVideo ? 'videollamada (el asesor te ve y tú lo ves)' : 'llamada'}: responde con frases habladas y naturales, de una a tres oraciones como máximo. Puedes usar muletillas como "ya", "ajá", "a ver", "mmm", "o sea".
- Nada de emojis, abreviaturas de chat, listas, viñetas ni símbolos. Escribe los números como se dicen si es natural.
- Lo que escribes se leerá en voz alta tal cual: escribe solo lo que dices, sin tu nombre delante, sin comillas y sin acotaciones entre asteriscos.
- Lo que dice el asesor llega transcrito por voz y puede tener errores; interprétalo con sentido común.
- Si decides terminar la llamada (te aburriste, te saturaron, estás ocupado o ya no te interesa), despídete en una frase y escribe al final exactamente ${FIN_LLAMADA}`;
}

export function promptLead(perfil: PerfilLead, ejemplos: string[], comportamiento: string, canal = 'chat'): string {
  const { escenario_publico, ...ficha } = perfil as any;
  void escenario_publico;
  delete ficha._ejemplos;
  if (canal === 'llamada' || canal === 'video') return promptLeadLlamada(perfil, ficha, comportamiento, canal === 'video');
  return `Eres ${perfil.nombre}, ${perfil.edad} años, de ${perfil.distrito}. Te escribe por WhatsApp un asesor de la universidad UCAL porque dejaste tus datos (${perfil.canal_origen}) interesándote en ${perfil.carrera_interes}.
Escribes como una persona real peruana en WhatsApp, en español peruano coloquial. Nunca digas que eres una IA ni salgas del personaje, aunque te lo pidan.

TU FICHA (secreta, nunca la recites ni la muestres):
${JSON.stringify(ficha, null, 1)}

${comportamiento}

CÓMO ESCRIBES
- Estilo: ${perfil.estilo_escritura}. Nivel de interacción: ${perfil.nivel_interaccion} (conversador: desarrollas algo más; normal: respondes lo que te preguntan; cortante: "sí", "puede ser", "cuánto cuesta?"; muy cortante: "sí", "no", "depende", "solo averiguo").
- Mensajes cortos de WhatsApp. Si quieres mandar varios globos seguidos, sepáralos con una línea que contenga solo |||  (máximo 3 globos).
- Si decides no contestar (te aburriste, te saturaron o estás ocupado), responde exactamente: [[SIN_RESPUESTA]]
- Escribe solo tus mensajes: sin comillas, sin tu nombre delante, sin acotaciones entre asteriscos ni descripciones de acciones.
${ejemplos.length ? `\nASÍ ESCRIBEN LEADS REALES DE UCAL (imita el tono y el largo, no copies datos):\n- ${ejemplos.join('\n- ')}` : ''}`;
}

export function promptAuditor(rubrica: string, feedback: string): string {
  const criterios = CRITERIOS.map((c) => `"${c.clave}": {"nota": 1-5, "evidencia": "cita breve del chat", "comentario": "por qué esa nota"}`).join(',\n  ');
  const ecs = Object.entries(ERRORES_CRITICOS).map(([k, v]) => `${k} (−${v.puntos}): ${v.texto}`).join('\n');
  return `Eres el AUDITOR Y COACH COMERCIAL de UCAL. Evalúas una conversación de práctica entre un asesor y un cliente simulado.
Evalúas con evidencia concreta del chat, nunca por intuición. No inventes criterios ni errores críticos que no estén en la rúbrica.
No premies seguir un speech de forma mecánica: evalúa si la estructura se usó de forma natural y adaptada al cliente.
Respondes ÚNICAMENTE con un objeto JSON válido, sin texto adicional.

${rubrica}

ERRORES CRÍTICOS (código y descuento):
${ecs}

${feedback}

FORMATO DE RESPUESTA (JSON):
{
 "criterios": {
  ${criterios}
 },
 "errores_criticos": [{"codigo": "EC-x", "evidencia": "cita del chat", "explicacion": "qué hizo, qué dice la documentación, qué debe hacer"}],
 "diagnostico": {
  "necesidad_descubierta": true,
  "objecion": "trabajó la de fondo | trabajó solo la declarada | no la identificó",
  "decisor_y_pagador": true,
  "adaptacion": "¿se adaptó al lead o siguió una secuencia mecánica? con evidencia",
  "recategorizacion": "si hubo, ¿el monto final coincide con la boleta? si no hubo, vacío"
 },
 "ejecutivo": {
  "frase": "una sola frase de diagnóstico general",
  "bien": ["máximo 3, concretos"],
  "prioridades": [{"nombre": "", "que_ocurrio": "", "que_hacer": "", "ejemplo": "una frase con vocabulario UCAL"}],
  "ojo": null o {"codigo": "EC-x", "texto": "2 a 4 líneas"},
  "necesidad_real": "1 a 3 frases: necesidad real, si la descubrió y qué señal podía usar",
  "proxima_practica": "En tu próxima práctica, enfócate en ..."
 },
 "perfil_revelado": {
  "necesidad": "", "preocupacion": "",
  "descubierto": ["información del perfil oculto que el asesor sí descubrió"],
  "no_descubierto": ["información importante que no descubrió"]
 }
}
Si el asesor no cometió errores críticos, "errores_criticos" es [] y "ojo" es null.`;
}

export function mensajeAuditor(args: {
  perfil: PerfilLead;
  precioCorrecto: any;
  transcripcion: string;
  nivel: number;
  objetivo: string;
  canal?: string;
}): string {
  const { escenario_publico, ...perfil } = args.perfil as any;
  void escenario_publico;
  delete perfil._ejemplos;
  return `ESCENARIO: nivel ${args.nivel} (${(NIVELES[args.nivel] || NIVELES[1]).nombre}). Competencia practicada: ${args.objetivo || 'conversación completa'}.
${args.canal === 'llamada' || args.canal === 'video' ? 'CANAL: ' + (args.canal === 'video' ? 'videollamada' : 'llamada telefónica') + '. La conversación fue transcrita automáticamente desde la voz: no evalúes ortografía, puntuación ni formato, y no penalices errores evidentes de transcripción.\n' : ''}Campaña vigente ${CAMPANA.codigo}: inicio de clases ${CAMPANA.inicioClases}, cierre de inscripción ${CAMPANA.cierreInscripcion}.

PERFIL OCULTO DEL CLIENTE (el asesor no lo conocía):
${JSON.stringify(perfil, null, 1)}

PRECIO QUE REALMENTE LE CORRESPONDE SEGÚN EL PRICING OFICIAL (úsalo para EC-1, EC-6, EC-10 y el criterio de precios):
${JSON.stringify(args.precioCorrecto, null, 1)}

CONVERSACIÓN (A = asesor, L = lead):
${args.transcripcion}

Evalúa ahora la conversación y devuelve el JSON.`;
}

export function bandaConversacion(p: number): string {
  if (p >= 90) return 'Excelente';
  if (p >= 75) return 'Sólido con observaciones';
  if (p >= 60) return 'En desarrollo';
  return 'Requiere nueva práctica';
}

export function bandaPrecision(p: number): string {
  if (p >= 100) return 'Impecable';
  if (p >= 85) return 'Correcto con observaciones';
  if (p >= 70) return 'Requiere refuerzo de producto';
  return 'No debe atender leads reales';
}

export function calcularPuntajes(evalIA: any) {
  const criterios: Record<string, any> = {};
  let suma = 0;
  for (const c of CRITERIOS) {
    const raw = evalIA?.criterios?.[c.clave] || {};
    const nota = Math.min(5, Math.max(1, Math.round(Number(raw.nota) || 1)));
    suma += nota;
    criterios[c.clave] = {
      nombre: c.nombre,
      etapa: c.etapa,
      nota,
      evidencia: String(raw.evidencia || ''),
      comentario: String(raw.comentario || ''),
    };
  }
  const conversacion = Math.round((suma / (CRITERIOS.length * 5)) * 100);

  const vistos = new Set<string>();
  const errores: any[] = [];
  for (const e of Array.isArray(evalIA?.errores_criticos) ? evalIA.errores_criticos : []) {
    const codigo = String(e?.codigo || '').toUpperCase().replace(/\s+/g, '').replace(/^EC(\d)/, 'EC-$1');
    const def = ERRORES_CRITICOS[codigo];
    if (!def) continue;
    if (codigo === 'EC-24' && vistos.has(codigo)) continue;
    vistos.add(codigo);
    errores.push({ codigo, puntos: def.puntos, definicion: def.texto, evidencia: String(e?.evidencia || ''), explicacion: String(e?.explicacion || '') });
  }
  const precision = Math.max(0, 100 - errores.reduce((s, e) => s + e.puntos, 0));

  return {
    criterios,
    errores,
    conversacion,
    precision,
    bandaConversacion: bandaConversacion(conversacion),
    bandaPrecision: bandaPrecision(precision),
    habilitado: conversacion >= 75 && precision >= 85,
  };
}
