import * as fs from 'fs';
import * as path from 'path';

interface ResumenModeloRow {
  proveedor: string;
  modelo: string;
  llamadas_totales: number;
  llamadas_exitosas: number;
  tasa_exito_pct: number;
  json_valido_primer_intento_pct: number;
  estructura_valida_primer_intento_pct: number;
  latencia_media_ms: number | null;
  latencia_mediana_ms: number | null;
  latencia_p95_ms: number | null;
  solicitudes_http_totales: number;
  costo_teorico_promedio_cuento_usd: number | null;
  costo_teorico_100_cuentos_usd: number | null;
  costo_teorico_1000_cuentos_usd: number | null;
  costo_efectivo_experimento_usd: number | null;
  es_simulado: boolean;
}

function parsearResumenModelosCsv(rutaCsv: string): ResumenModeloRow[] {
  if (!fs.existsSync(rutaCsv)) {
    throw new Error(`Archivo no encontrado: ${rutaCsv}`);
  }
  const lines = fs.readFileSync(rutaCsv, 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ResumenModeloRow[] = [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length < headers.length) continue;
    const get = (name: string) => cols[headers.indexOf(name)] || '';

    const parseNumOrNull = (val: string) => {
      if (!val || val === 'desconocido' || val === 'N/A') return null;
      const parsed = parseFloat(val);
      return isNaN(parsed) ? null : parsed;
    };

    rows.push({
      proveedor: get('proveedor'),
      modelo: get('modelo'),
      llamadas_totales: parseInt(get('llamadas_totales'), 10) || 0,
      llamadas_exitosas: parseInt(get('llamadas_exitosas'), 10) || 0,
      tasa_exito_pct: parseFloat(get('tasa_exito_pct')) || 0,
      json_valido_primer_intento_pct: parseFloat(get('json_valido_primer_intento_pct')) || 0,
      estructura_valida_primer_intento_pct: parseFloat(get('estructura_valida_primer_intento_pct')) || 0,
      latencia_media_ms: parseNumOrNull(get('latencia_media_ms')),
      latencia_mediana_ms: parseNumOrNull(get('latencia_mediana_ms')),
      latencia_p95_ms: parseNumOrNull(get('latencia_p95_ms')),
      solicitudes_http_totales: parseInt(get('solicitudes_http_totales'), 10) || 0,
      costo_teorico_promedio_cuento_usd: parseNumOrNull(get('costo_teorico_promedio_cuento_usd')),
      costo_teorico_100_cuentos_usd: parseNumOrNull(get('costo_teorico_100_cuentos_usd')),
      costo_teorico_1000_cuentos_usd: parseNumOrNull(get('costo_teorico_1000_cuentos_usd')),
      costo_efectivo_experimento_usd: parseNumOrNull(get('costo_efectivo_experimento_usd')),
      es_simulado: get('es_simulado') === 'true',
    });
  }
  return rows;
}

function calcularPuntajeEstructura(pctPrimerIntento: number): { score1a5: number; puntosPonderados: number } {
  let score = 1;
  if (pctPrimerIntento >= 100) {
    score = 5;
  } else if (pctPrimerIntento >= 95) {
    score = 4;
  } else if (pctPrimerIntento >= 90) {
    score = 3;
  } else if (pctPrimerIntento >= 80) {
    score = 2;
  } else {
    score = 1;
  }
  const puntosPonderados = (score / 5) * 25.0;
  return { score1a5: score, puntosPonderados };
}

function main(): void {
  const args = process.argv.slice(2);
  const esPiloto = args.includes('--pilot');

  const carpetaBase = esPiloto
    ? path.resolve(process.cwd(), 'benchmark/resultados_piloto')
    : path.resolve(process.cwd(), 'benchmark/resultados');

  let rutaCsv = path.join(carpetaBase, 'resumen_modelos.csv');
  if (!fs.existsSync(rutaCsv)) {
    const rutaTemp = path.join(carpetaBase, 'temp', 'resumen_modelos.csv');
    if (fs.existsSync(rutaTemp)) {
      rutaCsv = rutaTemp;
    }
  }

  if (!fs.existsSync(rutaCsv)) {
    console.error(`No se encontró el archivo de resumen de modelos en: ${rutaCsv}`);
    console.error('Ejecute primero una corrida real (--pilot o --full) para generar métricas.');
    process.exit(1);
  }

  const filas = parsearResumenModelosCsv(rutaCsv);

  // REGLA ESTRICTA: NO aceptar resultados simulados
  if (filas.some((f) => f.es_simulado)) {
    console.error('========================================================================');
    console.error('No se puede consolidar la matriz con datos simulados.');
    console.error('El archivo evaluado corresponde a un dry-run y no contiene métricas empíricas reales.');
    console.error('========================================================================');
    process.exit(1);
  }

  console.log('========================================================================');
  console.log(`MATRIZ MULTICRITERIO DE DECISIÓN TECNOLÓGICA (${esPiloto ? 'PILOTO' : 'DEFINITIVO'})`);
  console.log('========================================================================\n');

  console.log('Ponderaciones oficiales:');
  console.log('  Estructura Técnica:   25 % (automática por estructura_valida_primer_intento_pct)');
  console.log('  Calidad Narrativa:    25 % (humana ciega, 1 a 5)');
  console.log('  Adecuación Educativa: 20 % (humana ciega, 1 a 5)');
  console.log('  Tiempo (Latencia):    20 % (objetiva: media, mediana, p95 ms)');
  console.log('  Costo Económico:      10 % (objetiva: costo teórico / costo efectivo USD)\n');

  for (const fila of filas) {
    const est = calcularPuntajeEstructura(fila.estructura_valida_primer_intento_pct);

    console.log(`------------------------------------------------------------------------`);
    console.log(`CANDIDATO: ${fila.proveedor} | Modelo: ${fila.modelo}`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`1. ESTRUCTURA (25%):`);
    console.log(`   - Validez primer intento: ${fila.estructura_valida_primer_intento_pct.toFixed(2)} %`);
    console.log(`   - Puntaje asignado (1..5): ${est.score1a5}/5`);
    console.log(`   - Puntos ponderados:      ${est.puntosPonderados.toFixed(2)} / 25.00 pts`);

    console.log(`2. NARRATIVA (25%):`);
    console.log(`   - Estado: [Pendiente de evaluación humana ciega]`);
    console.log(`   - Puntos asignables: (Nota_Narrativa / 5 * 25.0) pts`);

    console.log(`3. ADECUACIÓN EDUCATIVA (20%):`);
    console.log(`   - Estado: [Pendiente de evaluación humana ciega]`);
    console.log(`   - Puntos asignables: (Nota_Adecuacion / 5 * 20.0) pts`);

    console.log(`4. TIEMPO (20%):`);
    console.log(`   - Latencia Media:   ${fila.latencia_media_ms !== null ? fila.latencia_media_ms + ' ms' : 'N/A'}`);
    console.log(`   - Latencia Mediana: ${fila.latencia_mediana_ms !== null ? fila.latencia_mediana_ms + ' ms' : 'N/A'}`);
    console.log(`   - Latencia P95:     ${fila.latencia_p95_ms !== null ? fila.latencia_p95_ms + ' ms' : 'N/A'}`);

    console.log(`5. COSTO (10%):`);
    console.log(
      `   - Costo teórico por cuento:        ${
        fila.costo_teorico_promedio_cuento_usd !== null
          ? '$' + fila.costo_teorico_promedio_cuento_usd.toFixed(6) + ' USD'
          : 'N/A (tarifa dinámica/proveedor runtime)'
      }`
    );
    console.log(
      `   - Costo teórico por 100 cuentos:   ${
        fila.costo_teorico_100_cuentos_usd !== null
          ? '$' + fila.costo_teorico_100_cuentos_usd.toFixed(4) + ' USD'
          : 'N/A'
      }`
    );
    console.log(
      `   - Costo teórico por 1000 cuentos:  ${
        fila.costo_teorico_1000_cuentos_usd !== null
          ? '$' + fila.costo_teorico_1000_cuentos_usd.toFixed(4) + ' USD'
          : 'N/A'
      }`
    );
    console.log(
      `   - Costo efectivo experimento:      ${
        fila.costo_efectivo_experimento_usd !== null
          ? '$' + fila.costo_efectivo_experimento_usd.toFixed(6) + ' USD'
          : 'desconocido'
      }`
    );
    console.log('');
  }

  console.log('========================================================================');
  console.log('Fórmula final a consolidar tras evaluación ciega:');
  console.log('TOTAL = (Estructura/5 * 25) + (Narrativa/5 * 25) + (Adecuación/5 * 20) + (Tiempo/5 * 20) + (Costo/5 * 10)');
  console.log('========================================================================\n');
}

main();
