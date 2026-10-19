const PIELES = ['#f3cfb1', '#e8b893', '#d39d74', '#b9805a', '#97623f'];
const PELOS = ['#1c1410', '#2e1c13', '#45291a', '#5f3a22', '#7a4b2a'];
const ROPAS = ['#2d6cdf', '#d9577c', '#2f9e7a', '#7a5cc7', '#e08a1e', '#3a3f4b', '#c0392b', '#1f8fb0'];
const FONDOS = [['#dfe9f7', '#b9cbe6'], ['#f4e3d7', '#e0c3ad'], ['#e1efe6', '#bcd9c6'], ['#ece4f5', '#cdbfe4']];

function generador(semilla) {
    let h = 2166136261;
    for (const c of String(semilla || 'lead')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h += 0x6d2b79f5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const elegir = (azar, lista) => lista[Math.floor(azar() * lista.length)];

export function esNombreFemenino(nombre) {
    const n = String(nombre || '').trim().split(' ')[0].toLowerCase();
    return /a$/.test(n) && !/^(luca|nicola|joshua|garcia)$/.test(n);
}

function oscurecer(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return '#' + [c(n >> 16), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function svgAvatar({ mujer, edad, azar, id }) {
    const piel = elegir(azar, PIELES);
    const mayor = edad >= 38;
    const pelo = mayor && azar() < 0.6 ? '#8d8a86' : elegir(azar, PELOS);
    const ropa = elegir(azar, ROPAS);
    const [f1, f2] = elegir(azar, FONDOS);
    const lentes = mayor ? azar() < 0.6 : azar() < 0.15;
    const sombra = oscurecer(piel, 0.88);

    const peloAtras = mujer
        ? `<path d="M62 112 C54 58 88 26 122 28 C160 30 190 62 180 118 C178 150 186 172 176 186 C164 190 158 168 160 128 L84 128 C84 168 76 190 62 184 C54 168 64 146 62 112 Z" fill="${pelo}"/>`
        : '';
    const peloFrente = mujer
        ? `<path d="M68 108 C64 58 98 36 122 38 C152 40 178 62 172 110 C164 82 146 66 120 68 C100 70 86 80 80 96 C76 102 72 106 68 108 Z" fill="${pelo}"/>`
        : `<path d="M70 98 C66 56 98 38 122 40 C152 40 176 60 170 100 C166 84 158 74 144 70 C128 66 104 66 92 72 C80 78 74 88 70 98 Z" fill="${pelo}"/>`;
    const barba = !mujer && edad >= 25 && azar() < 0.35
        ? `<path d="M80 128 C84 160 102 172 120 172 C138 172 156 160 160 128 C150 150 136 156 120 156 C104 156 90 150 80 128 Z" fill="${pelo}" opacity=".85"/>`
        : '';
    const gafas = lentes
        ? `<g fill="none" stroke="#2b2b2b" stroke-width="2.4"><circle cx="102" cy="106" r="12"/><circle cx="138" cy="106" r="12"/><path d="M114 105 L126 105"/></g>`
        : '';
    const aretes = mujer ? `<circle cx="73" cy="126" r="2.6" fill="#e5c158"/><circle cx="167" cy="126" r="2.6" fill="#e5c158"/>` : '';

    return `<svg class="av2d" viewBox="0 0 240 240" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="avFondo${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/></linearGradient></defs>
  <rect width="240" height="240" fill="url(#avFondo${id})"/>
  <g class="av-cuerpo">
    ${peloAtras}
    <path d="M36 240 C40 196 76 178 120 178 C164 178 200 196 204 240 Z" fill="${ropa}"/>
    <path d="M104 178 L120 196 L136 178 Z" fill="${oscurecer(ropa, 0.8)}"/>
    <rect x="106" y="140" width="28" height="42" rx="10" fill="${sombra}"/>
    <g class="av-cabeza">
      <ellipse cx="72" cy="112" rx="9" ry="13" fill="${sombra}"/>
      <ellipse cx="168" cy="112" rx="9" ry="13" fill="${sombra}"/>
      ${aretes}
      <ellipse cx="120" cy="106" rx="48" ry="56" fill="${piel}"/>
      ${peloFrente}
      ${barba}
      <circle cx="96" cy="128" r="8" fill="#e8747c" opacity=".14"/>
      <circle cx="144" cy="128" r="8" fill="#e8747c" opacity=".14"/>
      <g class="av-cejas" stroke="${oscurecer(pelo, 0.9)}" stroke-width="3.2" stroke-linecap="round" fill="none">
        <path class="av-ceja" d="M92 90 Q102 85 112 89"/>
        <path class="av-ceja" d="M128 89 Q138 85 148 90"/>
      </g>
      <g class="av-ojos">
        <ellipse cx="102" cy="106" rx="7.5" ry="5.2" fill="#fff"/>
        <ellipse cx="138" cy="106" rx="7.5" ry="5.2" fill="#fff"/>
        <g class="av-pupilas" fill="#2a1c14">
          <circle cx="102" cy="106" r="3.6"/>
          <circle cx="138" cy="106" r="3.6"/>
        </g>
      </g>
      ${gafas}
      <path d="M120 110 C117 121 115 125 121 127" fill="none" stroke="${oscurecer(piel, 0.72)}" stroke-width="2" stroke-linecap="round"/>
      <g class="av-boca">
        <path class="av-labios" d="M107 141 Q120 149 133 141" fill="none" stroke="#9b4848" stroke-width="3" stroke-linecap="round"/>
        <ellipse class="av-boca-abierta" cx="120" cy="143" rx="10" ry="0" fill="#5c2121"/>
      </g>
    </g>
  </g>
</svg>`;
}

let contador = 0;

export function crearAvatar(contenedor, { nombre, edad, semilla }) {
    const azar = generador(semilla || nombre);
    const mujer = esNombreFemenino(nombre);
    contenedor.innerHTML = svgAvatar({ mujer, edad: Number(edad) || 20, azar, id: ++contador });
    const stops = contenedor.querySelectorAll('linearGradient stop');
    contenedor.style.background = `linear-gradient(${stops[0].getAttribute('stop-color')}, ${stops[1].getAttribute('stop-color')})`;
    const raiz = contenedor.querySelector('.av2d');
    const ojos = raiz.querySelector('.av-ojos');
    const boca = raiz.querySelector('.av-boca-abierta');
    const labios = raiz.querySelector('.av-labios');

    let vivo = true;
    let hablando = false;
    let energia = 0;
    let cuadro = null;
    let parpadeo = null;

    const parpadear = () => {
        if (!vivo) return;
        ojos.style.transform = 'scaleY(0.1)';
        setTimeout(() => { ojos.style.transform = ''; }, 130);
        parpadeo = setTimeout(parpadear, 2500 + Math.random() * 3500);
    };
    parpadeo = setTimeout(parpadear, 1500);

    const animarBoca = (t) => {
        if (!vivo) return;
        if (hablando) {
            const onda = (Math.sin(t / 55) * 0.5 + 0.5) * (Math.sin(t / 137) * 0.35 + 0.65);
            energia = Math.max(0, energia - 0.06);
            const apertura = Math.max(onda * 0.75, energia);
            boca.setAttribute('ry', (1 + apertura * 6.5).toFixed(2));
            boca.setAttribute('rx', (8 + apertura * 3).toFixed(2));
            labios.style.opacity = apertura > 0.35 ? '0' : '1';
        }
        cuadro = requestAnimationFrame(animarBoca);
    };
    cuadro = requestAnimationFrame(animarBoca);

    return {
        estado(clase) {
            raiz.classList.remove('av-escuchando', 'av-pensando', 'av-hablando');
            if (['escuchando', 'pensando', 'hablando'].includes(clase)) raiz.classList.add('av-' + clase);
        },
        hablar(on) {
            hablando = !!on;
            if (!hablando) {
                boca.setAttribute('ry', '0');
                labios.style.opacity = '1';
            }
        },
        pulso() {
            energia = 1;
        },
        destruir() {
            vivo = false;
            clearTimeout(parpadeo);
            cancelAnimationFrame(cuadro);
            contenedor.innerHTML = '';
            contenedor.style.background = '';
        },
    };
}
