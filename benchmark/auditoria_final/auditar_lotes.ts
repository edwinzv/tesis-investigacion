import * as fs from 'fs';
import * as path from 'path';

interface EventoBenchmark {
  timestamp: string;
  type: string;
  phase?: string;
  batch?: number;
  model?: string;
  case?: string;
  repetition?: number;
  operation?: string;
  result?: any;
  error?: string;
  details?: any;
}

interface OperacionRaw {
  modelo: string;
  caso: string;
  repeticion: number;
  operacion: string;
  es_simulado: boolean;
  http_status: number | null;
  tiempo_ms: number | null;
  tokens_entrada: number | null;
  tokens_salida: number | null;
  tokens_razonamiento: number | null;
  tokens_totales: number | null;
  costo_teorico_usd: number | null;
  json_valido: boolean;
  estructura_valida: boolean;
  cumple_primer_intento: boolean;
  numero_solicitudes_http: number;
  error_categoria: string | null;
  error: string | null;
  origen_archivo?: string;
  intento?: number;
}

const ROOT_DIR = process.cwd();
const BENCHMARK_DIR = path.join(ROOT_DIR, 'benchmark');
const PRUEBAS_DIR = path.join(BENCHMARK_DIR, 'pruebas_de_modelos');
const AUDITORIA_DIR = path.join(BENCHMARK_DIR, 'auditoria_final');

const MODELOS = [
  {
    id: 'gemini-3.5-flash-lite',
    nombreCorto: 'Gemini 3.5 Flash Lite',
    proveedor: 'Google',
    carpeta: 'pruebas_de_gemini_3_5_flash_lite'
  },
  {
    id: 'qwen/qwen3.8-27b',
    nombreCorto: 'Qwen 3.8 27B',
    proveedor: 'Groq',
    carpeta: 'pruebas_de_qwen_3_8_27b'
  },
  {
    id: 'openai/gpt-oss-20b',
    nombreCorto: 'GPT-OSS 20B',
    proveedor: 'Groq',
    carpeta: 'pruebas_de_gpt_oss_20b'
  }
];

function parseCsv(contenido: string): any[] {
  const lineas = contenido.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lineas.length < 2) return [];
  const headers = lineas[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const registros: any[] = [];
  for (let i = 1; i < lineas.length; i++) {
    const rawCols = lineas[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    if (rawCols.length < headers.length) continue;
    const row: any = {};
    headers.forEach((h, idx) => {
      row[h] = rawCols[idx];
    });
    registros.push(row);
  }
  return registros;
}

function parseNum(val: any): number | null {
  if (val === null || val === undefined || val === '' || val === 'N/A') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseBool(val: any): boolean {
  return val === true || val === 'true';
}

function calcularMediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 1) return ordenados[mitad];
  return (ordenados[mitad - 1] + ordenados[mitad]) / 2;
}

function calcularP95(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(ordenados.length * 0.95), ordenados.length - 1);
  return ordenados[idx];
}

async function auditar() {
  console.log('================================================================');
  console.log('AUDITORÍA ACADÉMICA FORENSE DE BENCHMARK (30 LOTES EXPERIMENTALES)');
  console.log('================================================================\n');

  const resultadoAuditoria: any = {
    fecha: new Date().toISOString(),
    modelos: {}
  };

  for (const m of MODELOS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`AUDITANDO MODELO: ${m.nombreCorto} (${m.id})`);
    console.log(`------------------------------------------------------------`);

    const dirModelo = path.join(PRUEBAS_DIR, m.carpeta);
    const dirLotes = path.join(dirModelo, 'lotes');

    const lotesAuditados: any[] = [];
    const todosEventosHistoricos: any[] = [];
    const todasEjecucionesFinales: OperacionRaw[] = [];
    const todosIntentosHistoricos: any[] = [];

    let totalHttpVerificadas = 0;
    let totalLlamadasHttpPorError = 0;
    let totalOmitidasPorDependencia = 0;
    let totalReintentosCorrectivos = 0;

    for (let l = 1; l <= 10; l++) {
      const pad = String(l).padStart(2, '0');
      const dirLote = path.join(dirLotes, `lote_${pad}`);
      if (!fs.existsSync(dirLote)) {
        console.error(`ERROR: No existe el lote ${dirLote}`);
        continue;
      }

      // Archivos del lote
      const archivos = fs.readdirSync(dirLote);
      const manifestPath = path.join(dirLote, 'manifest.json');
      const eventsPath = path.join(dirLote, 'events.jsonl');
      const rawPath = path.join(dirLote, 'ejecuciones_raw.csv');

      // Leer manifest
      let manifest: any = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        } catch (e) {
          console.error(`Error leyendo manifest en lote ${l}`);
        }
      }

      // Buscar si existen respaldos de originales
      const backupsEvents = archivos.filter(f => f.startsWith('events_originales'));
      const backupsRaw = archivos.filter(f => f.startsWith('ejecuciones_raw_originales'));

      // Leer events.jsonl
      const eventosLote: any[] = [];
      if (fs.existsSync(eventsPath)) {
        const lineas = fs.readFileSync(eventsPath, 'utf-8').trim().split(/\r?\n/);
        for (const lin of lineas) {
          if (!lin.trim()) continue;
          try {
            const ev = JSON.parse(lin);
            eventosLote.push(ev);
            todosEventosHistoricos.push(ev);
          } catch {}
        }
      }

      // Leer backups de events si existen
      const eventosBackups: any[] = [];
      for (const b of backupsEvents) {
        const bPath = path.join(dirLote, b);
        const lineas = fs.readFileSync(bPath, 'utf-8').trim().split(/\r?\n/);
        for (const lin of lineas) {
          if (!lin.trim()) continue;
          try {
            eventosBackups.push(JSON.parse(lin));
          } catch {}
        }
      }

      // Leer ejecuciones_raw.csv
      const rowsRaw = fs.existsSync(rawPath) ? parseCsv(fs.readFileSync(rawPath, 'utf-8')) : [];
      
      // Leer backups de raw
      const rowsRawBackup: any[] = [];
      for (const b of backupsRaw) {
        const bPath = path.join(dirLote, b);
        rowsRawBackup.push(...parseCsv(fs.readFileSync(bPath, 'utf-8')));
      }

      // Analizar eventos del lote
      // En events.jsonl cada operation_result contiene un intento de operación
      const opResults = eventosLote.filter(e => e.type === 'operation_result' && e.result);
      
      // Contar llamadas HTTP en events.jsonl
      let httpLote = 0;
      let depOmitidasLote = 0;
      let exitosPrimerIntentoLote = 0;
      let recuperadasLote = 0;
      let fallidasLote = 0;

      // Agrupar por clave única
      const historialPorOp = new Map<string, any[]>();
      for (const ev of opResults) {
        const r = ev.result;
        const key = `${r.caso}___${r.repeticion}___${r.operacion}`;
        if (!historialPorOp.has(key)) historialPorOp.set(key, []);
        historialPorOp.get(key)!.push(r);
        todosIntentosHistoricos.push({ ...r, lote: l, origen: 'events.jsonl' });

        if (r.error_categoria === 'dependency_failed') {
          depOmitidasLote++;
        } else {
          // Si hubo solicitud HTTP real
          const numHttp = r.numero_solicitudes_http || (r.http_status ? 1 : 0);
          httpLote += numHttp;
        }
      }

      // Si hay eventos de respaldo que no están en events.jsonl actual, rastrearlos
      let httpEnBackupsNoEnEvents = 0;
      for (const bEv of eventosBackups) {
        if (bEv.type === 'operation_result' && bEv.result) {
          const r = bEv.result;
          todosIntentosHistoricos.push({ ...r, lote: l, origen: 'backup_events' });
          // Verificar si este intento ya está en opResults por timestamp o id
          const existe = opResults.some(e => e.timestamp === bEv.timestamp && e.result.operacion === r.operacion && e.result.caso === r.caso);
          if (!existe) {
            if (r.error_categoria === 'dependency_failed') {
              // 0 HTTP
            } else {
              const numHttp = r.numero_solicitudes_http || (r.http_status ? 1 : 0);
              httpEnBackupsNoEnEvents += numHttp;
            }
          }
        }
      }

      // Analizar las 10 operaciones finales del lote desde rowsRaw
      const opsFinalesLote: OperacionRaw[] = [];
      for (const row of rowsRaw) {
        const op: OperacionRaw = {
          modelo: row.modelo,
          caso: row.caso,
          repeticion: parseInt(row.repeticion, 10),
          operacion: row.operacion,
          es_simulado: parseBool(row.es_simulado),
          http_status: parseNum(row.http_status),
          tiempo_ms: parseNum(row.tiempo_ms),
          tokens_entrada: parseNum(row.tokens_entrada),
          tokens_salida: parseNum(row.tokens_salida),
          tokens_razonamiento: parseNum(row.tokens_razonamiento),
          tokens_totales: parseNum(row.tokens_totales),
          costo_teorico_usd: parseNum(row.costo_teorico_usd),
          json_valido: parseBool(row.json_valido),
          estructura_valida: parseBool(row.estructura_valida),
          cumple_primer_intento: parseBool(row.cumple_primer_intento),
          numero_solicitudes_http: parseNum(row.numero_solicitudes_http) || 0,
          error_categoria: row.error_categoria || null,
          error: row.error || null,
          origen_archivo: 'ejecuciones_raw.csv'
        };
        opsFinalesLote.push(op);
        todasEjecucionesFinales.push(op);

        if (op.cumple_primer_intento) {
          exitosPrimerIntentoLote++;
        } else {
          recuperadasLote++;
        }
      }

      // Detalle del lote
      const loteAudit = {
        lote: l,
        planificadas: 10,
        finalesValidas: opsFinalesLote.filter(o => o.estructura_valida).length,
        exitosPrimerIntento: exitosPrimerIntentoLote,
        recuperadas: recuperadasLote,
        eventosTotales: eventosLote.length,
        intentosRegistradosEvents: opResults.length,
        solicitudesHttpVerificables: httpLote + httpEnBackupsNoEnEvents,
        solicitudesHttpEvents: httpLote,
        solicitudesHttpBackupsExtra: httpEnBackupsNoEnEvents,
        solicitudesHttpReportadasConsolidado: opsFinalesLote.reduce((acc, o) => acc + o.numero_solicitudes_http, 0),
        omisionesPorDependencia: depOmitidasLote,
        costoFinalUsd: opsFinalesLote.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0),
        tokensEntradaFinales: opsFinalesLote.reduce((acc, o) => acc + (o.tokens_entrada || 0), 0),
        tokensSalidaFinales: opsFinalesLote.reduce((acc, o) => acc + (o.tokens_salida || 0), 0),
        tokensRazonamientoFinales: opsFinalesLote.reduce((acc, o) => acc + (o.tokens_razonamiento || 0), 0),
        tokensTotalesFinales: opsFinalesLote.reduce((acc, o) => acc + (o.tokens_totales || 0), 0),
        tieneBackups: backupsEvents.length > 0 || backupsRaw.length > 0,
        archivosBackups: [...backupsEvents, ...backupsRaw]
      };

      lotesAuditados.push(loteAudit);
      totalHttpVerificadas += loteAudit.solicitudesHttpVerificables;
      totalOmitidasPorDependencia += depOmitidasLote;

      console.log(`  Lote ${pad}: ${loteAudit.finalesValidas}/10 válidas | 1erIntento: ${loteAudit.exitosPrimerIntento} | Recup: ${loteAudit.recuperadas} | HTTP Verif: ${loteAudit.solicitudesHttpVerificables} (Consolidado mostraba: ${loteAudit.solicitudesHttpReportadasConsolidado}) | Costo: $${loteAudit.costoFinalUsd.toFixed(6)} | DepOmitidas: ${depOmitidasLote}`);
      if (loteAudit.solicitudesHttpVerificables !== loteAudit.solicitudesHttpReportadasConsolidado) {
        console.log(`    ⚠️ DISCREPANCIA EN LOTE ${pad}: Verificables=${loteAudit.solicitudesHttpVerificables} vs Consolidado=${loteAudit.solicitudesHttpReportadasConsolidado} (Backups extra HTTP: ${httpEnBackupsNoEnEvents})`);
      }
    }

    // Métricas agregadas finales del modelo
    const latenciasValidas = todasEjecucionesFinales
      .filter(o => o.estructura_valida && typeof o.tiempo_ms === 'number' && o.tiempo_ms > 0)
      .map(o => o.tiempo_ms as number);

    const latenciaPromedio = latenciasValidas.length > 0 ? latenciasValidas.reduce((a, b) => a + b, 0) / latenciasValidas.length : 0;
    const latenciaMediana = calcularMediana(latenciasValidas);
    const latenciaP95 = calcularP95(latenciasValidas);

    const tokensEntradaTotales = todasEjecucionesFinales.reduce((acc, o) => acc + (o.tokens_entrada || 0), 0);
    const tokensSalidaTotales = todasEjecucionesFinales.reduce((acc, o) => acc + (o.tokens_salida || 0), 0);
    const tokensRazonamientoTotales = todasEjecucionesFinales.reduce((acc, o) => acc + (o.tokens_razonamiento || 0), 0);
    const tokensTotales = todasEjecucionesFinales.reduce((acc, o) => acc + (o.tokens_totales || 0), 0);

    const costoTotalUsd = todasEjecucionesFinales.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);
    const totalPlanificadas = 100;
    const totalValidas = todasEjecucionesFinales.filter(o => o.estructura_valida).length;
    const exitosPrimerIntentoTotal = todasEjecucionesFinales.filter(o => o.cumple_primer_intento).length;
    const recuperadasTotal = totalValidas - exitosPrimerIntentoTotal;
    const tasaCumplimientoPrimerIntento = (exitosPrimerIntentoTotal / totalPlanificadas) * 100;
    const tasaCumplimientoFinal = (totalValidas / totalPlanificadas) * 100;

    // Verificar si en los intentos fallidos hubo tokens registrados o no
    const intentosFallidos = todosIntentosHistoricos.filter((i: any) => !i.estructura_valida);
    const fallidosConTokens = intentosFallidos.filter((i: any) => (i.tokens_totales || 0) > 0);
    const fallidosSinTokens = intentosFallidos.filter((i: any) => !(i.tokens_totales || 0));

    resultadoAuditoria.modelos[m.id] = {
      info: m,
      operacionesPlanificadas: totalPlanificadas,
      operacionesValidasFinales: totalValidas,
      exitosPrimerIntento: exitosPrimerIntentoTotal,
      fallosIniciales: recuperadasTotal,
      operacionesRecuperadas: recuperadasTotal,
      tasaCumplimientoPrimerIntentoPct: tasaCumplimientoPrimerIntento,
      tasaCumplimientoFinalPct: tasaCumplimientoFinal,
      cuentosCompletos: Math.floor(totalValidas / 5),
      solicitudesHttpConsolidadasReportadas: todasEjecucionesFinales.reduce((acc, o) => acc + o.numero_solicitudes_http, 0),
      solicitudesHttpVerificablesReales: totalHttpVerificadas,
      omisionesPorDependenciaCeroHttp: totalOmitidasPorDependencia,
      latenciaMs: {
        promedio: latenciaPromedio,
        mediana: latenciaMediana,
        p95: latenciaP95,
        min: Math.min(...latenciasValidas),
        max: Math.max(...latenciasValidas)
      },
      tokens: {
        entrada: tokensEntradaTotales,
        salida: tokensSalidaTotales,
        razonamiento: tokensRazonamientoTotales,
        total: tokensTotales,
        promedioPorOperacion: tokensTotales / totalValidas,
        promedioPorCuento: tokensTotales / (totalValidas / 5)
      },
      costoUsd: {
        totalTeorico: costoTotalUsd,
        promedioPorOperacion: costoTotalUsd / totalValidas,
        promedioPorCuento: costoTotalUsd / (totalValidas / 5),
        incluyeFallidos: false,
        explicacionCostosFallidos: `Los proveedores no reportaron tokens en errores HTTP (ej. HTTP 400). Por rigor metodológico, no se inventaron consumos y se consignan los costos verificados correspondientes a las operaciones completadas.`
      },
      auditoriaIntentosFallidos: {
        totalIntentosFallidosHistorial: intentosFallidos.length,
        fallidosConTokens: fallidosConTokens.length,
        fallidosSinTokens: fallidosSinTokens.length,
        detallesFallidos: intentosFallidos.map((f: any) => ({
          caso: f.caso,
          repeticion: f.repeticion,
          operacion: f.operacion,
          lote: f.lote,
          http_status: f.http_status,
          error_categoria: f.error_categoria,
          error: f.error,
          tokens: f.tokens_totales || null,
          solicitudesHttp: f.error_categoria === 'dependency_failed' ? 0 : 1
        }))
      },
      lotes: lotesAuditados
    };
  }

  // Guardar resultado estructurado en auditoria_final
  const rutaJsonAuditoria = path.join(AUDITORIA_DIR, 'auditoria_consolidada.json');
  fs.writeFileSync(rutaJsonAuditoria, JSON.stringify(resultadoAuditoria, null, 2), 'utf-8');
  console.log(`\nAuditoría JSON guardada en: ${rutaJsonAuditoria}`);

  return resultadoAuditoria;
}

auditar().catch(console.error);
