import * as fs from 'fs';
import * as path from 'path';
import {
  DEFINICIONES_LOTES,
  cargarOperacionesPrevias,
  obtenerCarpetaLote,
} from './lotes.js';
import {
  ResultadoOperacion,
  EvaluacionPedagogicaItem,
} from './types.js';
import {
  calcularMediana,
  calcularP95,
  exportarEjecucionesCsv,
} from './reportes.js';

export interface ConsolidacionResultados {
  totalPlanificadas: number;
  totalEjecutadas: number;
  totalExitosas: number;
  totalFallidas: number;
  totalOmitidasDependencia: number;
  totalSolicitudesHttp: number;
  costoTeoricoTotalUsd: number | null;
  lotesEncontrados: number;
  lotesCompletos: number;
  archivosGenerados: string[];
}

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatNum(val: number | null | undefined, dec: number = 4): string {
  if (val === null || val === undefined) return 'N/A';
  return val.toFixed(dec);
}

export function consolidarExperimento(
  directorioBaseLotes: string,
  carpetaSalida: string,
  soloReales: boolean = true
): ConsolidacionResultados {
  if (!fs.existsSync(carpetaSalida)) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
  }

  const operacionesAutoritativas = new Map<string, ResultadoOperacion>();
  let lotesEncontrados = 0;
  let lotesCompletos = 0;
  const muestrasPedagogicas: EvaluacionPedagogicaItem[] = [];

  for (const def of DEFINICIONES_LOTES) {
    const carpetaLote = obtenerCarpetaLote(directorioBaseLotes, def.lote, false);
    const carpetaLoteSim = obtenerCarpetaLote(directorioBaseLotes, def.lote, true);
    const carpetaEfectiva = fs.existsSync(carpetaLote)
      ? carpetaLote
      : (!soloReales && fs.existsSync(carpetaLoteSim) ? carpetaLoteSim : null);

    if (!carpetaEfectiva) continue;

    // Verificar manifiesto si existe
    const rutaManifest = path.join(carpetaEfectiva, 'manifest.json');
    if (fs.existsSync(rutaManifest)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(rutaManifest, 'utf-8'));
        if (soloReales && manifest.esSimulado) {
          // Ignorar lote simulado en consolidación académica
          continue;
        }
      } catch {}
    }

    const { operacionesMap, eventosHistorial } = cargarOperacionesPrevias(carpetaEfectiva, soloReales);
    if (operacionesMap.size === 0) continue;

    lotesEncontrados++;
    let exitosasLote = 0;

    for (const [key, op] of operacionesMap.entries()) {
      if (soloReales && op.es_simulado) continue;
      operacionesAutoritativas.set(key, op);
      if (op.estructura_valida) exitosasLote++;
    }

    if (exitosasLote >= def.operacionesPlanificadas) {
      lotesCompletos++;
    }

    // Extraer muestras para evaluación pedagógica ciega desde eventos
    for (const ev of eventosHistorial) {
      if (ev.type === 'operation_result' && ev.result && ev.result.operacion === 'analisis' && ev.result.contenido_generado) {
        const r = ev.result as ResultadoOperacion;
        if (soloReales && r.es_simulado) continue;
        const contenido = r.contenido_generado;
        const sampleId = `muestra_lote${def.lote}_${r.caso}_rep${r.repeticion}_${r.modelo.slice(0, 8)}`;
        muestrasPedagogicas.push({
          id_muestra: sampleId,
          id_ejecucion_analisis: r.id_ejecucion,
          modelo_anonimizado: `Modelo_${createHashSha(r.modelo).slice(0, 6)}`,
          caso: r.caso,
          repeticion: r.repeticion,
          titulo_generado: contenido.titulo || 'Sin título',
          historia_completa: contenido.resumen || '',
          preguntas_u_opciones: [],
          evaluacion: {
            coherencia_narrativa: null,
            claridad_lenguaje: null,
            adecuacion_nivel_primaria: null,
            riqueza_vocabulario: null,
            continuidad_escenas: null,
            correspondencia_entrada_estudiante: null,
            utilidad_comprension_lectora: null,
            estado: 'PENDIENTE_EVALUACION_HUMANA',
            evaluador: null,
            observaciones: null,
          },
        });
      }
    }
  }

  function createHashSha(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  const todasOps = Array.from(operacionesAutoritativas.values());

  const totalPlanificadas = 300;
  const totalEjecutadas = todasOps.length;
  const totalExitosas = todasOps.filter((o) => o.estructura_valida).length;
  const totalOmitidasDependencia = todasOps.filter((o) => o.error_categoria === 'dependency_failed').length;
  const totalFallidas = todasOps.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
  const totalSolicitudesHttp = todasOps.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

  const tieneCostoNull = totalEjecutadas === 0 || todasOps.some((o) => o.costo_teorico_usd === null && o.error_categoria !== 'dependency_failed');
  const costoTeoricoTotalUsd = tieneCostoNull
    ? null
    : todasOps.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);

  const archivosGenerados: string[] = [];

  // 1. ejecuciones_raw_consolidado.csv
  const rutaRawCsv = path.join(carpetaSalida, 'ejecuciones_raw_consolidado.csv');
  exportarEjecucionesCsv(todasOps, carpetaSalida);
  // Renombrar a ejecuciones_raw_consolidado.csv
  const rawOriginal = path.join(carpetaSalida, 'ejecuciones_raw.csv');
  if (fs.existsSync(rawOriginal)) {
    fs.copyFileSync(rawOriginal, rutaRawCsv);
    fs.unlinkSync(rawOriginal);
  }
  archivosGenerados.push(rutaRawCsv);

  // 2. resumen_modelos_consolidado.csv
  const rutaModelosCsv = path.join(carpetaSalida, 'resumen_modelos_consolidado.csv');
  const gruposModelo = new Map<string, ResultadoOperacion[]>();
  for (const op of todasOps) {
    if (!gruposModelo.has(op.modelo)) gruposModelo.set(op.modelo, []);
    gruposModelo.get(op.modelo)!.push(op);
  }

  const lineasModelos = [
    [
      'proveedor',
      'modelo',
      'operaciones_planificadas',
      'operaciones_ejecutadas',
      'operaciones_exitosas',
      'operaciones_fallidas',
      'operaciones_omitidas_dependencia',
      'tasa_exito_pct',
      'json_valido_primer_intento_pct',
      'estructura_valida_primer_intento_pct',
      'latencia_media_ms',
      'latencia_mediana_ms',
      'latencia_p95_ms',
      'solicitudes_http_reales',
      'tokens_entrada_total',
      'tokens_salida_total',
      'tokens_razonamiento_total',
      'tokens_totales',
      'errores_rate_limit',
      'errores_http_otros',
      'costo_teorico_total_usd',
      'costo_efectivo_total_usd',
    ].join(','),
  ];

  for (const [modelo, ops] of gruposModelo.entries()) {
    const prov = ops[0].proveedor;
    const plan = 100;
    const ejec = ops.length;
    const exitosas = ops.filter((o) => o.estructura_valida).length;
    const fallidas = ops.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
    const omitidas = ops.filter((o) => o.error_categoria === 'dependency_failed').length;
    const tasaExito = (exitosas / (plan || 1)) * 100;

    const primerIntentoJson = ops.filter((o) => o.json_valido && o.cumple_primer_intento).length;
    const jsonValidoPct = (primerIntentoJson / (ejec || 1)) * 100;

    const primerIntentoEst = ops.filter((o) => o.cumple_primer_intento).length;
    const estValidaPct = (primerIntentoEst / (ejec || 1)) * 100;

    const latenciasExitosas = ops.filter((o) => o.estructura_valida && o.tiempo_ms !== null).map((o) => o.tiempo_ms!);
    const latMedia = latenciasExitosas.length
      ? Math.round(latenciasExitosas.reduce((a, b) => a + b, 0) / latenciasExitosas.length)
      : null;
    const latMediana = calcularMediana(latenciasExitosas);
    const latP95 = calcularP95(latenciasExitosas);

    const httpReales = ops.reduce((a, b) => a + b.numero_solicitudes_http, 0);
    const inTokens = ops.reduce((a, b) => a + (b.tokens_entrada || 0), 0);
    const outTokens = ops.reduce((a, b) => a + (b.tokens_salida || 0), 0);
    const reasonTokens = ops.reduce((a, b) => a + (b.tokens_razonamiento || 0), 0);
    const totalTokens = ops.reduce((a, b) => a + (b.tokens_totales || 0), 0);

    const errRateLimit = ops.filter((o) => o.error_categoria === 'rate_limit' || o.http_status === 429).length;
    const errOtros = ops.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed' && o.error_categoria !== 'rate_limit' && o.http_status !== 429).length;

    const cTeorico = ops.reduce((a, b) => a + (b.costo_teorico_usd || 0), 0);

    lineasModelos.push(
      [
        escapeCsv(prov),
        escapeCsv(modelo),
        plan,
        ejec,
        exitosas,
        fallidas,
        omitidas,
        tasaExito.toFixed(2),
        jsonValidoPct.toFixed(2),
        estValidaPct.toFixed(2),
        formatNum(latMedia, 0),
        formatNum(latMediana, 0),
        formatNum(latP95, 0),
        httpReales,
        inTokens,
        outTokens,
        reasonTokens,
        totalTokens,
        errRateLimit,
        errOtros,
        formatNum(cTeorico, 6),
        'desconocido',
      ].join(',')
    );
  }
  fs.writeFileSync(rutaModelosCsv, lineasModelos.join('\n'), 'utf-8');
  archivosGenerados.push(rutaModelosCsv);

  // 3. resumen_casos_consolidado.csv
  const rutaCasosCsv = path.join(carpetaSalida, 'resumen_casos_consolidado.csv');
  const gruposCaso = new Map<string, ResultadoOperacion[]>();
  for (const op of todasOps) {
    if (!gruposCaso.has(op.caso)) gruposCaso.set(op.caso, []);
    gruposCaso.get(op.caso)!.push(op);
  }

  const lineasCasos = [
    [
      'caso',
      'operaciones_planificadas',
      'operaciones_ejecutadas',
      'operaciones_exitosas',
      'operaciones_fallidas',
      'operaciones_omitidas_dependencia',
      'tasa_exito_pct',
      'latencia_media_ms',
      'tokens_totales_promedio',
    ].join(','),
  ];

  for (const [caso, ops] of gruposCaso.entries()) {
    const plan = 75; // 3 modelos * 5 rep * 5 ops = 75 por caso
    const ejec = ops.length;
    const exitosas = ops.filter((o) => o.estructura_valida).length;
    const fallidas = ops.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
    const omitidas = ops.filter((o) => o.error_categoria === 'dependency_failed').length;
    const tasa = (exitosas / (plan || 1)) * 100;
    const latencias = ops.filter((o) => o.estructura_valida && o.tiempo_ms !== null).map((o) => o.tiempo_ms!);
    const latMedia = latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;
    const totalTokens = ops.reduce((a, b) => a + (b.tokens_totales || 0), 0);
    const tokensProm = ejec ? Math.round(totalTokens / ejec) : null;

    lineasCasos.push(
      [
        escapeCsv(caso),
        plan,
        ejec,
        exitosas,
        fallidas,
        omitidas,
        tasa.toFixed(2),
        formatNum(latMedia, 0),
        formatNum(tokensProm, 0),
      ].join(',')
    );
  }
  fs.writeFileSync(rutaCasosCsv, lineasCasos.join('\n'), 'utf-8');
  archivosGenerados.push(rutaCasosCsv);

  // 4. resumen_repeticiones_consolidado.csv
  const rutaRepsCsv = path.join(carpetaSalida, 'resumen_repeticiones_consolidado.csv');
  const gruposRep = new Map<number, ResultadoOperacion[]>();
  for (const op of todasOps) {
    if (!gruposRep.has(op.repeticion)) gruposRep.set(op.repeticion, []);
    gruposRep.get(op.repeticion)!.push(op);
  }

  const lineasReps = [
    [
      'repeticion',
      'operaciones_planificadas',
      'operaciones_ejecutadas',
      'operaciones_exitosas',
      'operaciones_fallidas',
      'tasa_exito_pct',
      'latencia_media_ms',
    ].join(','),
  ];

  for (let rep = 1; rep <= 5; rep++) {
    const ops = gruposRep.get(rep) || [];
    const plan = 60; // 4 casos * 3 modelos * 5 ops = 60 por repeticion
    const ejec = ops.length;
    const exitosas = ops.filter((o) => o.estructura_valida).length;
    const fallidas = ops.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
    const tasa = (exitosas / (plan || 1)) * 100;
    const latencias = ops.filter((o) => o.estructura_valida && o.tiempo_ms !== null).map((o) => o.tiempo_ms!);
    const latMedia = latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;

    lineasReps.push(
      [
        rep,
        plan,
        ejec,
        exitosas,
        fallidas,
        tasa.toFixed(2),
        formatNum(latMedia, 0),
      ].join(',')
    );
  }
  fs.writeFileSync(rutaRepsCsv, lineasReps.join('\n'), 'utf-8');
  archivosGenerados.push(rutaRepsCsv);

  // 5. datos_graficos_academicos.json
  const rutaGraficosJson = path.join(carpetaSalida, 'datos_graficos_academicos.json');
  const datosGraficos = {
    metadata: {
      fechaConsolidacionUtc: new Date().toISOString(),
      lotesTotales: 10,
      lotesEncontrados,
      lotesCompletos,
      totalOperacionesPlanificadas: totalPlanificadas,
      totalOperacionesEjecutadas: totalEjecutadas,
      totalOperacionesExitosas: totalExitosas,
      totalSolicitudesHttp,
      costoTeoricoTotalUsd,
    },
    porModelo: Array.from(gruposModelo.entries()).map(([modelo, ops]) => {
      const latencias = ops.filter((o) => o.estructura_valida && o.tiempo_ms !== null).map((o) => o.tiempo_ms!).sort((a, b) => a - b);
      return {
        modelo,
        proveedor: ops[0].proveedor,
        operacionesPlanificadas: 100,
        operacionesEjecutadas: ops.length,
        operacionesExitosas: ops.filter((o) => o.estructura_valida).length,
        operacionesFallidas: ops.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length,
        tasaExitoPct: (ops.filter((o) => o.estructura_valida).length / 100) * 100,
        latenciasMs: latencias,
        latenciaMediaMs: latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null,
        latenciaMedianaMs: calcularMediana(latencias),
        latenciaP95Ms: calcularP95(latencias),
        tokensEntradaTotal: ops.reduce((a, b) => a + (b.tokens_entrada || 0), 0),
        tokensSalidaTotal: ops.reduce((a, b) => a + (b.tokens_salida || 0), 0),
        tokensRazonamientoTotal: ops.reduce((a, b) => a + (b.tokens_razonamiento || 0), 0),
        tokensTotalesTotal: ops.reduce((a, b) => a + (b.tokens_totales || 0), 0),
        solicitudesHttpTotales: ops.reduce((a, b) => a + b.numero_solicitudes_http, 0),
        erroresRateLimit: ops.filter((o) => o.error_categoria === 'rate_limit' || o.http_status === 429).length,
        costoTeoricoTotalUsd: ops.reduce((a, b) => a + (b.costo_teorico_usd || 0), 0),
      };
    }),
    porCaso: Array.from(gruposCaso.entries()).map(([caso, ops]) => ({
      caso,
      operacionesPlanificadas: 75,
      operacionesEjecutadas: ops.length,
      operacionesExitosas: ops.filter((o) => o.estructura_valida).length,
      tasaExitoPct: (ops.filter((o) => o.estructura_valida).length / 75) * 100,
      latenciaMediaMs: ops.filter((o) => o.estructura_valida && o.tiempo_ms !== null).length
        ? Math.round(ops.filter((o) => o.estructura_valida && o.tiempo_ms !== null).map((o) => o.tiempo_ms!).reduce((a, b) => a + b, 0) / ops.filter((o) => o.estructura_valida).length)
        : null,
    })),
    porRepeticion: [1, 2, 3, 4, 5].map((rep) => {
      const ops = gruposRep.get(rep) || [];
      return {
        repeticion: rep,
        operacionesPlanificadas: 60,
        operacionesEjecutadas: ops.length,
        operacionesExitosas: ops.filter((o) => o.estructura_valida).length,
        tasaExitoPct: (ops.filter((o) => o.estructura_valida).length / 60) * 100,
      };
    }),
  };
  fs.writeFileSync(rutaGraficosJson, JSON.stringify(datosGraficos, null, 2), 'utf-8');
  archivosGenerados.push(rutaGraficosJson);

  // 6. evaluacion_pedagogica_rubrica.json
  const rutaPedagogica = path.join(carpetaSalida, 'evaluacion_pedagogica_rubrica.json');
  const estructuraPedagogica = {
    descripcion: 'Estructura metodológica para la evaluación humana de calidad pedagógica de los cuentos generados (Criterios de comprensión lectora en educación primaria).',
    advertenciaMetodologica: 'No contiene calificaciones inventadas ni simuladas. Todos los campos de evaluación cuantitativa permanecen en null hasta la aplicación de la rúbrica por jueces expertos.',
    rubricaCriterios: {
      escala: '1 a 5 (1: Muy Deficiente, 2: Regular, 3: Aceptable, 4: Bueno, 5: Sobresaliente)',
      criterios: [
        {
          id: 'coherencia_narrativa',
          nombre: 'Coherencia Narrativa',
          pesoPct: 20,
          descripcion: 'El relato presenta una estructura clara (inicio, nudo, desenlace), lógica causa-efecto comprensible para un estudiante de primaria y transiciones naturales.',
        },
        {
          id: 'claridad_lenguaje',
          nombre: 'Claridad y Corrección del Lenguaje',
          pesoPct: 15,
          descripcion: 'Sintaxis adecuada, ortografía rigurosa, oraciones de longitud manejable y ausencia de construcciones ambiguas o confusas.',
        },
        {
          id: 'adecuacion_nivel_primaria',
          nombre: 'Adecuación al Nivel de Primaria (8-10 años)',
          pesoPct: 20,
          descripcion: 'Tono, complejidad temática, longitud de párrafos y sensibilidad de los temas apropiados para tercer y cuarto grado de educación primaria.',
        },
        {
          id: 'riqueza_vocabulario',
          nombre: 'Riqueza y Pertinencia de Vocabulario',
          pesoPct: 10,
          descripcion: 'Uso de vocabulario rico y formativo pero accesible, con oportunidad de aprender nuevas palabras en contexto.',
        },
        {
          id: 'continuidad_escenas',
          nombre: 'Continuidad entre Escenas y Decisiones',
          pesoPct: 15,
          descripcion: 'Las elecciones del lector se integran de forma verosímil y visible en el desarrollo de la siguiente escena.',
        },
        {
          id: 'correspondencia_entrada_estudiante',
          nombre: 'Correspondencia con la Entrada del Estudiante',
          pesoPct: 10,
          descripcion: 'Fidelidad al texto fuente y respeto al rol del protagonista definido en el caso de estudio.',
        },
        {
          id: 'utilidad_comprension_lectora',
          nombre: 'Utilidad para Actividades de Comprensión Lectora',
          pesoPct: 10,
          descripcion: 'El cuento ofrece elementos suficientes para formular preguntas literales, inferenciales y crítico-valorativas.',
        },
      ],
    },
    muestrasAnonimizadas: muestrasPedagogicas,
  };
  fs.writeFileSync(rutaPedagogica, JSON.stringify(estructuraPedagogica, null, 2), 'utf-8');
  archivosGenerados.push(rutaPedagogica);

  return {
    totalPlanificadas,
    totalEjecutadas,
    totalExitosas,
    totalFallidas,
    totalOmitidasDependencia,
    totalSolicitudesHttp,
    costoTeoricoTotalUsd,
    lotesEncontrados,
    lotesCompletos,
    archivosGenerados,
  };
}

export function imprimirResumenConsolidado(resultado: ConsolidacionResultados): void {
  console.log('================================================================================');
  console.log('REPORTE CONSOLIDADO DEL EXPERIMENTO COMPLETO (10 LOTES / 300 OPERACIONES)');
  console.log('================================================================================');
  console.log(`Lotes inspeccionados:             ${resultado.lotesEncontrados} / 10`);
  console.log(`Lotes con 100% éxito:             ${resultado.lotesCompletos} / 10`);
  console.log(`Operaciones planificadas:         ${resultado.totalPlanificadas}`);
  console.log(`Operaciones ejecutadas:           ${resultado.totalEjecutadas}`);
  console.log(`Operaciones exitosas:             ${resultado.totalExitosas} (${((resultado.totalExitosas / (resultado.totalPlanificadas || 1)) * 100).toFixed(1)} %)`);
  console.log(`Operaciones fallidas directas:    ${resultado.totalFallidas}`);
  console.log(`Operaciones omitidas dependencia: ${resultado.totalOmitidasDependencia}`);
  console.log(`Solicitudes HTTP reales a APIs:   ${resultado.totalSolicitudesHttp}`);
  console.log(
    `Costo teórico total acumulado:    ${
      resultado.costoTeoricoTotalUsd !== null ? `$${resultado.costoTeoricoTotalUsd.toFixed(4)} USD` : 'N/A'
    }`
  );
  console.log('\nArchivos consolidados generados:');
  for (const f of resultado.archivosGenerados) {
    console.log(`  - ${f}`);
  }
  console.log('================================================================================\n');
}
