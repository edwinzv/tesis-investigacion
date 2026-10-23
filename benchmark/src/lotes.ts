import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  DefinicionLote,
  EstadoLoteEnum,
  EstadoLoteInfo,
  ResultadoOperacion,
} from './types.js';

export const DEFINICIONES_LOTES: DefinicionLote[] = [
  { lote: 1, casosIds: ['caso_01_misterio_agua', 'caso_02_robot_cielo'], repeticion: 1, operacionesPlanificadas: 30 },
  { lote: 2, casosIds: ['caso_03_arbol_hueco', 'caso_04_cometa_viento'], repeticion: 1, operacionesPlanificadas: 30 },
  { lote: 3, casosIds: ['caso_01_misterio_agua', 'caso_02_robot_cielo'], repeticion: 2, operacionesPlanificadas: 30 },
  { lote: 4, casosIds: ['caso_03_arbol_hueco', 'caso_04_cometa_viento'], repeticion: 2, operacionesPlanificadas: 30 },
  { lote: 5, casosIds: ['caso_01_misterio_agua', 'caso_02_robot_cielo'], repeticion: 3, operacionesPlanificadas: 30 },
  { lote: 6, casosIds: ['caso_03_arbol_hueco', 'caso_04_cometa_viento'], repeticion: 3, operacionesPlanificadas: 30 },
  { lote: 7, casosIds: ['caso_01_misterio_agua', 'caso_02_robot_cielo'], repeticion: 4, operacionesPlanificadas: 30 },
  { lote: 8, casosIds: ['caso_03_arbol_hueco', 'caso_04_cometa_viento'], repeticion: 4, operacionesPlanificadas: 30 },
  { lote: 9, casosIds: ['caso_01_misterio_agua', 'caso_02_robot_cielo'], repeticion: 5, operacionesPlanificadas: 30 },
  { lote: 10, casosIds: ['caso_03_arbol_hueco', 'caso_04_cometa_viento'], repeticion: 5, operacionesPlanificadas: 30 },
];

export const OPERACIONES_ORDENADAS = ['analisis', 'escena_1', 'escena_2', 'escena_3', 'escena_4'] as const;

export function obtenerDefinicionLote(numeroLote: number): DefinicionLote {
  if (numeroLote < 1 || numeroLote > 10 || !Number.isInteger(numeroLote)) {
    throw new Error(`Número de lote inválido: ${numeroLote}. Debe ser un entero entre 1 y 10.`);
  }
  return DEFINICIONES_LOTES[numeroLote - 1];
}

export function obtenerCarpetaLote(directorioBase: string, lote: number, esDryRun: boolean = false): string {
  const pad = String(lote).padStart(2, '0');
  const sub = `lote_${pad}`;
  if (esDryRun) {
    // Si directorioBase es benchmark/resultados_lotes, separar estrictamente a benchmark/resultados_simulados
    const baseDir = path.basename(directorioBase) === 'resultados_lotes'
      ? path.join(path.dirname(directorioBase), 'resultados_simulados')
      : path.join(directorioBase, 'simulados');
    return path.join(baseDir, sub);
  }
  return path.join(directorioBase, sub);
}

export function generarClaveOperacion(
  lote: number,
  modelo: string,
  caso: string,
  repeticion: number,
  operacion: string
): string {
  const pad = String(lote).padStart(2, '0');
  return `lote_${pad}___${modelo}___${caso}___rep_${repeticion}___${operacion}`;
}

export function generarIdEjecucion(
  lote: number,
  modelo: string,
  caso: string,
  repeticion: number,
  operacion: string,
  intento: number
): string {
  const pad = String(lote).padStart(2, '0');
  const modSanitizado = modelo.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `lote_${pad}_${modSanitizado}_${caso}_rep${repeticion}_${operacion}_int${intento}`;
}

export function obtenerHashesArchivosClave(rootDir: string): Record<string, string> {
  const archivos = [
    'benchmark/config/modelos.config.json',
    'benchmark/config/benchmark.config.json',
    'benchmark/src/contratos.ts',
    'benchmark/src/prompts.ts',
    'benchmark/src/runner.ts',
    'benchmark/src/lotes.ts',
    'benchmark/src/adaptadores/google.ts',
    'benchmark/src/adaptadores/groq.ts',
    'benchmark/src/adaptadores/groq_gpt_oss.ts',
  ];
  const hashes: Record<string, string> = {};
  for (const rel of archivos) {
    const full = path.join(rootDir, rel);
    if (fs.existsSync(full)) {
      hashes[rel] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  }
  return hashes;
}

export function obtenerGitCommit(rootDir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export function cargarOperacionesPrevias(carpetaLote: string, soloReales: boolean = false): {
  operacionesMap: Map<string, ResultadoOperacion>;
  eventosHistorial: any[];
} {
  const operacionesMap = new Map<string, ResultadoOperacion>();
  const eventosHistorial: any[] = [];

  const rutaEvents = path.join(carpetaLote, 'events.jsonl');
  if (fs.existsSync(rutaEvents)) {
    const contenido = fs.readFileSync(rutaEvents, 'utf-8').trim();
    if (contenido) {
      const lineas = contenido.split(/\r?\n/);
      for (const linea of lineas) {
        if (!linea.trim()) continue;
        try {
          const ev = JSON.parse(linea);
          eventosHistorial.push(ev);
          if (ev.type === 'operation_result' && ev.result) {
            const r = ev.result as ResultadoOperacion;
            if (soloReales && r.es_simulado) continue;
            const key = `${r.modelo}___${r.caso}___${r.repeticion}___${r.operacion}`;
            // Guardar o actualizar con el último intento
            operacionesMap.set(key, r);
          }
        } catch {}
      }
    }
  }

  // Si no había events.jsonl o estaba vacío, intentar leer ejecuciones_raw.csv
  if (operacionesMap.size === 0) {
    const rutaCsv = path.join(carpetaLote, 'ejecuciones_raw.csv');
    if (fs.existsSync(rutaCsv)) {
      const contenido = fs.readFileSync(rutaCsv, 'utf-8').replace(/^\uFEFF/, '').trim();
      if (contenido) {
        const lineas = contenido.split(/\r?\n/);
        if (lineas.length > 1) {
          const headers = lineas[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
          for (let i = 1; i < lineas.length; i++) {
            const cols = lineas[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
            if (cols.length < headers.length) continue;
            const get = (name: string) => cols[headers.indexOf(name)] || '';
            const esSimulado = get('es_simulado') === 'true';
            if (soloReales && esSimulado) continue;
            const modelo = get('modelo');
            const caso = get('caso');
            const repeticion = parseInt(get('repeticion'), 10) || 1;
            const operacion = get('operacion');
            const estructuraValida = get('estructura_valida') === 'true';
            const jsonValido = get('json_valido') === 'true';
            const errorCat = get('error_categoria');
            const errorMsg = get('error');

            const parseNum = (val: string) => {
              if (!val || val === 'N/A') return null;
              const n = parseFloat(val);
              return isNaN(n) ? null : n;
            };

            const r: ResultadoOperacion = {
              id_ejecucion: get('id_ejecucion'),
              proveedor: get('proveedor'),
              modelo,
              modelo_runtime: get('modelo_runtime'),
              provider_runtime: get('provider_runtime'),
              caso,
              repeticion,
              operacion,
              timestamp: get('timestamp'),
              http_status: parseNum(get('http_status')),
              tiempo_ms: parseNum(get('tiempo_ms')),
              tokens_entrada: parseNum(get('tokens_entrada')),
              tokens_salida: parseNum(get('tokens_salida')),
              tokens_razonamiento: parseNum(get('tokens_razonamiento')),
              tokens_salida_facturables: parseNum(get('tokens_salida_facturables')),
              tokens_totales: parseNum(get('tokens_totales')),
              tokens_disponibles: get('tokens_disponibles') === 'true',
              json_valido: jsonValido,
              estructura_valida: estructuraValida,
              ruta_controlada_valida: get('ruta_controlada_valida') === 'true' ? true : get('ruta_controlada_valida') === 'false' ? false : null,
              cumple_primer_intento: get('cumple_primer_intento') === 'true',
              numero_reintentos: parseInt(get('numero_reintentos'), 10) || 0,
              numero_solicitudes_http: parseInt(get('numero_solicitudes_http'), 10) || 0,
              error_categoria: errorCat,
              error: errorMsg,
              tarifa_input_usd_por_millon: parseNum(get('tarifa_input_usd_por_millon')),
              tarifa_output_usd_por_millon: parseNum(get('tarifa_output_usd_por_millon')),
              tarifa_fuente_runtime: get('tarifa_fuente_runtime'),
              costo_entrada_usd: parseNum(get('costo_entrada_usd')),
              costo_salida_usd: parseNum(get('costo_salida_usd')),
              costo_teorico_usd: parseNum(get('costo_teorico_usd')),
              costo_efectivo_experimento_usd: parseNum(get('costo_efectivo_experimento_usd')),
              free_tier_activo: get('free_tier_activo') === 'true',
              reasoning_config: get('reasoning_config'),
              structured_output_mode: get('structured_output_mode'),
              es_simulado: get('es_simulado') === 'true',
            };
            const key = `${modelo}___${caso}___${repeticion}___${operacion}`;
            operacionesMap.set(key, r);
          }
        }
      }
    }
  }

  return { operacionesMap, eventosHistorial };
}

export function obtenerEstadoLote(
  loteNum: number,
  directorioBase: string,
  incluirSimulados: boolean = false
): EstadoLoteInfo {
  const def = obtenerDefinicionLote(loteNum);
  const carpetaLote = obtenerCarpetaLote(directorioBase, loteNum, false);
  const carpetaLoteSim = obtenerCarpetaLote(directorioBase, loteNum, true);

  // Por defecto, NUNCA leer carpetas temporales ni simuladas para el estado experimental real
  const carpetaExistente = fs.existsSync(carpetaLote)
    ? carpetaLote
    : (incluirSimulados && fs.existsSync(carpetaLoteSim) ? carpetaLoteSim : null);

  if (!carpetaExistente || !fs.existsSync(carpetaExistente)) {
    return {
      lote: loteNum,
      casos: def.casosIds,
      repeticion: def.repeticion,
      estado: 'PENDIENTE',
      operacionesPlanificadas: def.operacionesPlanificadas,
      operacionesEjecutadas: 0,
      operacionesExitosas: 0,
      operacionesFallidas: 0,
      operacionesOmitidasPorDependencia: 0,
      solicitudesHttpReales: 0,
      costoTeoricoTotalUsd: null,
      carpetaLote,
    };
  }

  // Leer manifest si existe
  let fechaUtc: string | undefined;
  let estadoManifest: EstadoLoteEnum | undefined;
  let esSimuladoManifest = false;
  const rutaManifest = path.join(carpetaExistente, 'manifest.json');
  if (fs.existsSync(rutaManifest)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(rutaManifest, 'utf-8'));
      fechaUtc = manifest.fechaFinUtc || manifest.fechaInicioUtc;
      estadoManifest = manifest.estado;
      esSimuladoManifest = manifest.esSimulado === true;
    } catch {}
  }

  // Si no se solicitan simulados pero la carpeta encontrada tiene manifest simulado,
  // el estado experimental real de este lote es estrictamente PENDIENTE.
  if (!incluirSimulados && esSimuladoManifest) {
    return {
      lote: loteNum,
      casos: def.casosIds,
      repeticion: def.repeticion,
      estado: 'PENDIENTE',
      operacionesPlanificadas: def.operacionesPlanificadas,
      operacionesEjecutadas: 0,
      operacionesExitosas: 0,
      operacionesFallidas: 0,
      operacionesOmitidasPorDependencia: 0,
      solicitudesHttpReales: 0,
      costoTeoricoTotalUsd: null,
      carpetaLote,
    };
  }

  const { operacionesMap } = cargarOperacionesPrevias(carpetaExistente, !incluirSimulados);
  const operaciones = Array.from(operacionesMap.values());

  const operacionesEjecutadas = operaciones.length;
  if (operacionesEjecutadas === 0) {
    return {
      lote: loteNum,
      casos: def.casosIds,
      repeticion: def.repeticion,
      estado: 'PENDIENTE',
      operacionesPlanificadas: def.operacionesPlanificadas,
      operacionesEjecutadas: 0,
      operacionesExitosas: 0,
      operacionesFallidas: 0,
      operacionesOmitidasPorDependencia: 0,
      solicitudesHttpReales: 0,
      costoTeoricoTotalUsd: null,
      carpetaLote: carpetaExistente,
    };
  }

  const operacionesExitosas = operaciones.filter((o) => o.estructura_valida).length;
  const operacionesOmitidasPorDependencia = operaciones.filter((o) => o.error_categoria === 'dependency_failed').length;
  const operacionesFallidas = operaciones.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
  const solicitudesHttpReales = operaciones.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

  // Distinguir entre costo comprobado y costo desconocido:
  // Si alguna operación ejecutada no tiene costo comprobable (null), el costo total es desconocido (null -> 'N/A').
  const tieneCostoDesconocido = operaciones.some(
    (o) => o.costo_teorico_usd === null && o.error_categoria !== 'dependency_failed'
  );
  const costoTeoricoTotalUsd = tieneCostoDesconocido
    ? null
    : operaciones.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);

  let estado: EstadoLoteEnum = 'EN_PROGRESO';

  const huboFalloCuota = operaciones.some(
    (o) => o.error_categoria === 'rate_limit' || o.http_status === 429
  );

  if (operacionesEjecutadas >= def.operacionesPlanificadas) {
    if (operacionesFallidas === 0 && operacionesOmitidasPorDependencia === 0) {
      estado = 'COMPLETADO';
    } else if (huboFalloCuota) {
      estado = 'FALLO_CUOTA';
    } else {
      estado = 'INCOMPLETO';
    }
  } else {
    estado = huboFalloCuota ? 'FALLO_CUOTA' : 'INTERRUMPIDO';
  }

  if (estadoManifest && estado === 'COMPLETADO' && estadoManifest !== 'COMPLETADO') {
    estado = estadoManifest;
  }

  return {
    lote: loteNum,
    casos: def.casosIds,
    repeticion: def.repeticion,
    estado,
    operacionesPlanificadas: def.operacionesPlanificadas,
    operacionesEjecutadas,
    operacionesExitosas,
    operacionesFallidas,
    operacionesOmitidasPorDependencia,
    solicitudesHttpReales,
    costoTeoricoTotalUsd,
    fechaEjecucionUtc: fechaUtc,
    carpetaLote: carpetaExistente,
  };
}

export function obtenerEstadoTodosLotes(directorioBase: string, incluirSimulados: boolean = false): EstadoLoteInfo[] {
  return DEFINICIONES_LOTES.map((d) => obtenerEstadoLote(d.lote, directorioBase, incluirSimulados));
}

export function imprimirTablaEstadoLotes(directorioBase: string, incluirSimulados: boolean = false): void {
  const estados = obtenerEstadoTodosLotes(directorioBase, incluirSimulados);
  console.log('================================================================================================================');
  console.log('ESTADO DE LOS 10 LOTES DEL BENCHMARK EXPERIMENTAL (300 OPERACIONES PLANIFICADAS)' + (incluirSimulados ? ' [INCLUYE SIMULADOS]' : ' [RESULTADOS REALES]'));
  console.log('================================================================================================================');
  console.log(
    'Lote'.padEnd(6) +
    'Casos'.padEnd(36) +
    'Rep'.padEnd(6) +
    'Estado'.padEnd(16) +
    'Ops (Plan/Ejec/Exit)'.padEnd(24) +
    'HTTP'.padEnd(8) +
    'Costo Teórico USD'
  );
  console.log('-'.repeat(112));

  let totalPlan = 0;
  let totalEjec = 0;
  let totalExit = 0;
  let totalHttp = 0;
  let totalCosto: number | null = 0;

  for (const e of estados) {
    totalPlan += e.operacionesPlanificadas;
    totalEjec += e.operacionesEjecutadas;
    totalExit += e.operacionesExitosas;
    totalHttp += e.solicitudesHttpReales;
    if (totalCosto !== null) {
      if (e.costoTeoricoTotalUsd === null && e.operacionesEjecutadas > 0) {
        totalCosto = null;
      } else {
        totalCosto += e.costoTeoricoTotalUsd || 0;
      }
    }

    const casosStr = `${e.casos[0].slice(0, 16)} & ${e.casos[1].slice(0, 16)}`;
    const opsStr = `${e.operacionesPlanificadas} / ${e.operacionesEjecutadas} / ${e.operacionesExitosas}`;
    const costoStr = e.operacionesEjecutadas > 0 && e.costoTeoricoTotalUsd !== null
      ? `$${e.costoTeoricoTotalUsd.toFixed(4)}`
      : 'N/A';

    console.log(
      String(e.lote).padEnd(6) +
      casosStr.padEnd(36) +
      String(e.repeticion).padEnd(6) +
      e.estado.padEnd(16) +
      opsStr.padEnd(24) +
      String(e.solicitudesHttpReales).padEnd(8) +
      costoStr
    );
  }
  console.log('-'.repeat(112));
  console.log(
    'TOTAL'.padEnd(48) +
    `${totalPlan} / ${totalEjec} / ${totalExit}`.padEnd(24) +
    String(totalHttp).padEnd(8) +
    (totalEjec > 0 && totalCosto !== null ? `$${totalCosto.toFixed(4)}` : 'N/A')
  );
  console.log('================================================================================================================\n');
}
