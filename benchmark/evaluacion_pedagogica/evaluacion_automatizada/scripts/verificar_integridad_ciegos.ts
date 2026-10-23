import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const EVAL_DIR = path.join(ROOT_DIR, 'benchmark', 'evaluacion_pedagogica');
const CUENTOS_CIEGOS_DIR = path.join(EVAL_DIR, 'cuentos_ciegos');

const PALABRAS_PROHIBIDAS_DELATORAS = [
  'gemini',
  'qwen',
  'gpt-oss',
  'openai',
  'groq',
  'google ai',
  'latenciams',
  'costousd',
  'tokensentrada',
  'tokenssalida',
  'tokensrazonamiento'
];

interface VerificacionCuento {
  id_ciego: string;
  archivo: string;
  existe: boolean;
  tamano_bytes: number;
  tiene_titulo: boolean;
  tiene_id_ciego: boolean;
  tiene_personaje: boolean;
  tiene_escenario: boolean;
  tiene_conflicto: boolean;
  num_escenas_detectadas: number;
  num_opciones_detectadas: number;
  contiene_palabras_prohibidas: boolean;
  palabras_delatoras_encontradas: string[];
  total_palabras: number;
  es_valido: boolean;
}

export function verificarIntegridad60Cuentos(): { exitoso: boolean; reporte: VerificacionCuento[]; resumen: any } {
  console.log('=== VERIFICACIÓN FORENSE DE INTEGRIDAD DE 60 CUENTOS CIEGOS ===');
  
  if (!fs.existsSync(CUENTOS_CIEGOS_DIR)) {
    throw new Error(`Directorio de cuentos ciegos no encontrado: ${CUENTOS_CIEGOS_DIR}`);
  }

  const resultados: VerificacionCuento[] = [];
  let fallosTotales = 0;

  for (let i = 1; i <= 60; i++) {
    const idCiego = `EVAL-${String(i).padStart(2, '0')}`;
    const fileName = `${idCiego}.md`;
    const filePath = path.join(CUENTOS_CIEGOS_DIR, fileName);

    const v: VerificacionCuento = {
      id_ciego: idCiego,
      archivo: fileName,
      existe: fs.existsSync(filePath),
      tamano_bytes: 0,
      tiene_titulo: false,
      tiene_id_ciego: false,
      tiene_personaje: false,
      tiene_escenario: false,
      tiene_conflicto: false,
      num_escenas_detectadas: 0,
      num_opciones_detectadas: 0,
      contiene_palabras_prohibidas: false,
      palabras_delatoras_encontradas: [],
      total_palabras: 0,
      es_valido: false
    };

    if (!v.existe) {
      fallosTotales++;
      resultados.push(v);
      continue;
    }

    const contenido = fs.readFileSync(filePath, 'utf8');
    v.tamano_bytes = Buffer.byteLength(contenido, 'utf8');

    // 1. Título
    v.tiene_titulo = /^#\s+.+/m.test(contenido);

    // 2. ID Ciego
    v.tiene_id_ciego = contenido.includes(`\`${idCiego}\``);

    // 3. Personaje, escenario, conflicto
    v.tiene_personaje = /Personaje Principal:/i.test(contenido);
    v.tiene_escenario = /Entorno \/ Escenario:/i.test(contenido);
    v.tiene_conflicto = /Conflicto Inicial:/i.test(contenido);

    // 4. Escenas
    const matchEscenas = contenido.match(/##\s+Escena\s+\d+:/gi);
    v.num_escenas_detectadas = matchEscenas ? matchEscenas.length : 0;

    // 5. Opciones de decisión (A, B, C)
    const matchOpciones = contenido.match(/^\s+[A-D]\)\s+.+/gm);
    v.num_opciones_detectadas = matchOpciones ? matchOpciones.length : 0;

    // 6. Conteo de palabras
    v.total_palabras = contenido.trim().split(/\s+/).length;

    // 7. Verificación de blindaje (sin palabras delatoras)
    const contenidoLower = contenido.toLowerCase();
    for (const p of PALABRAS_PROHIBIDAS_DELATORAS) {
      if (contenidoLower.includes(p)) {
        v.contiene_palabras_prohibidas = true;
        v.palabras_delatoras_encontradas.push(p);
      }
    }

    // Criterio de validez estricto
    v.es_valido = v.existe &&
                  v.tiene_titulo &&
                  v.tiene_id_ciego &&
                  v.tiene_personaje &&
                  v.tiene_escenario &&
                  v.tiene_conflicto &&
                  v.num_escenas_detectadas === 4 &&
                  v.num_opciones_detectadas >= 6 && // Al menos 2 o 3 opciones por escena intermedia
                  !v.contiene_palabras_prohibidas;

    if (!v.es_valido) {
      fallosTotales++;
    }

    resultados.push(v);
  }

  const resumen = {
    totalEsperados: 60,
    totalVerificados: resultados.length,
    validosAl100Pct: resultados.filter(r => r.es_valido).length,
    fallos: fallosTotales,
    tamanoMedioBytes: Math.round(resultados.reduce((acc, r) => acc + r.tamano_bytes, 0) / resultados.length),
    palabrasMedias: Math.round(resultados.reduce((acc, r) => acc + r.total_palabras, 0) / resultados.length),
    blindajeComprobado: resultados.every(r => !r.contiene_palabras_prohibidas)
  };

  return {
    exitoso: fallosTotales === 0,
    reporte: resultados,
    resumen
  };
}

if (require.main === module) {
  const { exitoso, resumen, reporte } = verificarIntegridad60Cuentos();
  console.log('Resultados de Verificación:');
  console.log(`- Cuentos evaluados: ${resumen.totalVerificados} / 60`);
  console.log(`- Válidos al 100%: ${resumen.validosAl100Pct} / 60`);
  console.log(`- Fallos o discrepancias: ${resumen.fallos}`);
  console.log(`- Tamaño medio: ${resumen.tamanoMedioBytes} bytes`);
  console.log(`- Palabras medias: ${resumen.palabrasMedias} palabras`);
  console.log(`- Ceguera estricta (0 marcas delatoras): ${resumen.blindajeComprobado ? 'SÍ (100% blindado)' : 'FALLO'}`);

  if (!exitoso) {
    console.error('ALERTA: Se detectaron cuentos con fallos de integridad:');
    reporte.filter(r => !r.es_valido).forEach(f => console.error(f));
    process.exit(1);
  } else {
    console.log('✓ VERIFICACIÓN EXITOSA: Los 60 cuentos anonimizados están íntegros, completos y 100% listos para evaluación.');
  }
}
