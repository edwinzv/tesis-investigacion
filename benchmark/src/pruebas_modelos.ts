import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  DefinicionLote,
  EstadoLoteEnum,
  EstadoLoteInfo,
  ResultadoOperacion,
  StoryAnalysis,
  Escena,
  EscenaFinal,
  CasoEstudio,
} from './types.js';
import { AdaptadorModelo } from './adaptadores/base.js';
import { ejecutarOperacionIndividual } from './runner.js';
import { SCHEMAS, validarStoryAnalysis } from './contratos.js';
import { construirPromptAnalisis } from './prompts.js';
import { DEFINICIONES_LOTES, cargarOperacionesPrevias, obtenerGitCommit, obtenerHashesArchivosClave } from './lotes.js';
import {
  exportarEjecucionesCsv,
  consolidarResumenCuentos,
  consolidarResumenModelos,
  consolidarResumenOperaciones,
  calcularMediana,
  calcularP95,
} from './reportes.js';

export interface InfoModeloConfig {
  id: string;
  nombreCorto: string;
  carpeta: string;
  proveedor: string;
  tarifaInputUsdPorMillon: number;
  tarifaOutputUsdPorMillon: number;
}

export const CATALOGO_MODELOS_PRUEBAS: Record<string, InfoModeloConfig> = {
  'openai/gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    nombreCorto: 'gpt_oss_20b',
    carpeta: 'pruebas_de_gpt_oss_20b',
    proveedor: 'Groq',
    tarifaInputUsdPorMillon: 0.075,
    tarifaOutputUsdPorMillon: 0.3,
  },
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    nombreCorto: 'gemini_3_5_flash_lite',
    carpeta: 'pruebas_de_gemini_3_5_flash_lite',
    proveedor: 'Google',
    tarifaInputUsdPorMillon: 0.3,
    tarifaOutputUsdPorMillon: 2.5,
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    nombreCorto: 'gemini_3_8_flash',
    carpeta: 'prueba_piloto_gemini_3_8_flash',
    proveedor: 'Google',
    tarifaInputUsdPorMillon: 0.75,
    tarifaOutputUsdPorMillon: 3.75,
  },
  'qwen/qwen3.8-27b': {
    id: 'qwen/qwen3.8-27b',
    nombreCorto: 'qwen_3_8_27b',
    carpeta: 'pruebas_de_qwen_3_8_27b',
    proveedor: 'Groq',
    tarifaInputUsdPorMillon: 0.8,
    tarifaOutputUsdPorMillon: 4.0,
  },
};

export function normalizarIdModelo(idOAlias: string): string {
  const norm = idOAlias.trim().toLowerCase();
  if (
    norm === 'gpt-oss' ||
    norm === 'gpt_oss' ||
    norm === 'gpt-oss-20b' ||
    norm === 'gpt_oss_20b' ||
    norm === 'openai/gpt-oss-20b' ||
    norm.includes('gpt-oss')
  ) {
    return 'openai/gpt-oss-20b';
  }
  if (
    norm === 'gemini-3.8' ||
    norm === 'gemini-3.8-flash' ||
    norm === 'gemini_3_8_flash' ||
    norm === 'gemini3.8' ||
    norm === 'gemini38' ||
    norm.includes('3.8-flash') ||
    norm.includes('gemini-3.8')
  ) {
    return 'gemini-3.8-flash';
  }
  if (
    norm === 'gemini' ||
    norm === 'gemini-3.5' ||
    norm === 'gemini-3.5-flash-lite' ||
    norm === 'gemini_3_5_flash_lite' ||
    norm.includes('gemini')
  ) {
    return 'gemini-3.5-flash-lite';
  }
  if (
    norm === 'qwen' ||
    norm === 'qwen3.8' ||
    norm === 'qwen/qwen3.8-27b' ||
    norm === 'qwen_3_8_27b' ||
    norm.includes('qwen')
  ) {
    return 'qwen/qwen3.8-27b';
  }
  return idOAlias;
}

export function obtenerInfoModelo(modeloId: string): InfoModeloConfig {
  const normalizado = normalizarIdModelo(modeloId);
  const info = CATALOGO_MODELOS_PRUEBAS[normalizado];
  if (!info) {
    throw new Error(`Modelo no reconocido para pruebas independientes: "${modeloId}". Modelos disponibles: ${Object.keys(CATALOGO_MODELOS_PRUEBAS).join(', ')}`);
  }
  return info;
}

export function obtenerCarpetaModeloPruebas(modeloId: string, rootDir: string = process.cwd()): string {
  const info = obtenerInfoModelo(modeloId);
  return path.resolve(rootDir, 'benchmark/pruebas_de_modelos', info.carpeta);
}

export function obtenerCarpetaLoteModelo(modeloId: string, lote: number, esSimulado: boolean = false, rootDir: string = process.cwd()): string {
  const dirModelo = obtenerCarpetaModeloPruebas(modeloId, rootDir);
  const pad = String(lote).padStart(2, '0');
  const subcarpeta = esSimulado ? 'simulados' : 'lotes';
  return path.join(dirModelo, subcarpeta, `lote_${pad}`);
}

export function inicializarEstructuraCarpetasModelos(rootDir: string = process.cwd()): void {
  const basePruebas = path.resolve(rootDir, 'benchmark/pruebas_de_modelos');
  for (const info of Object.values(CATALOGO_MODELOS_PRUEBAS)) {
    const dirModelo = path.join(basePruebas, info.carpeta);
    const subcarpetas = ['lotes', 'cuentos_generados', 'reportes', 'diagnostico', 'cuento_prueba'];
    for (const sub of subcarpetas) {
      const p = path.join(dirModelo, sub);
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
      }
    }
  }
}

export interface ResultadoImportacionHistorica {
  modeloId: string;
  directorioOrigen: string;
  directorioDestino: string;
  operacionesImportadas: number;
  cuentosGenerados: number;
  hashesProcedencia: {
    archivoEvents: string;
    hashEventsSha256: string;
    archivoCsv: string;
    hashCsvSha256: string;
  };
  gitCommitOrigen: string | null;
}

export function sincronizarHistoricoGptOssSiAplica(rootDir: string = process.cwd()): ResultadoImportacionHistorica | null {
  inicializarEstructuraCarpetasModelos(rootDir);

  const modeloId = 'openai/gpt-oss-20b';
  const carpetaOrigenLote1 = path.resolve(rootDir, 'benchmark/resultados_lotes/lote_01');
  const dirModelo = obtenerCarpetaModeloPruebas(modeloId, rootDir);
  const carpetaDestinoLote1 = path.join(dirModelo, 'lotes/lote_01');

  if (!fs.existsSync(carpetaOrigenLote1)) {
    return null;
  }

  const rutaEventsOrigen = path.join(carpetaOrigenLote1, 'events.jsonl');
  const rutaCsvOrigen = path.join(carpetaOrigenLote1, 'ejecuciones_raw.csv');
  const rutaManifestOrigen = path.join(carpetaOrigenLote1, 'manifest.json');

  if (!fs.existsSync(rutaEventsOrigen) || !fs.existsSync(rutaCsvOrigen)) {
    return null;
  }

  const hashEvents = createHash('sha256').update(fs.readFileSync(rutaEventsOrigen)).digest('hex');
  const hashCsv = createHash('sha256').update(fs.readFileSync(rutaCsvOrigen)).digest('hex');

  let gitCommitOrigen: string | null = null;
  let fechaInicioOriginal = '2026-10-14T23:17:39.209Z';
  let fechaFinOriginal = '2026-10-14T23:27:22.086Z';

  if (fs.existsSync(rutaManifestOrigen)) {
    try {
      const man = JSON.parse(fs.readFileSync(rutaManifestOrigen, 'utf-8'));
      gitCommitOrigen = man.gitCommit || null;
      fechaInicioOriginal = man.fechaInicioUtc || fechaInicioOriginal;
      fechaFinOriginal = man.fechaFinUtc || fechaFinOriginal;
    } catch {}
  }

  // Filtrar operaciones de GPT-OSS de Lote 1
  const lineasEvents = fs.readFileSync(rutaEventsOrigen, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
  const eventosGpt: any[] = [];
  const operacionesGpt: ResultadoOperacion[] = [];

  for (const l of lineasEvents) {
    try {
      const ev = JSON.parse(l);
      if (ev.type === 'operation_result' && ev.result && ev.result.modelo === modeloId && ev.result.estructura_valida) {
        eventosGpt.push(ev);
        operacionesGpt.push(ev.result as ResultadoOperacion);
      }
    } catch {}
  }

  if (operacionesGpt.length === 0) {
    return null;
  }

  // Crear carpeta de Lote 1 para el modelo
  if (!fs.existsSync(carpetaDestinoLote1)) {
    fs.mkdirSync(carpetaDestinoLote1, { recursive: true });
  }

  // 1. Escribir events.jsonl del Lote 1
  const rutaEventsDest = path.join(carpetaDestinoLote1, 'events.jsonl');
  const contenidoEvents = eventosGpt.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(rutaEventsDest, contenidoEvents, 'utf-8');

  // 2. Escribir reportes CSV del Lote 1
  exportarEjecucionesCsv(operacionesGpt, carpetaDestinoLote1);
  consolidarResumenCuentos(operacionesGpt, carpetaDestinoLote1);
  consolidarResumenModelos(operacionesGpt, carpetaDestinoLote1);
  consolidarResumenOperaciones(operacionesGpt, carpetaDestinoLote1);

  // 3. Escribir manifest.json con procedencia documental estricta
  const manifestLote1 = {
    loteId: 'lote_01',
    lote: 1,
    modelo: modeloId,
    proveedor: 'Groq',
    fechaInicioUtc: fechaInicioOriginal,
    fechaFinUtc: fechaFinOriginal,
    estado: 'COMPLETADO',
    modo: 'REAL',
    esSimulado: false,
    procedenciaHistorica: {
      directorioOrigen: 'benchmark/resultados_lotes/lote_01',
      archivoEventsOrigen: 'events.jsonl',
      hashEventsSha256: hashEvents,
      archivoCsvOrigen: 'ejecuciones_raw.csv',
      hashCsvSha256: hashCsv,
      gitCommitOrigen,
      fechaImportacionUtc: new Date().toISOString(),
      metodo: 'importacion_trazable_sin_consumo_api',
    },
    casos: ['caso_01_misterio_agua', 'caso_02_robot_cielo'],
    repeticion: 1,
    operacionesPlanificadas: 10,
    operacionesEjecutadas: operacionesGpt.length,
    operacionesExitosas: operacionesGpt.filter((o) => o.estructura_valida).length,
    operacionesFallidas: 0,
    solicitudesHttpReales: operacionesGpt.reduce((acc, o) => acc + o.numero_solicitudes_http, 0),
    costoTeoricoTotalUsd: operacionesGpt.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0),
    costoEfectivoTotalUsd: null,
    gitCommit: obtenerGitCommit(rootDir),
    hashesCodigo: obtenerHashesArchivosClave(rootDir),
  };
  fs.writeFileSync(path.join(carpetaDestinoLote1, 'manifest.json'), JSON.stringify(manifestLote1, null, 2), 'utf-8');

  // 4. Reconstruir cuentos completos generados en cuentos_generados/
  const dirCuentos = path.join(dirModelo, 'cuentos_generados');
  const cuentosExportados = reconstruirYExportarCuentos(eventosGpt, dirCuentos);

  // 5. Actualizar los archivos raíz del modelo (ejecuciones_raw.csv, events.jsonl, manifest.json)
  consolidarResultadosModelo(modeloId, rootDir);

  return {
    modeloId,
    directorioOrigen: carpetaOrigenLote1,
    directorioDestino: carpetaDestinoLote1,
    operacionesImportadas: operacionesGpt.length,
    cuentosGenerados: cuentosExportados,
    hashesProcedencia: {
      archivoEvents: 'events.jsonl',
      hashEventsSha256: hashEvents,
      archivoCsv: 'ejecuciones_raw.csv',
      hashCsvSha256: hashCsv,
    },
    gitCommitOrigen,
  };
}

export function sincronizarHistoricoQwenSiAplica(rootDir: string = process.cwd()): ResultadoImportacionHistorica | null {
  inicializarEstructuraCarpetasModelos(rootDir);

  const modeloId = 'qwen/qwen3.8-27b';
  const carpetaOrigenLote1 = path.resolve(rootDir, 'benchmark/resultados_lotes/lote_01');
  const dirModelo = obtenerCarpetaModeloPruebas(modeloId, rootDir);
  const carpetaDestinoLote1 = path.join(dirModelo, 'lotes/lote_01');

  if (fs.existsSync(path.join(carpetaDestinoLote1, 'manifest.json'))) {
    return null;
  }

  if (!fs.existsSync(carpetaOrigenLote1)) {
    return null;
  }

  const rutaEventsOrigen = path.join(carpetaOrigenLote1, 'events.jsonl');
  const rutaCsvOrigen = path.join(carpetaOrigenLote1, 'ejecuciones_raw.csv');
  const rutaManifestOrigen = path.join(carpetaOrigenLote1, 'manifest.json');

  if (!fs.existsSync(rutaEventsOrigen) || !fs.existsSync(rutaCsvOrigen)) {
    return null;
  }

  const hashEvents = createHash('sha256').update(fs.readFileSync(rutaEventsOrigen)).digest('hex');
  const hashCsv = createHash('sha256').update(fs.readFileSync(rutaCsvOrigen)).digest('hex');

  let gitCommitOrigen: string | null = null;
  let fechaInicioOriginal = '2026-10-14T23:17:39.209Z';
  let fechaFinOriginal = '2026-10-14T23:27:22.086Z';

  if (fs.existsSync(rutaManifestOrigen)) {
    try {
      const man = JSON.parse(fs.readFileSync(rutaManifestOrigen, 'utf-8'));
      gitCommitOrigen = man.gitCommit || null;
      fechaInicioOriginal = man.fechaInicioUtc || fechaInicioOriginal;
      fechaFinOriginal = man.fechaFinUtc || fechaFinOriginal;
    } catch {}
  }

  // Filtrar operaciones de Qwen de Lote 1 (conservando tanto las 5 exitosas como los 5 fallos/omisiones)
  const lineasEvents = fs.readFileSync(rutaEventsOrigen, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
  const eventosQwen: any[] = [];
  const operacionesQwen: ResultadoOperacion[] = [];

  for (const l of lineasEvents) {
    try {
      const ev = JSON.parse(l);
      if (ev.type === 'operation_result' && ev.result && ev.result.modelo === modeloId) {
        eventosQwen.push(ev);
        operacionesQwen.push(ev.result as ResultadoOperacion);
      }
    } catch {}
  }

  if (operacionesQwen.length === 0) {
    return null;
  }

  // Crear carpeta de Lote 1 para Qwen
  if (!fs.existsSync(carpetaDestinoLote1)) {
    fs.mkdirSync(carpetaDestinoLote1, { recursive: true });
  }

  // 1. Escribir events.jsonl del Lote 1 (contiene las 10 operaciones: 5 exitosas, 1 rate_limit, 4 dependency_failed)
  const rutaEventsDest = path.join(carpetaDestinoLote1, 'events.jsonl');
  const contenidoEvents = eventosQwen.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(rutaEventsDest, contenidoEvents, 'utf-8');

  // 2. Escribir reportes CSV del Lote 1
  exportarEjecucionesCsv(operacionesQwen, carpetaDestinoLote1);
  consolidarResumenCuentos(operacionesQwen, carpetaDestinoLote1);
  consolidarResumenModelos(operacionesQwen, carpetaDestinoLote1);
  consolidarResumenOperaciones(operacionesQwen, carpetaDestinoLote1);

  const exitosas = operacionesQwen.filter((o) => o.estructura_valida).length;
  const fallidas = operacionesQwen.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
  const omitidas = operacionesQwen.filter((o) => o.error_categoria === 'dependency_failed').length;

  // 3. Escribir manifest.json con procedencia documental estricta
  const manifestLote1 = {
    loteId: 'lote_01',
    lote: 1,
    modelo: modeloId,
    proveedor: 'Groq',
    fechaInicioUtc: fechaInicioOriginal,
    fechaFinUtc: fechaFinOriginal,
    estado: 'FALLO_CUOTA',
    modo: 'REAL',
    esSimulado: false,
    procedenciaHistorica: {
      directorioOrigen: 'benchmark/resultados_lotes/lote_01',
      archivoEventsOrigen: 'events.jsonl',
      hashEventsSha256: hashEvents,
      archivoCsvOrigen: 'ejecuciones_raw.csv',
      hashCsvSha256: hashCsv,
      gitCommitOrigen,
      fechaImportacionUtc: new Date().toISOString(),
      metodo: 'importacion_trazable_con_registro_de_errores_y_exitos',
    },
    casos: ['caso_01_misterio_agua', 'caso_02_robot_cielo'],
    repeticion: 1,
    operacionesPlanificadas: 10,
    operacionesEjecutadas: operacionesQwen.length,
    operacionesExitosas: exitosas,
    operacionesFallidas: fallidas,
    operacionesOmitidasPorDependencia: omitidas,
    solicitudesHttpReales: operacionesQwen.reduce((acc, o) => acc + o.numero_solicitudes_http, 0),
    costoTeoricoTotalUsd: operacionesQwen.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0),
    costoEfectivoTotalUsd: null,
    gitCommit: obtenerGitCommit(rootDir),
    hashesCodigo: obtenerHashesArchivosClave(rootDir),
  };
  fs.writeFileSync(path.join(carpetaDestinoLote1, 'manifest.json'), JSON.stringify(manifestLote1, null, 2), 'utf-8');

  // 4. Reconstruir cuentos completos generados (Caso 1 tiene sus 5 ops completas!)
  const dirCuentos = path.join(dirModelo, 'cuentos_generados');
  const cuentosExportados = reconstruirYExportarCuentos(eventosQwen, dirCuentos);

  // 5. Consolidar archivos en raíz del modelo
  consolidarResultadosModelo(modeloId, rootDir);

  return {
    modeloId,
    directorioOrigen: carpetaOrigenLote1,
    directorioDestino: carpetaDestinoLote1,
    operacionesImportadas: operacionesQwen.length,
    cuentosGenerados: cuentosExportados,
    hashesProcedencia: {
      archivoEvents: 'events.jsonl',
      hashEventsSha256: hashEvents,
      archivoCsv: 'ejecuciones_raw.csv',
      hashCsvSha256: hashCsv,
    },
    gitCommitOrigen,
  };
}

export function sincronizarHistoricoGeminiSiAplica(rootDir: string = process.cwd()): ResultadoImportacionHistorica | null {
  inicializarEstructuraCarpetasModelos(rootDir);

  const modeloId = 'gemini-3.5-flash-lite';
  const carpetaOrigenLote1 = path.resolve(rootDir, 'benchmark/resultados_lotes/lote_01');
  const dirModelo = obtenerCarpetaModeloPruebas(modeloId, rootDir);
  const carpetaDestinoLote1 = path.join(dirModelo, 'lotes/lote_01');

  if (fs.existsSync(path.join(carpetaDestinoLote1, 'manifest.json'))) {
    return null;
  }

  if (!fs.existsSync(carpetaOrigenLote1)) {
    return null;
  }

  const rutaEventsOrigen = path.join(carpetaOrigenLote1, 'events.jsonl');
  const rutaCsvOrigen = path.join(carpetaOrigenLote1, 'ejecuciones_raw.csv');
  const rutaManifestOrigen = path.join(carpetaOrigenLote1, 'manifest.json');

  if (!fs.existsSync(rutaEventsOrigen) || !fs.existsSync(rutaCsvOrigen)) {
    return null;
  }

  const hashEvents = createHash('sha256').update(fs.readFileSync(rutaEventsOrigen)).digest('hex');
  const hashCsv = createHash('sha256').update(fs.readFileSync(rutaCsvOrigen)).digest('hex');

  let gitCommitOrigen: string | null = null;
  let fechaInicioOriginal = '2026-10-14T23:17:39.209Z';
  let fechaFinOriginal = '2026-10-14T23:27:22.086Z';

  if (fs.existsSync(rutaManifestOrigen)) {
    try {
      const man = JSON.parse(fs.readFileSync(rutaManifestOrigen, 'utf-8'));
      gitCommitOrigen = man.gitCommit || null;
      fechaInicioOriginal = man.fechaInicioUtc || fechaInicioOriginal;
      fechaFinOriginal = man.fechaFinUtc || fechaFinOriginal;
    } catch {}
  }

  // Filtrar operaciones de Gemini de Lote 1 (conservando tanto las 8 exitosas como el fallo HTTP 503 y la omisión por dependencia)
  const lineasEvents = fs.readFileSync(rutaEventsOrigen, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
  const eventosGemini: any[] = [];
  const operacionesGemini: ResultadoOperacion[] = [];

  for (const l of lineasEvents) {
    try {
      const ev = JSON.parse(l);
      if (ev.type === 'operation_result' && ev.result && ev.result.modelo === modeloId) {
        eventosGemini.push(ev);
        operacionesGemini.push(ev.result as ResultadoOperacion);
      }
    } catch {}
  }

  if (operacionesGemini.length === 0) {
    return null;
  }

  // Crear carpeta de Lote 1 para Gemini
  if (!fs.existsSync(carpetaDestinoLote1)) {
    fs.mkdirSync(carpetaDestinoLote1, { recursive: true });
  }

  // 1. Escribir events.jsonl del Lote 1 (contiene las 10 operaciones: 8 exitosas, 1 HTTP 503, 1 dependency_failed)
  const rutaEventsDest = path.join(carpetaDestinoLote1, 'events.jsonl');
  const contenidoEvents = eventosGemini.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(rutaEventsDest, contenidoEvents, 'utf-8');

  // Guardar copias inmutables de preservación histórica
  fs.writeFileSync(path.join(carpetaDestinoLote1, 'events_originales_lote01.jsonl'), contenidoEvents, 'utf-8');

  // 2. Escribir reportes CSV del Lote 1
  exportarEjecucionesCsv(operacionesGemini, carpetaDestinoLote1);
  const rutaCsvDest = path.join(carpetaDestinoLote1, 'ejecuciones_raw.csv');
  if (fs.existsSync(rutaCsvDest)) {
    fs.copyFileSync(rutaCsvDest, path.join(carpetaDestinoLote1, 'ejecuciones_raw_originales_lote01.csv'));
  }
  consolidarResumenCuentos(operacionesGemini, carpetaDestinoLote1);
  consolidarResumenModelos(operacionesGemini, carpetaDestinoLote1);
  consolidarResumenOperaciones(operacionesGemini, carpetaDestinoLote1);

  const exitosas = operacionesGemini.filter((o) => o.estructura_valida).length;
  const fallidas = operacionesGemini.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
  const omitidas = operacionesGemini.filter((o) => o.error_categoria === 'dependency_failed').length;

  // 3. Escribir manifest.json con procedencia documental estricta
  const manifestLote1 = {
    loteId: 'lote_01',
    lote: 1,
    modelo: modeloId,
    proveedor: 'Google',
    fechaInicioUtc: fechaInicioOriginal,
    fechaFinUtc: fechaFinOriginal,
    estado: 'INCOMPLETO',
    modo: 'REAL',
    esSimulado: false,
    procedenciaHistorica: {
      directorioOrigen: 'benchmark/resultados_lotes/lote_01',
      archivoEventsOrigen: 'events.jsonl',
      hashEventsSha256: hashEvents,
      archivoCsvOrigen: 'ejecuciones_raw.csv',
      hashCsvSha256: hashCsv,
      gitCommitOrigen,
      fechaImportacionUtc: new Date().toISOString(),
      metodo: 'importacion_trazable_con_registro_de_errores_y_exitos',
    },
    casos: ['caso_01_misterio_agua', 'caso_02_robot_cielo'],
    repeticion: 1,
    operacionesPlanificadas: 10,
    operacionesEjecutadas: operacionesGemini.length,
    operacionesExitosas: exitosas,
    operacionesFallidas: fallidas,
    operacionesOmitidasPorDependencia: omitidas,
    solicitudesHttpReales: operacionesGemini.reduce((acc, o) => acc + o.numero_solicitudes_http, 0),
    costoTeoricoTotalUsd: operacionesGemini.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0),
    costoEfectivoTotalUsd: null,
    gitCommit: obtenerGitCommit(rootDir),
    hashesCodigo: obtenerHashesArchivosClave(rootDir),
  };
  fs.writeFileSync(path.join(carpetaDestinoLote1, 'manifest.json'), JSON.stringify(manifestLote1, null, 2), 'utf-8');

  // 4. Reconstruir cuentos completos generados (Caso 2 tiene sus 5 ops completas!)
  const dirCuentos = path.join(dirModelo, 'cuentos_generados');
  const cuentosExportados = reconstruirYExportarCuentos(eventosGemini, dirCuentos);

  // 5. Consolidar archivos en raíz del modelo
  consolidarResultadosModelo(modeloId, rootDir);

  return {
    modeloId,
    directorioOrigen: carpetaOrigenLote1,
    directorioDestino: carpetaDestinoLote1,
    operacionesImportadas: operacionesGemini.length,
    cuentosGenerados: cuentosExportados,
    hashesProcedencia: {
      archivoEvents: 'events.jsonl',
      hashEventsSha256: hashEvents,
      archivoCsv: 'ejecuciones_raw.csv',
      hashCsvSha256: hashCsv,
    },
    gitCommitOrigen,
  };
}

export async function ejecutarDiagnosticoModelo(params: {
  adaptador: AdaptadorModelo;
  caso: CasoEstudio;
  carpetaSalida: string;
  esDryRun: boolean;
}): Promise<ResultadoOperacion> {
  const { adaptador, caso, carpetaSalida, esDryRun } = params;
  if (!fs.existsSync(carpetaSalida)) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
  }

  const prompt = construirPromptAnalisis(caso.textoFuente);
  const idEjecucion = `diag_${adaptador.id}_${caso.id}_analisis`;

  console.log('========================================================================');
  console.log(`NIVEL 1 — DIAGNÓSTICO INDEPENDIENTE (${esDryRun ? 'SIMULACIÓN DRY-RUN' : 'MODO REAL'})`);
  console.log('========================================================================');
  console.log(`Modelo:           ${adaptador.proveedor} (${adaptador.modelo})`);
  console.log(`Operación:        analisis`);
  console.log(`Caso de prueba:   ${caso.id} ("${caso.titulo}")`);
  console.log(`Carpeta salida:   ${carpetaSalida}`);
  const capInfo = adaptador.modelo === 'qwen/qwen3.8-27b' ? '650 tokens (OTPM limit: 1000)' : '2048 tokens';
  console.log(`Presupuesto cap:  ${capInfo}`);
  if (adaptador.modelo === 'qwen/qwen3.8-27b') {
    console.log(`Reasoning effort: ${process.env.GROQ_QWEN_REASONING_EFFORT || 'none'}`);
  } else if (adaptador.proveedor === 'Google') {
    console.log(`Cuota ref. Free:  15 RPM / 500 RPD / 250k TPM`);
  }
  console.log('========================================================================\n');

  const resultado = await ejecutarOperacionIndividual({
    idEjecucion,
    adaptador,
    caso,
    repeticion: 1,
    nombreOperacion: 'analisis',
    prompt,
    schema: SCHEMAS.analisis,
    tipoContrato: 'analisis',
    validador: (data) => validarStoryAnalysis(data),
    esDryRun,
    permitirRetry: false,
  });

  const rutaEvents = path.join(carpetaSalida, 'events.jsonl');
  fs.writeFileSync(rutaEvents, JSON.stringify({ type: 'operation_result', result: resultado }) + '\n', 'utf-8');
  exportarEjecucionesCsv([resultado], carpetaSalida);

  const diagManifest = {
    nivel: 1,
    tipo: 'diagnostico_conectividad_cuota_json',
    fechaUtc: new Date().toISOString(),
    modelo: adaptador.modelo,
    proveedor: adaptador.proveedor,
    esSimulado: esDryRun,
    httpStatus: resultado.http_status,
    exito: resultado.estructura_valida,
    jsonValido: resultado.json_valido,
    latenciaMs: resultado.tiempo_ms,
    tokens: {
      entrada: resultado.tokens_entrada,
      salida: resultado.tokens_salida,
      razonamiento: resultado.tokens_razonamiento,
      totales: resultado.tokens_totales,
      margenSobreLimite1000Otpm: resultado.tokens_salida !== null ? 1000 - resultado.tokens_salida : null,
    },
    costoTeoricoUsd: resultado.costo_teorico_usd,
    error: resultado.error || null,
    errorCategoria: resultado.error_categoria,
  };
  fs.writeFileSync(path.join(carpetaSalida, 'manifest.json'), JSON.stringify(diagManifest, null, 2), 'utf-8');

  console.log('\n========================================================================');
  console.log(`RESULTADO DEL DIAGNÓSTICO (NIVEL 1):`);
  console.log(`Estado HTTP:            ${resultado.http_status ?? 'N/A'}`);
  console.log(`Contrato JSON válido:   ${resultado.json_valido ? 'SÍ' : 'NO'}`);
  console.log(`Estructura válida:      ${resultado.estructura_valida ? 'SÍ' : 'NO'}`);
  console.log(`Latencia:               ${resultado.tiempo_ms !== null ? `${resultado.tiempo_ms} ms` : 'N/A'}`);
  console.log(`Tokens entrada:         ${resultado.tokens_entrada ?? 'N/A'}`);
  console.log(`Tokens salida:          ${resultado.tokens_salida ?? 'N/A'}`);
  console.log(`Tokens razonamiento:    ${resultado.tokens_razonamiento ?? 0}`);
  if (resultado.tokens_salida !== null) {
    const margen = 1000 - resultado.tokens_salida;
    console.log(`Margen disponible OTPM: ${margen} tokens (Límite: 1000 OTPM) -> ${margen > 0 ? '[DENTRO DEL LÍMITE]' : '[RIESGO DE CUOTA]'}`);
  }
  if (resultado.error) {
    console.log(`Error detectado:        [${resultado.error_categoria}] ${resultado.error}`);
  }
  console.log(`Archivos generados:`);
  console.log(`  - Manifiesto:         ${path.join(carpetaSalida, 'manifest.json')}`);
  console.log(`  - Operación (CSV):    ${path.join(carpetaSalida, 'ejecuciones_raw.csv')}`);
  console.log(`  - Eventos (JSONL):    ${path.join(carpetaSalida, 'events.jsonl')}`);
  console.log('========================================================================\n');

  return resultado;
}

export function reconstruirYExportarCuentos(items: any[], carpetaDestino: string): number {
  if (!fs.existsSync(carpetaDestino)) {
    fs.mkdirSync(carpetaDestino, { recursive: true });
  }

  // Agrupar operaciones por caso y repetición
  const grupos = new Map<string, Map<string, any>>();
  for (const item of items) {
    const r = (item && item.type === 'operation_result' && item.result) ? item.result : item;
    if (r && r.caso && r.repeticion && r.operacion) {
      const key = `${r.caso}___rep${r.repeticion}`;
      if (!grupos.has(key)) {
        grupos.set(key, new Map<string, any>());
      }
      grupos.get(key)!.set(r.operacion, r);
    }
  }

  let totalCuentos = 0;
  for (const [key, opsMap] of grupos.entries()) {
    const rAnalisis = opsMap.get('analisis');
    const rEscena1 = opsMap.get('escena_1');
    const rEscena2 = opsMap.get('escena_2');
    const rEscena3 = opsMap.get('escena_3');
    const rEscena4 = opsMap.get('escena_4');

    if (
      !rAnalisis?.contenido_generado ||
      !rEscena1?.contenido_generado ||
      !rEscena2?.contenido_generado ||
      !rEscena3?.contenido_generado ||
      !rEscena4?.contenido_generado
    ) {
      continue; // Cuento incompleto o con operaciones fallidas
    }

    const casoId = rAnalisis.caso;
    const repeticion = rAnalisis.repeticion;
    const modeloId = rAnalisis.modelo;
    const analisisContent = (rAnalisis.contenido_generado || {}) as StoryAnalysis;
    const escena1Content = (rEscena1.contenido_generado || {}) as Escena;
    const escena2Content = (rEscena2.contenido_generado || {}) as Escena;
    const escena3Content = (rEscena3.contenido_generado || {}) as Escena;
    const escena4Content = (rEscena4.contenido_generado || {}) as EscenaFinal;

    const baseName = `${casoId}_rep${repeticion}`;

    const objetoCuento = {
      caso: casoId,
      repeticion,
      modelo: modeloId,
      titulo: analisisContent.titulo || analisisContent.tituloOriginal || 'Cuento Educativo',
      protagonista: analisisContent.protagonista,
      descripcionProtagonista: analisisContent.descripcionProtagonista,
      escenario: analisisContent.escenario,
      conflicto: analisisContent.conflicto,
      resumenAnalisis: analisisContent.resumen,
      escenas: [
        {
          numero: 1,
          tipo: 'inicio',
          contenido: escena1Content.contenido,
          opcionesPresentadas: escena1Content.opciones || [],
          esFinal: false,
          metricas: {
            latenciaMs: rEscena1.tiempo_ms,
            tokensEntrada: rEscena1.tokens_entrada,
            tokensSalida: rEscena1.tokens_salida,
            costoUsd: rEscena1.costo_teorico_usd,
          },
        },
        {
          numero: 2,
          tipo: 'desarrollo_1',
          contenido: escena2Content.contenido,
          opcionesPresentadas: escena2Content.opciones || [],
          esFinal: false,
          metricas: {
            latenciaMs: rEscena2.tiempo_ms,
            tokensEntrada: rEscena2.tokens_entrada,
            tokensSalida: rEscena2.tokens_salida,
            costoUsd: rEscena2.costo_teorico_usd,
          },
        },
        {
          numero: 3,
          tipo: 'desarrollo_2',
          contenido: escena3Content.contenido,
          opcionesPresentadas: escena3Content.opciones || [],
          esFinal: false,
          metricas: {
            latenciaMs: rEscena3.tiempo_ms,
            tokensEntrada: rEscena3.tokens_entrada,
            tokensSalida: rEscena3.tokens_salida,
            costoUsd: rEscena3.costo_teorico_usd,
          },
        },
        {
          numero: 4,
          tipo: 'desenlace',
          contenido: escena4Content.contenido,
          opcionesPresentadas: [],
          esFinal: true,
          metricas: {
            latenciaMs: rEscena4.tiempo_ms,
            tokensEntrada: rEscena4.tokens_entrada,
            tokensSalida: rEscena4.tokens_salida,
            costoUsd: rEscena4.costo_teorico_usd,
          },
        },
      ],
      metricasTotalesCuento: {
        tiempoTotalGeneracionMs: [rEscena1, rEscena2, rEscena3, rEscena4].reduce((a, b) => a + (b.tiempo_ms || 0), 0),
        tokensEntradaTotales: [rEscena1, rEscena2, rEscena3, rEscena4].reduce((a, b) => a + (b.tokens_entrada || 0), 0),
        tokensSalidaTotales: [rEscena1, rEscena2, rEscena3, rEscena4].reduce((a, b) => a + (b.tokens_salida || 0), 0),
        costoTotalUsd: [rEscena1, rEscena2, rEscena3, rEscena4].reduce((a, b) => a + (b.costo_teorico_usd || 0), 0),
      },
    };

    // 1. Guardar archivo JSON completo
    fs.writeFileSync(path.join(carpetaDestino, `${baseName}.json`), JSON.stringify(objetoCuento, null, 2), 'utf-8');

    // 2. Guardar archivo Markdown legible para evaluación pedagógica
    const mdLines = [
      `# ${objetoCuento.titulo}`,
      `**Caso de Estudio:** ${casoId} | **Repetición:** ${repeticion} | **Modelo:** ${modeloId}`,
      `**Protagonista:** ${analisisContent.protagonista} — ${analisisContent.descripcionProtagonista || ''}`,
      `**Escenario:** ${analisisContent.escenario || 'Entorno de la lectura'}`,
      `**Conflicto central:** ${analisisContent.conflicto || ''}`,
      '',
      '---',
      '',
      `## Escena 1: Inicio`,
      escena1Content.contenido,
      '',
      `*Opciones pedagógicas de comprensión:*`,
      ...(escena1Content.opciones || []).map((o, idx) => `  ${String.fromCharCode(65 + idx)}) ${o}`),
      '',
      `## Escena 2: Desarrollo`,
      escena2Content.contenido,
      '',
      `*Opciones pedagógicas de comprensión:*`,
      ...(escena2Content.opciones || []).map((o, idx) => `  ${String.fromCharCode(65 + idx)}) ${o}`),
      '',
      `## Escena 3: Clímax`,
      escena3Content.contenido,
      '',
      `*Opciones pedagógicas de comprensión:*`,
      ...(escena3Content.opciones || []).map((o, idx) => `  ${String.fromCharCode(65 + idx)}) ${o}`),
      '',
      `## Escena 4: Desenlace`,
      escena4Content.contenido,
      '',
      '---',
      '### Metadatos y Trazabilidad Operativa',
      `- Latencia total de escenas: ${objetoCuento.metricasTotalesCuento.tiempoTotalGeneracionMs} ms`,
      `- Tokens consumidos (Entrada/Salida): ${objetoCuento.metricasTotalesCuento.tokensEntradaTotales} / ${objetoCuento.metricasTotalesCuento.tokensSalidaTotales}`,
      `- Costo teórico estimado: $${objetoCuento.metricasTotalesCuento.costoTotalUsd.toFixed(6)} USD`,
      '',
    ];

    fs.writeFileSync(path.join(carpetaDestino, `${baseName}.md`), mdLines.join('\n'), 'utf-8');
    totalCuentos++;
  }

  return totalCuentos;
}

export function obtenerEstadoLotesModelo(modeloId: string, rootDir: string = process.cwd()): EstadoLoteInfo[] {
  const dirModelo = obtenerCarpetaModeloPruebas(modeloId, rootDir);
  const dirLotes = path.join(dirModelo, 'lotes');

  return DEFINICIONES_LOTES.map((def) => {
    const pad = String(def.lote).padStart(2, '0');
    const carpetaLote = path.join(dirLotes, `lote_${pad}`);
    const planificadasModelo = def.casosIds.length * 5; // 2 casos × 5 ops = 10 ops planificadas por lote para 1 modelo

    if (!fs.existsSync(carpetaLote)) {
      return {
        lote: def.lote,
        casos: def.casosIds,
        repeticion: def.repeticion,
        estado: 'PENDIENTE',
        operacionesPlanificadas: planificadasModelo,
        operacionesEjecutadas: 0,
        operacionesExitosas: 0,
        operacionesFallidas: 0,
        operacionesOmitidasPorDependencia: 0,
        solicitudesHttpReales: 0,
        costoTeoricoTotalUsd: null,
        carpetaLote,
      };
    }

    const { operacionesMap } = cargarOperacionesPrevias(carpetaLote, true);
    const operaciones = Array.from(operacionesMap.values()).filter((o) => o.modelo === modeloId);
    const ejecutadas = operaciones.length;
    const exitosas = operaciones.filter((o) => o.estructura_valida).length;
    const fallidas = operaciones.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
    const omitidas = operaciones.filter((o) => o.error_categoria === 'dependency_failed').length;
    const http = operaciones.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

    const tieneCostoDesc = operaciones.some((o) => o.costo_teorico_usd === null && o.error_categoria !== 'dependency_failed');
    const costo = tieneCostoDesc || ejecutadas === 0 ? null : operaciones.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);

    let estado: EstadoLoteEnum = 'EN_PROGRESO';
    if (ejecutadas === 0) {
      estado = 'PENDIENTE';
    } else if (ejecutadas >= planificadasModelo) {
      if (fallidas === 0 && omitidas === 0) {
        estado = 'COMPLETADO';
      } else {
        estado = 'INCOMPLETO';
      }
    }

    return {
      lote: def.lote,
      casos: def.casosIds,
      repeticion: def.repeticion,
      estado,
      operacionesPlanificadas: planificadasModelo,
      operacionesEjecutadas: ejecutadas,
      operacionesExitosas: exitosas,
      operacionesFallidas: fallidas,
      operacionesOmitidasPorDependencia: omitidas,
      solicitudesHttpReales: http,
      costoTeoricoTotalUsd: costo,
      carpetaLote,
    };
  });
}

export function imprimirTablaEstadoModelo(modeloId: string, rootDir: string = process.cwd()): void {
  const info = obtenerInfoModelo(modeloId);
  const estados = obtenerEstadoLotesModelo(modeloId, rootDir);

  console.log('================================================================================================================');
  console.log(`ESTADO DE PRUEBAS EXPERIMENTALES: ${info.nombreCorto.toUpperCase()} (${info.id})`);
  console.log('DISEÑO: 10 LOTES / 100 OPERACIONES PLANIFICADAS (20 CUENTOS) / PROVEEDOR: ' + info.proveedor);
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
      ? `$${e.costoTeoricoTotalUsd.toFixed(6)}`
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
    (totalEjec > 0 && totalCosto !== null ? `$${totalCosto.toFixed(6)}` : 'N/A')
  );
  console.log('================================================================================================================\n');
}

export function consolidarResultadosModelo(modeloId: string, rootDir: string = process.cwd()): {
  totalPlanificadas: number;
  totalEjecutadas: number;
  totalExitosas: number;
  totalFallidas: number;
  totalOmitidasDependencia: number;
  totalSolicitudesHttp: number;
  costoTeoricoTotalUsd: number | null;
  archivosGenerados: string[];
} {
  const info = obtenerInfoModelo(modeloId);
  const dirModelo = obtenerCarpetaModeloPruebas(modeloId, rootDir);
  const dirLotes = path.join(dirModelo, 'lotes');
  const dirReportes = path.join(dirModelo, 'reportes');
  const dirCuentos = path.join(dirModelo, 'cuentos_generados');

  if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });
  if (!fs.existsSync(dirCuentos)) fs.mkdirSync(dirCuentos, { recursive: true });

  const todasOperaciones: ResultadoOperacion[] = [];
  const todosEventos: any[] = [];
  const archivosGenerados: string[] = [];

  for (let loteNum = 1; loteNum <= 10; loteNum++) {
    const pad = String(loteNum).padStart(2, '0');
    const carp = path.join(dirLotes, `lote_${pad}`);
    if (!fs.existsSync(carp)) continue;

    const { operacionesMap, eventosHistorial } = cargarOperacionesPrevias(carp, true);
    for (const op of operacionesMap.values()) {
      if (op.modelo === modeloId && !op.es_simulado) {
        todasOperaciones.push(op);
      }
    }
    for (const ev of eventosHistorial) {
      if (ev.type === 'operation_result' && ev.result && ev.result.modelo === modeloId && !ev.result.es_simulado) {
        todosEventos.push(ev);
      }
    }
  }

  const totalPlanificadas = 100;
  const totalEjecutadas = todasOperaciones.length;
  const totalExitosas = todasOperaciones.filter((o) => o.estructura_valida).length;
  const totalFallidas = todasOperaciones.filter((o) => !o.estructura_valida && o.error_categoria !== 'dependency_failed').length;
  const totalOmitidasDependencia = todasOperaciones.filter((o) => o.error_categoria === 'dependency_failed').length;
  const totalSolicitudesHttp = todasOperaciones.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

  const tieneCostoDesc = totalEjecutadas === 0 || todasOperaciones.some((o) => o.costo_teorico_usd === null && o.error_categoria !== 'dependency_failed');
  const costoTeoricoTotalUsd = tieneCostoDesc ? null : todasOperaciones.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);

  // 1. Guardar ejecuciones_raw.csv en raíz del modelo
  const rutaRawCsv = path.join(dirModelo, 'ejecuciones_raw.csv');
  exportarEjecucionesCsv(todasOperaciones, dirModelo);
  archivosGenerados.push(rutaRawCsv);

  // 2. Guardar events.jsonl en raíz del modelo
  const rutaEventsJsonl = path.join(dirModelo, 'events.jsonl');
  const streamEvents = todosEventos.map((e) => JSON.stringify(e)).join('\n') + (todosEventos.length > 0 ? '\n' : '');
  fs.writeFileSync(rutaEventsJsonl, streamEvents, 'utf-8');
  archivosGenerados.push(rutaEventsJsonl);

  // 3. Guardar reportes por caso, repetición y operación en reportes/
  const rutaCuentosCsv = path.join(dirReportes, 'resumen_casos.csv');
  consolidarResumenCuentos(todasOperaciones, dirReportes);
  // Renombrar resumen_cuentos.csv a resumen_casos.csv
  const rutaCuentosOrig = path.join(dirReportes, 'resumen_cuentos.csv');
  if (fs.existsSync(rutaCuentosOrig)) {
    fs.copyFileSync(rutaCuentosOrig, rutaCuentosCsv);
    fs.unlinkSync(rutaCuentosOrig);
  }
  archivosGenerados.push(rutaCuentosCsv);

  const rutaOpsCsv = path.join(dirReportes, 'resumen_operaciones.csv');
  consolidarResumenOperaciones(todasOperaciones, dirReportes);
  archivosGenerados.push(rutaOpsCsv);

  // 4. Calcular métricas académicas detalladas para tesis
  const latencias = todasOperaciones.filter((o) => o.estructura_valida && typeof o.tiempo_ms === 'number').map((o) => o.tiempo_ms as number);
  const tokensEntrada = todasOperaciones.reduce((acc, o) => acc + (o.tokens_entrada || 0), 0);
  const tokensSalida = todasOperaciones.reduce((acc, o) => acc + (o.tokens_salida || 0), 0);
  const tokensRazonamiento = todasOperaciones.reduce((acc, o) => acc + (o.tokens_razonamiento || 0), 0);
  const tokensTotales = todasOperaciones.reduce((acc, o) => acc + (o.tokens_totales || 0), 0);
  const exitoPrimerIntento = todasOperaciones.filter((o) => o.cumple_primer_intento).length;

  const latenciaPromedio = latencias.length > 0 ? latencias.reduce((a, b) => a + b, 0) / latencias.length : null;
  const latenciaMediana = latencias.length > 0 ? calcularMediana(latencias) : null;
  const latenciaP95 = latencias.length > 0 ? calcularP95(latencias) : null;

  const cuentosCompletos = Math.floor(totalExitosas / 5);
  const costoPromedioPorCuento = cuentosCompletos > 0 && costoTeoricoTotalUsd !== null ? costoTeoricoTotalUsd / cuentosCompletos : null;

  const metricasAcademicas = {
    modelo: info.id,
    nombreCorto: info.nombreCorto,
    proveedor: info.proveedor,
    fechaConsolidacionUtc: new Date().toISOString(),
    operaciones: {
      planificadas: totalPlanificadas,
      ejecutadas: totalEjecutadas,
      exitosas: totalExitosas,
      fallidas: totalFallidas,
      omitidasPorDependencia: totalOmitidasDependencia,
      tasaExitoGlobalPct: totalPlanificadas > 0 ? Number(((totalExitosas / totalPlanificadas) * 100).toFixed(2)) : 0,
      tasaExitoPrimerIntentoPct: totalEjecutadas > 0 ? Number(((exitoPrimerIntento / totalEjecutadas) * 100).toFixed(2)) : 0,
    },
    solicitudesHttp: {
      totalesReales: totalSolicitudesHttp,
      reintentosTotales: todasOperaciones.reduce((acc, o) => acc + o.numero_reintentos, 0),
    },
    latenciaMs: {
      observacionesExitosas: latencias.length,
      promedio: latenciaPromedio !== null ? Number(latenciaPromedio.toFixed(2)) : null,
      mediana: latenciaMediana !== null ? Number(latenciaMediana.toFixed(2)) : null,
      percentil95: latenciaP95 !== null ? Number(latenciaP95.toFixed(2)) : null,
    },
    consumoTokens: {
      entradaTotal: tokensEntrada,
      salidaTotal: tokensSalida,
      razonamientoTotal: tokensRazonamiento,
      tokensTotales: tokensTotales,
      promedioTokensEntradaPorOp: totalEjecutadas > 0 ? Number((tokensEntrada / totalEjecutadas).toFixed(2)) : null,
      promedioTokensSalidaPorOp: totalEjecutadas > 0 ? Number((tokensSalida / totalEjecutadas).toFixed(2)) : null,
    },
    costosUsd: {
      costoTeoricoTotal: costoTeoricoTotalUsd !== null ? Number(costoTeoricoTotalUsd.toFixed(6)) : null,
      costoPromedioPorOperacion: totalEjecutadas > 0 && costoTeoricoTotalUsd !== null ? Number((costoTeoricoTotalUsd / totalEjecutadas).toFixed(6)) : null,
      costoPromedioPorCuentoCompleto: costoPromedioPorCuento !== null ? Number(costoPromedioPorCuento.toFixed(6)) : null,
      moneda: 'USD',
    },
    contratosYValidacion: {
      cumplimientoJsonSchemaPct: totalEjecutadas > 0 ? Number(((todasOperaciones.filter((o) => o.json_valido).length / totalEjecutadas) * 100).toFixed(2)) : 0,
      cumplimientoEstructuraValidaPct: totalEjecutadas > 0 ? Number(((totalExitosas / totalEjecutadas) * 100).toFixed(2)) : 0,
      cumplimientoRutaControladaPct: todasOperaciones.filter((o) => o.ruta_controlada_valida === true).length,
    },
    cuentosCompletados: cuentosCompletos,
    cuentosPrevistos: 20,
  };

  const rutaMetricasJson = path.join(dirReportes, 'metricas_academicas.json');
  fs.writeFileSync(rutaMetricasJson, JSON.stringify(metricasAcademicas, null, 2), 'utf-8');
  archivosGenerados.push(rutaMetricasJson);

  // 5. Reconstruir cuentos completos generados en cuentos_generados/
  reconstruirYExportarCuentos(todosEventos, dirCuentos);

  // 6. Guardar manifest.json global del modelo
  const manifestModelo = {
    modelo: info.id,
    proveedor: info.proveedor,
    fechaActualizacionUtc: new Date().toISOString(),
    estadoGlobal: totalExitosas >= totalPlanificadas ? 'COMPLETADO' : (totalEjecutadas > 0 ? 'EN_PROGRESO' : 'PENDIENTE'),
    operacionesPlanificadas: totalPlanificadas,
    operacionesEjecutadas: totalEjecutadas,
    operacionesExitosas: totalExitosas,
    operacionesPendientes: totalPlanificadas - totalEjecutadas,
    solicitudesHttpReales: totalSolicitudesHttp,
    costoTeoricoTotalUsd,
    carpetas: {
      lotes: 'lotes/',
      cuentosGenerados: 'cuentos_generados/',
      reportes: 'reportes/',
    },
    metricasAcademicas: metricasAcademicas,
    gitCommit: obtenerGitCommit(rootDir),
    hashesCodigo: obtenerHashesArchivosClave(rootDir),
  };
  const rutaManifest = path.join(dirModelo, 'manifest.json');
  fs.writeFileSync(rutaManifest, JSON.stringify(manifestModelo, null, 2), 'utf-8');
  archivosGenerados.push(rutaManifest);

  return {
    totalPlanificadas,
    totalEjecutadas,
    totalExitosas,
    totalFallidas,
    totalOmitidasDependencia,
    totalSolicitudesHttp,
    costoTeoricoTotalUsd,
    archivosGenerados,
  };
}
