const URL_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const LADO_MAXIMO = 1600;
const CALIDAD_JPEG = 0.8;
const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 24;
const SEPARACION = 10;

let cargaJsPdf = null;

function cargarJsPdf() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!cargaJsPdf) {
        cargaJsPdf = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = URL_JSPDF;
            script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF no disponible'));
            script.onerror = () => { cargaJsPdf = null; reject(new Error('No se pudo cargar jsPDF')); };
            document.head.appendChild(script);
        });
    }
    return cargaJsPdf;
}

function esImagen(file) {
    return !!file.type && file.type.startsWith('image/');
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
    return { dataUrl: canvas.toDataURL('image/jpeg', CALIDAD_JPEG), ancho, alto };
}

function leerBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(blob);
    });
}

async function imagenesAPdf(imagenes) {
    const JsPDF = await cargarJsPdf();
    const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
    const anchoUtil = A4.ancho - MARGEN * 2;
    const altoUtil = A4.alto - MARGEN * 2;
    const altoSlot = (altoUtil - SEPARACION * (imagenes.length - 1)) / imagenes.length;
    imagenes.forEach((img, i) => {
        const escala = Math.min(anchoUtil / img.ancho, altoSlot / img.alto);
        const w = img.ancho * escala;
        const h = img.alto * escala;
        const x = MARGEN + (anchoUtil - w) / 2;
        const y = MARGEN + i * (altoSlot + SEPARACION) + (altoSlot - h) / 2;
        doc.addImage(img.dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
    });
    return doc.output('datauristring').split(',')[1];
}

export async function prepararArchivosParaEnvio(files, nombreBase = 'documento') {
    const lista = (files || []).filter(Boolean);
    if (lista.length === 0) return [];

    const todasImagenes = lista.every(esImagen);
    if (!todasImagenes) {
        const primero = lista[0];
        if (esImagen(primero)) return prepararArchivosParaEnvio([primero], nombreBase);
        return [{ nombre: primero.name, mimeType: primero.type || 'application/pdf', base64: await leerBase64(primero) }];
    }

    const imagenes = await Promise.all(lista.map(comprimirImagen));
    try {
        const base64 = await imagenesAPdf(imagenes);
        return [{ nombre: `${nombreBase}.pdf`, mimeType: 'application/pdf', base64 }];
    } catch (e) {
        return imagenes.map((img, i) => ({
            nombre: `${nombreBase}-${i + 1}.jpg`,
            mimeType: 'image/jpeg',
            base64: img.dataUrl.split(',')[1]
        }));
    }
}
