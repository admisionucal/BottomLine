const URLS_PDF_LIB = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];
const LADO_MAXIMO = 1600;
const CALIDAD_JPEG = 0.8;
const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 24;
const SEPARACION = 10;
const IMAGENES_POR_PAGINA = 2;

let cargaPdfLib = null;

function cargarScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar ' + url)); };
        document.head.appendChild(script);
    });
}

function cargarPdfLib() {
    if (window.PDFLib?.PDFDocument) return Promise.resolve(window.PDFLib);
    if (!cargaPdfLib) {
        cargaPdfLib = (async () => {
            for (const url of URLS_PDF_LIB) {
                try {
                    await cargarScript(url);
                    if (window.PDFLib?.PDFDocument) return window.PDFLib;
                } catch (e) { }
            }
            cargaPdfLib = null;
            throw new Error('No se pudo cargar la librería de PDF');
        })();
    }
    return cargaPdfLib;
}

export function esArchivoAceptado(file) {
    return !!file && (esImagen(file) || esPdf(file));
}

function esImagen(file) {
    return !!file.type && file.type.startsWith('image/');
}

function esPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

async function abrirImagen(file) {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

async function comprimirImagen(file) {
    const origen = await abrirImagen(file);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(origen.width, origen.height));
    const ancho = Math.max(1, Math.round(origen.width * escala));
    const alto = Math.max(1, Math.round(origen.height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(origen, 0, 0, ancho, alto);
    if (origen.close) origen.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', CALIDAD_JPEG));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ancho, alto };
}

function bytesABase64(bytes) {
    let binario = '';
    const bloque = 0x8000;
    for (let i = 0; i < bytes.length; i += bloque) {
        binario += String.fromCharCode.apply(null, bytes.subarray(i, i + bloque));
    }
    return btoa(binario);
}

function agregarPaginaImagenes(pdf, imagenesEmbebidas) {
    const pagina = pdf.addPage([A4.ancho, A4.alto]);
    const anchoUtil = A4.ancho - MARGEN * 2;
    const altoUtil = A4.alto - MARGEN * 2;
    const n = imagenesEmbebidas.length;
    const altoSlot = (altoUtil - SEPARACION * (n - 1)) / n;
    imagenesEmbebidas.forEach((img, i) => {
        const escala = Math.min(anchoUtil / img.width, altoSlot / img.height);
        const w = img.width * escala;
        const h = img.height * escala;
        const x = MARGEN + (anchoUtil - w) / 2;
        const yDesdeArriba = MARGEN + i * (altoSlot + SEPARACION) + (altoSlot - h) / 2;
        pagina.drawImage(img, { x, y: A4.alto - yDesdeArriba - h, width: w, height: h });
    });
}

async function unirEnPdf(lista) {
    const { PDFDocument } = await cargarPdfLib();
    const pdf = await PDFDocument.create();
    let pendientes = [];
    const vaciarPendientes = () => {
        for (let i = 0; i < pendientes.length; i += IMAGENES_POR_PAGINA) {
            agregarPaginaImagenes(pdf, pendientes.slice(i, i + IMAGENES_POR_PAGINA));
        }
        pendientes = [];
    };
    for (const file of lista) {
        if (esPdf(file)) {
            vaciarPendientes();
            const origen = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
            const paginas = await pdf.copyPages(origen, origen.getPageIndices());
            paginas.forEach((p) => pdf.addPage(p));
        } else {
            const comprimida = await comprimirImagen(file);
            pendientes.push(await pdf.embedJpg(comprimida.bytes));
        }
    }
    vaciarPendientes();
    return bytesABase64(await pdf.save());
}

export async function prepararArchivosParaEnvio(files, nombreBase = 'documento') {
    const lista = (files || []).filter(esArchivoAceptado);
    if (lista.length === 0) return [];

    if (lista.length === 1 && esPdf(lista[0])) {
        return [{ nombre: lista[0].name || `${nombreBase}.pdf`, mimeType: 'application/pdf', base64: bytesABase64(new Uint8Array(await lista[0].arrayBuffer())) }];
    }

    try {
        return [{ nombre: `${nombreBase}.pdf`, mimeType: 'application/pdf', base64: await unirEnPdf(lista) }];
    } catch (e) {
        const imagenes = lista.filter(esImagen);
        if (imagenes.length === 0) throw e;
        const comprimidas = await Promise.all(imagenes.map(comprimirImagen));
        return comprimidas.map((img, i) => ({
            nombre: `${nombreBase}-${i + 1}.jpg`,
            mimeType: 'image/jpeg',
            base64: bytesABase64(img.bytes)
        }));
    }
}

const TIPOS_PEGABLES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf'];

function nombrarArchivoPegado(blob, indice) {
    const extension = blob.type === 'application/pdf' ? 'pdf' : (blob.type.split('/')[1] || 'png');
    const sello = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    return new File([blob], `pegado-${sello}-${indice + 1}.${extension}`, { type: blob.type });
}

export function archivosDelPortapapelesEvento(evento) {
    const datos = evento.clipboardData;
    if (!datos) return [];
    const archivos = [];
    Array.from(datos.items || []).forEach((item) => {
        if (item.kind !== 'file') return;
        const file = item.getAsFile();
        if (file && TIPOS_PEGABLES.includes(file.type)) archivos.push(file);
    });
    if (archivos.length === 0) {
        Array.from(datos.files || []).forEach((file) => { if (TIPOS_PEGABLES.includes(file.type)) archivos.push(file); });
    }
    return archivos.map((f, i) => (f.name && f.name !== 'image.png') ? f : nombrarArchivoPegado(f, i));
}

export async function archivosDelPortapapelesBoton() {
    if (!navigator.clipboard?.read) throw new Error('Usa Ctrl+V para pegar');
    const items = await navigator.clipboard.read();
    const archivos = [];
    for (const item of items) {
        const tipo = item.types.find((t) => TIPOS_PEGABLES.includes(t));
        if (!tipo) continue;
        archivos.push(nombrarArchivoPegado(await item.getType(tipo), archivos.length));
    }
    if (archivos.length === 0) throw new Error('No hay imagen ni PDF copiado');
    return archivos;
}
