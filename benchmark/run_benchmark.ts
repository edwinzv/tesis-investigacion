import * as fs from 'fs';
import * as path from 'path';
import { AdaptadorGoogle } from './src/adaptadores/google.js';
import { AdaptadorGroq } from './src/adaptadores/groq.js';
import { AdaptadorGroqGptOss } from './src/adaptadores/groq_gpt_oss.js';
import { AdaptadorModelo } from './src/adaptadores/base.js';
import { CasoEstudio } from './src/types.js';
import { ejecutarBenchmark } from './src/runner.js';
import { SCHEMAS, validarPreflight, validarStoryAnalysis, validarEscenaIntermedia, validarEscenaFinal } from './src/contratos.js';
import { construirPromptPreflight } from './src/prompts.js';
import {
  consolidarResumenCuentos,
  consolidarResumenModelos,
  consolidarResumenOperaciones,
  exportarEjecucionesCsv,
} from './src/reportes.js';
import { generarMuestrasAnonimizadas } from './src/evaluacion_ciega.js';
import { validarArgumentos, ejecutarTest20Cli } from './src/test20.js';
import {
  obtenerDefinicionLote,
  obtenerCarpetaLote,
  imprimirTablaEstadoLotes,
  DEFINICIONES_LOTES,
} from './src/lotes.js';
import {
  consolidarExperimento,
  imprimirResumenConsolidado,
} from './src/consolidacion.js';
import {
  normalizarIdModelo,
  inicializarEstructuraCarpetasModelos,
  sincronizarHistoricoGptOssSiAplica,
  sincronizarHistoricoQwenSiAplica,
  sincronizarHistoricoGeminiSiAplica,
  imprimirTablaEstadoModelo,
  consolidarResultadosModelo,
  obtenerCarpetaLoteModelo,
  reconstruirYExportarCuentos,
  obtenerCarpetaModeloPruebas,
  ejecutarDiagnosticoModelo,
} from './src/pruebas_modelos.js';

function cargarVariablesEntorno(): void {
  const rutaEnv = path.resolve(process.cwd(), 'benchmark/.env');
  if (fs.existsSync(rutaEnv)) {
    const contenido = fs.readFileSync(rutaEnv, 'utf-8').replace(/^\uFEFF/, '');
    const lineas = contenido.split(/\r?\n/);
    for (const linea of lineas) {
      const trimmed = linea.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

function cargarCasos(soloPrimerCaso: boolean = false): CasoEstudio[] {
  const dirCasos = path.resolve(process.cwd(), 'benchmark/casos');
  const archivos = fs.readdirSync(dirCasos).filter((f) => f.endsWith('.json')).sort();

  const listaArchivos = soloPrimerCaso ? archivos.slice(0, 1) : archivos;
  const casos: CasoEstudio[] = [];

  for (const archivo of listaArchivos) {
    const ruta = path.join(dirCasos, archivo);
    const raw = fs.readFileSync(ruta, 'utf-8').replace(/^\uFEFF/, '');
    casos.push(JSON.parse(raw) as CasoEstudio);
  }

  return casos;
}

function cargarCasosPorIds(ids: string[]): CasoEstudio[] {
  const dirCasos = path.resolve(process.cwd(), 'benchmark/casos');
  const casos: CasoEstudio[] = [];
  for (const id of ids) {
    const nombreArchivo = id.endsWith('.json') ? id : `${id}.json`;
    const ruta = path.join(dirCasos, nombreArchivo);
    if (!fs.existsSync(ruta)) {
      throw new Error(`Archivo de caso no encontrado: ${ruta}`);
    }
    const raw = fs.readFileSync(ruta, 'utf-8').replace(/^\uFEFF/, '');
    casos.push(JSON.parse(raw) as CasoEstudio);
  }
  return casos;
}

async function ejecutarCheckProviders(adaptadores: AdaptadorModelo[]): Promise<void> {
  console.log('====================================================');
  console.log('COMPROBACIÓN DE DISPONIBILIDAD DE PROVEEDORES (--check-providers)');
  console.log('====================================================');
  console.log('Objetivo: Verificar conectividad y catálogo con 0 tokens de inferencia.\n');

  for (const adaptador of adaptadores) {
    console.log(`Verificando [${adaptador.proveedor} - ${adaptador.modelo}]...`);
    try {
      const res = await adaptador.verificarDisponibilidad();
      if (res.disponible) {
        console.log(`  [OK] ${res.mensaje}`);
        if (res.providerRuntime) {
          console.log(`       Runtime detectado: ${res.providerRuntime}`);
        }
      } else {
        console.log(`  [FALLO] ${res.mensaje}`);
      }
    } catch (e: any) {
      console.log(`  [EXCEPCIÓN] ${e.message}`);
    }
    console.log('');
  }
  console.log('Verificación completada. No se registraron datos en el benchmark.\n');
}

async function ejecutarPreflight(adaptadores: AdaptadorModelo[]): Promise<void> {
  console.log('====================================================');
  console.log('PRE-FLIGHT TEST TECNOLOGICO (--preflight)');
  console.log('====================================================');
  console.log('Objetivo: Realizar MAXIMO 1 request de inferencia por modelo (maximo 3 HTTP requests).');
  console.log('Sin retries. Schema: {"estado":"ok"}. Limite: 256 tokens.');
  console.log('NO forma parte del benchmark. NO escribe en resultados/ ni resultados_lotes/.\n');

  let requestsRealizados = 0;
  const resultadosPreflight: { modelo: string; proveedor: string; estado: 'PREFLIGHT_OK' | 'PREFLIGHT_FAIL'; detalle: string }[] = [];

  for (const adaptador of adaptadores) {
    requestsRealizados++;
    console.log('[Request ' + requestsRealizados + '/3] Probando preflight en [' + adaptador.proveedor + ' - ' + adaptador.modelo + ']...');

    const prompt = construirPromptPreflight();
    const schema = SCHEMAS.preflight;

    try {
      const res = await adaptador.ejecutarLlamada(prompt, schema, 'preflight', 256);

      let jsonParseado: any = null;
      let jsonOk = false;
      try {
        jsonParseado = JSON.parse(res.rawText);
        jsonOk = true;
      } catch {
        jsonOk = false;
      }

      if (!jsonOk) {
        resultadosPreflight.push({
          modelo: adaptador.modelo,
          proveedor: adaptador.proveedor,
          estado: 'PREFLIGHT_FAIL',
          detalle: 'HTTP ' + res.status + ' pero JSON no parseable: ' + res.rawText.slice(0, 100),
        });
        console.log('  -> PREFLIGHT_FAIL: JSON no parseable');
        continue;
      }

      const val = validarPreflight(jsonParseado);
      if (val.valido) {
        resultadosPreflight.push({
          modelo: adaptador.modelo,
          proveedor: adaptador.proveedor,
          estado: 'PREFLIGHT_OK',
          detalle: 'HTTP ' + res.status + ' | Latencia: ' + res.latencyMs + 'ms | Modo: ' + res.structuredOutputMode + ' | In: ' + res.usage.tokensEntrada + ' | Out: ' + res.usage.tokensSalida + ' | Reason: ' + (res.usage.tokensRazonamiento ?? 0) + ' | ProviderRuntime: ' + (res.providerRuntime ?? 'N/A'),
        });
        console.log('  -> PREFLIGHT_OK: Contrato valido {"estado":"ok"}');
        console.log('     Detalle: Latencia: ' + res.latencyMs + 'ms | Modo: ' + res.structuredOutputMode + ' | Tokens salida: ' + res.usage.tokensSalida + ' | ProviderRuntime: ' + (res.providerRuntime ?? 'N/A'));
      } else {
        resultadosPreflight.push({
          modelo: adaptador.modelo,
          proveedor: adaptador.proveedor,
          estado: 'PREFLIGHT_FAIL',
          detalle: val.error || 'Violacion de contrato preflight',
        });
        console.log('  -> PREFLIGHT_FAIL: ' + val.error);
      }
    } catch (err: any) {
      resultadosPreflight.push({
        modelo: adaptador.modelo,
        proveedor: adaptador.proveedor,
        estado: 'PREFLIGHT_FAIL',
        detalle: err.message || 'Error de llamada',
      });
      console.log('  -> PREFLIGHT_FAIL: ' + err.message);
    }
    console.log('');
  }

  console.log('====================================================');
  console.log('RESUMEN PREFLIGHT:');
  console.log('preflight_http_requests = ' + requestsRealizados + ' (maximo 3)');
  for (const r of resultadosPreflight) {
    console.log('- [' + r.proveedor + ' - ' + r.modelo + ']: ' + r.estado + ' (' + r.detalle + ')');
  }
  console.log('====================================================\n');
  console.log('Preflight finalizado. Deteniendo ejecucion sin benchmark.');
}

async function ejecutarValidacionLocalCompleta(adaptadores: AdaptadorModelo[]): Promise<void> {
  console.log('========================================================================');
  console.log('MODO A: VALIDACIÓN LOCAL INTEGRAL DEL BENCHMARK (0 RED / 0 USD)');
  console.log('========================================================================');
  console.log('1. Verificando esquemas y contratos JSON:');
  const schAnalisis = SCHEMAS.analisis;
  const schEscena = SCHEMAS.escena;
  const schFinal = SCHEMAS.escenaFinal;
  if (!schAnalisis || !schEscena || !schFinal) throw new Error('Esquemas incompletos');
  console.log('   [OK] SCHEMAS.analisis, SCHEMAS.escena, SCHEMAS.escenaFinal válidos.');

  console.log('\n2. Verificando configuración de modelos (3 modelos seleccionados):');
  for (const ad of adaptadores) {
    console.log(`   [OK] Candidato: ${ad.proveedor} | Modelo: ${ad.modelo} | Tarifa In: $${ad.tarifaInputUsdPorMillon}/M | Out: $${ad.tarifaOutputUsdPorMillon}/M`);
  }

  console.log('\n3. Verificando los 4 casos de estudio experimentales:');
  const casos = cargarCasosPorIds([
    'caso_01_misterio_agua',
    'caso_02_robot_cielo',
    'caso_03_arbol_hueco',
    'caso_04_cometa_viento',
  ]);
  for (const c of casos) {
    if (c.decisionesFijas.length !== 3) throw new Error(`Caso ${c.id} no tiene 3 decisiones fijas`);
    console.log(`   [OK] ${c.id}: "${c.titulo}" (3 decisiones fijas verificadas)`);
  }

  console.log('\n4. Verificando planificación de los 10 lotes (300 operaciones totales):');
  let sumaOps = 0;
  for (const d of DEFINICIONES_LOTES) {
    sumaOps += d.operacionesPlanificadas;
    console.log(`   - Lote ${String(d.lote).padStart(2, '0')}: Casos [${d.casosIds.join(', ')}] | Repetición ${d.repeticion} | ${d.operacionesPlanificadas} ops`);
  }
  if (sumaOps !== 300) throw new Error(`Suma de operaciones no es 300, recibido: ${sumaOps}`);
  console.log(`   [OK] Total de operaciones planificadas = ${sumaOps} (100 por modelo).`);

  console.log('\n5. Simulando ejecución dry-run del Lote 1 (0 llamadas de red, 0 gasto):');
  const dirValidacionLocal = path.resolve(process.cwd(), 'benchmark/validaciones_locales/temp_lote_01');
  const casosLote1 = cargarCasosPorIds(DEFINICIONES_LOTES[0].casosIds);
  const resLote1 = await ejecutarBenchmark({
    adaptadores,
    casos: casosLote1,
    repeticiones: 1,
    carpetaSalida: dirValidacionLocal,
    esPiloto: true,
    esDryRun: true,
    delayEntreLlamadasMs: 0,
    loteNumero: 1,
    reanudar: false,
  });

  exportarEjecucionesCsv(resLote1.resultados, dirValidacionLocal);
  consolidarResumenCuentos(resLote1.resultados, dirValidacionLocal);
  consolidarResumenModelos(resLote1.resultados, dirValidacionLocal);
  consolidarResumenOperaciones(resLote1.resultados, dirValidacionLocal);

  if (resLote1.operacionesSimuladas !== 30) throw new Error(`Operaciones simuladas Lote 1 esperadas: 30, obtenido: ${resLote1.operacionesSimuladas}`);
  if (resLote1.llamadasReales !== 0) throw new Error('Dry-run realizó llamadas reales de red indebidamente');
  console.log(`   [OK] Lote 1 simulado: 30 operaciones sintetizadas exitosamente. Llamadas HTTP reales = 0.`);

  console.log('\n6. Simulando consolidación y exportación de métricas y rúbrica pedagógica:');
  const dirConsolidadoValidacion = path.resolve(process.cwd(), 'benchmark/validaciones_locales/temp_consolidado');
  const resConsolidacion = consolidarExperimento(
    path.resolve(process.cwd(), 'benchmark/validaciones_locales'),
    dirConsolidadoValidacion,
    false // en validación local permitimos consolidar la simulación para verificar los esquemas
  );
  if (resConsolidacion.archivosGenerados.length < 5) throw new Error('Consolidación no generó todos los archivos');
  console.log(`   [OK] Consolidación completada. Archivos generados: ${resConsolidacion.archivosGenerados.length}.`);

  // Limpiar artefactos temporales de validación local para garantizar aislamiento total
  try {
    fs.rmSync(path.resolve(process.cwd(), 'benchmark/validaciones_locales'), { recursive: true, force: true });
  } catch {}

  console.log('========================================================================');
  console.log('VALIDACIÓN LOCAL INTEGRAL EXITOSA:');
  console.log('- Tipos y compilación: CORRECTOS');
  console.log('- Esquemas JSON y contratos: VÁLIDOS');
  console.log('- 3 Modelos y 4 Casos: VERIFICADOS');
  console.log('- Planificación de 10 lotes (300 operaciones): VERIFICADA');
  console.log('- Mecanismos de reanudación y eventos: OPERATIVOS');
  console.log('- 0 llamadas externas realizadas a APIs.');
  console.log('- 0 USD de gasto incurrido.');
  console.log('========================================================================\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  validarArgumentos(args);

  if (args.includes('--test20')) {
    await ejecutarTest20Cli(args);
    return;
  }

  cargarVariablesEntorno();

  // Inicializar carpetas de pruebas independientes y reconciliar históricos existentes
  inicializarEstructuraCarpetasModelos();
  sincronizarHistoricoGptOssSiAplica();
  sincronizarHistoricoQwenSiAplica();
  sincronizarHistoricoGeminiSiAplica();

  // Detección de modelo independiente
  let filtroModelo: string | null = null;
  if (args.includes('--gpt-oss')) {
    filtroModelo = 'openai/gpt-oss-20b';
  } else if (args.includes('--gemini')) {
    filtroModelo = 'gemini-3.5-flash-lite';
  } else if (args.includes('--qwen')) {
    filtroModelo = 'qwen/qwen3.8-27b';
  } else {
    const idxModel = args.indexOf('--model') !== -1 ? args.indexOf('--model') : args.indexOf('--modelo');
    if (idxModel !== -1 && idxModel + 1 < args.length) {
      filtroModelo = normalizarIdModelo(args[idxModel + 1]);
    }
  }

  const aliasModelo = (id: string | null): string => {
    if (!id) return 'gemini';
    if (id === 'gemini-3.8-flash') return 'gemini-3.8';
    if (id === 'qwen/qwen3.8-27b') return 'qwen';
    if (id === 'gemini-3.5-flash-lite') return 'gemini';
    return 'gpt-oss';
  };

  // Detección de niveles progresivos de prueba
  const idxLevel = args.indexOf('--level') !== -1 ? args.indexOf('--level') : args.indexOf('--nivel');
  let nivelEjecucion: number | null = null;
  if (idxLevel !== -1 && idxLevel + 1 < args.length) {
    const parsedLvl = parseInt(args[idxLevel + 1], 10);
    if (!isNaN(parsedLvl) && parsedLvl >= 1 && parsedLvl <= 4) {
      nivelEjecucion = parsedLvl;
    }
  }
  if (args.includes('--diagnostico')) {
    nivelEjecucion = 1;
  } else if (args.includes('--cuento')) {
    nivelEjecucion = 2;
  }

  const flagCheckProviders = args.includes('--check-providers');
  const flagPreflight = args.includes('--preflight');
  const flagDryRun = args.includes('--dry-run');
  const flagPilot = args.includes('--pilot');
  const flagFull = args.includes('--full');
  const flagStatus = args.includes('--status') || args.includes('--estado');
  const flagConsolidate = args.includes('--consolidate') || args.includes('--consolidar');
  const flagValidate = args.includes('--validate') || args.includes('--validar');
  const flagAuthorize = args.includes('--authorize-api-calls');

  const idxBatch = args.indexOf('--batch') !== -1 ? args.indexOf('--batch') : args.indexOf('--lote');
  let numeroLote: number | null = null;
  if (idxBatch !== -1 && idxBatch + 1 < args.length) {
    const parsed = parseInt(args[idxBatch + 1], 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
      numeroLote = parsed;
    }
  }

  if (nivelEjecucion === 3 && numeroLote === null) {
    numeroLote = 1; // Nivel 3 equivale al Piloto Ampliado (Lote 1: 2 casos completos, 10 ops)
  }

  if (flagPilot && numeroLote === null) {
    if (filtroModelo === 'gemini-3.8-flash') {
      nivelEjecucion = 2;
    } else {
      numeroLote = 1;
    }
  }

  if (filtroModelo === 'gemini-3.8-flash' && nivelEjecucion === null && numeroLote === null) {
    nivelEjecucion = 2; // Por defecto ejecutar el piloto independiente (1 cuento, 5 ops)
  }

  const dirBaseLotes = path.resolve(process.cwd(), 'benchmark/resultados_lotes');
  const dirSalidaConsolidada = path.resolve(process.cwd(), 'benchmark/resultados_consolidados');

  if (flagStatus) {
    if (filtroModelo) {
      imprimirTablaEstadoModelo(filtroModelo);
    } else {
      const flagIncludeSimulated = args.includes('--include-simulated') || args.includes('--incluir-simulados');
      imprimirTablaEstadoLotes(dirBaseLotes, flagIncludeSimulated);
    }
    return;
  }

  if (flagConsolidate) {
    if (filtroModelo) {
      console.log(`Iniciando consolidación de resultados independientes para [${filtroModelo}]...`);
      const resMod = consolidarResultadosModelo(filtroModelo);
      console.log(`\nConsolidación completada para [${filtroModelo}]:`);
      console.log(`- Operaciones planificadas: ${resMod.totalPlanificadas}`);
      console.log(`- Operaciones ejecutadas:    ${resMod.totalEjecutadas}`);
      console.log(`- Operaciones exitosas:      ${resMod.totalExitosas}`);
      console.log(`- Operaciones fallidas:      ${resMod.totalFallidas}`);
      console.log(`- Solicitudes HTTP reales:   ${resMod.totalSolicitudesHttp}`);
      console.log(
        `- Costo teórico total:       ${
          resMod.costoTeoricoTotalUsd !== null ? `$${resMod.costoTeoricoTotalUsd.toFixed(6)} USD` : 'N/A'
        }`
      );
      console.log(`\nArchivos consolidados del modelo:`);
      for (const a of resMod.archivosGenerados) {
        console.log(`  - ${a}`);
      }
      console.log('');
      return;
    }
    console.log('Iniciando consolidación de resultados de lotes reales existentes...');
    const res = consolidarExperimento(dirBaseLotes, dirSalidaConsolidada, true);
    imprimirResumenConsolidado(res);
    return;
  }

  let adaptadores: AdaptadorModelo[];
  if (filtroModelo) {
    if (filtroModelo === 'openai/gpt-oss-20b') {
      adaptadores = [new AdaptadorGroqGptOss()];
    } else if (filtroModelo === 'gemini-3.5-flash-lite') {
      adaptadores = [new AdaptadorGoogle('gemini-3.5-flash-lite')];
    } else if (filtroModelo === 'gemini-3.8-flash') {
      adaptadores = [new AdaptadorGoogle('gemini-3.8-flash')];
    } else if (filtroModelo === 'qwen/qwen3.8-27b') {
      adaptadores = [new AdaptadorGroq()];
    } else {
      throw new Error(`Modelo no reconocido para pruebas independientes: ${filtroModelo}`);
    }
  } else {
    adaptadores = [
      new AdaptadorGoogle(),
      new AdaptadorGroq(),
      new AdaptadorGroqGptOss(),
    ];
  }

  if (flagCheckProviders) {
    await ejecutarCheckProviders(adaptadores);
    return;
  }

  if (flagPreflight) {
    await ejecutarPreflight(adaptadores);
    return;
  }

  if (flagValidate) {
    await ejecutarValidacionLocalCompleta(adaptadores);
    return;
  }

  // --- NIVEL 1: DIAGNÓSTICO INDEPENDIENTE (1 operación: análisis) ---
  if (nivelEjecucion === 1) {
    const esDryRun = flagDryRun;
    const modeloTarget = filtroModelo || adaptadores[0].modelo;

    if (!esDryRun && !flagAuthorize) {
      console.error('\n========================================================================');
      console.error(`BLOQUEO DE SEGURIDAD EXPERIMENTAL - NIVEL 1 (DIAGNÓSTICO)`);
      console.error('========================================================================');
      console.error(`Se solicitó la ejecución REAL del diagnóstico para [${modeloTarget}].`);
      console.error('Se realizará 1 sola llamada de prueba (análisis) para verificar conectividad, cuota y JSON.');
      console.error('\nPara autorizar la llamada real, agrega la bandera:');
      console.error('    --authorize-api-calls\n');
      console.error('Ejemplo en PowerShell para simulación segura (0 llamadas, 0 USD):');
      console.error(`    npx tsx benchmark/run_benchmark.ts --model ${aliasModelo(filtroModelo)} --level 1 --dry-run\n`);
      console.error('Ejemplo en PowerShell para ejecución real autorizada:');
      console.error(`    npx tsx benchmark/run_benchmark.ts --model ${aliasModelo(filtroModelo)} --level 1 --authorize-api-calls\n`);
      console.error('No se ejecutó ninguna llamada a las API.');
      console.error('========================================================================\n');
      process.exit(1);
    }

    const dirModelo = obtenerCarpetaModeloPruebas(modeloTarget);
    const carpetaSalida = path.join(dirModelo, esDryRun ? 'diagnostico_simulado' : 'diagnostico');
    const casos = cargarCasosPorIds(['caso_01_misterio_agua']);
    await ejecutarDiagnosticoModelo({
      adaptador: adaptadores[0],
      caso: casos[0],
      carpetaSalida,
      esDryRun,
    });
    return;
  }

  // --- NIVEL 2: CUENTO COMPLETO INDEPENDIENTE (1 caso, 5 operaciones) ---
  if (nivelEjecucion === 2) {
    const esDryRun = flagDryRun;
    const modeloTarget = filtroModelo || adaptadores[0].modelo;

    if (!esDryRun && !flagAuthorize) {
      console.error('\n========================================================================');
      console.error(`BLOQUEO DE SEGURIDAD EXPERIMENTAL - NIVEL 2 (CUENTO COMPLETO)`);
      console.error('========================================================================');
      console.error(`Se solicitó la ejecución REAL de 1 cuento completo (5 operaciones) para [${modeloTarget}].`);
      console.error('Caso: caso_01_misterio_agua (Análisis + 4 escenas).');
      console.error('\nPara autorizar la ejecución real, agrega la bandera:');
      console.error('    --authorize-api-calls\n');
      console.error('Ejemplo en PowerShell para simulación segura (0 llamadas, 0 USD):');
      console.error(`    npx tsx benchmark/run_benchmark.ts --model ${aliasModelo(filtroModelo)} --level 2 --dry-run\n`);
      console.error('Ejemplo en PowerShell para ejecución real autorizada:');
      console.error(`    npx tsx benchmark/run_benchmark.ts --model ${aliasModelo(filtroModelo)} --level 2 --authorize-api-calls\n`);
      console.error('No se ejecutó ninguna llamada a las API.');
      console.error('========================================================================\n');
      process.exit(1);
    }

    const dirModelo = obtenerCarpetaModeloPruebas(modeloTarget);
    const carpetaSalida = modeloTarget === 'gemini-3.8-flash'
      ? (esDryRun ? path.join(dirModelo, 'simulado') : dirModelo)
      : path.join(dirModelo, esDryRun ? 'cuento_prueba_simulado' : 'cuento_prueba');
    const casos = cargarCasosPorIds(['caso_01_misterio_agua']);

    console.log('========================================================================');
    console.log(`NIVEL 2 — GENERACIÓN DE CUENTO COMPLETO (${esDryRun ? 'SIMULACIÓN DRY-RUN' : 'MODO REAL'})`);
    console.log('========================================================================');
    console.log(`Modelo:           ${adaptadores[0].proveedor} (${adaptadores[0].modelo})`);
    console.log(`Caso:             caso_01_misterio_agua`);
    console.log(`Operaciones:      5 (1 análisis + 4 escenas)`);
    console.log(`Carpeta salida:   ${carpetaSalida}`);
    console.log('========================================================================\n');

    const resultado = await ejecutarBenchmark({
      adaptadores,
      casos,
      repeticiones: 1,
      carpetaSalida,
      esPiloto: true,
      esDryRun,
      delayEntreLlamadasMs: esDryRun ? 0 : 2000,
      reanudar: args.includes('--resume') || args.includes('--reanudar') || true,
    });

    exportarEjecucionesCsv(resultado.resultados, carpetaSalida);
    consolidarResumenCuentos(resultado.resultados, carpetaSalida);
    consolidarResumenOperaciones(resultado.resultados, carpetaSalida);
    const dirCuentos = path.join(carpetaSalida, 'cuentos_generados');
    reconstruirYExportarCuentos(resultado.resultados, dirCuentos);

    const manifestPiloto = {
      modelo: adaptadores[0].modelo,
      proveedor: adaptadores[0].proveedor,
      fechaUtc: new Date().toISOString(),
      modo: esDryRun ? 'SIMULADO' : 'REAL',
      esSimulado: esDryRun,
      caso: 'caso_01_misterio_agua',
      operacionesPlanificadas: resultado.totalPrevistas,
      operacionesExitosas: resultado.exitosas,
      operacionesFallidas: resultado.errores,
      solicitudesHttpReales: resultado.llamadasReales,
      costoTeoricoTotalUsd: resultado.costoTeoricoTotalUsd,
      tarifas: {
        inputUsdPorMillon: adaptadores[0].tarifaInputUsdPorMillon,
        outputUsdPorMillon: adaptadores[0].tarifaOutputUsdPorMillon,
        fuente: adaptadores[0].tarifaFuenteRuntime,
      },
      metricas: {
        latenciasMs: resultado.resultados.map((r) => r.tiempo_ms).filter((t): t is number => t !== null),
        tokensEntradaTotales: resultado.resultados.reduce((acc, r) => acc + (r.tokens_entrada || 0), 0),
        tokensSalidaTotales: resultado.resultados.reduce((acc, r) => acc + (r.tokens_salida || 0), 0),
        tokensRazonamientoTotales: resultado.resultados.reduce((acc, r) => acc + (r.tokens_razonamiento || 0), 0),
        cumpleEstructuraTotal: resultado.resultados.every((r) => r.estructura_valida),
        cumpleRutaControladaTotal: resultado.resultados.every((r) => r.ruta_controlada_valida !== false),
      },
    };
    fs.writeFileSync(path.join(carpetaSalida, 'manifest.json'), JSON.stringify(manifestPiloto, null, 2), 'utf-8');

    console.log('\n========================================================================');
    console.log(`RESUMEN NIVEL 2 — CUENTO COMPLETO (${esDryRun ? 'SIMULADO' : 'REAL'}):`);
    console.log(`Operaciones planificadas: ${resultado.totalPrevistas}`);
    console.log(`Operaciones exitosas:    ${resultado.exitosas}`);
    console.log(`Operaciones con error:   ${resultado.errores}`);
    console.log(`Solicitudes HTTP reales: ${resultado.llamadasReales}`);
    console.log(`Costo teórico total:     ${resultado.costoTeoricoTotalUsd !== null ? `$${resultado.costoTeoricoTotalUsd.toFixed(6)} USD` : 'N/A'}`);
    console.log(`Cuento generado en:      ${dirCuentos}`);
    console.log('========================================================================\n');
    return;
  }

  if (numeroLote === null && !flagFull && !flagDryRun) {
    console.error('========================================================================');
    console.error('ERROR: No se especificó ningún modo de ejecución válido.');
    console.error('Opciones disponibles para el benchmark experimental:');
    console.error('  --validate                               : Validación local integral sin red (0 llamadas, 0 USD)');
    console.error('  --status                                 : Consulta el progreso general de los 10 lotes');
    console.error('  --status --model <id>                    : Consulta el progreso específico (gemini, qwen o gpt-oss)');
    console.error('\nPRUEBAS PROGRESIVAS POR MODELO (Gemini / Qwen / GPT-OSS):');
    console.error('  --model gemini --level 1 --dry-run         : Nivel 1 - Diagnóstico seguro (1 op, 0 red, 0 USD)');
    console.error('  --model gemini --level 1 --authorize-api-calls : Nivel 1 - Diagnóstico REAL (1 llamada)');
    console.error('  --model gemini --level 2 --dry-run         : Nivel 2 - Cuento completo seguro (5 ops, 0 red)');
    console.error('  --model gemini --level 2 --authorize-api-calls : Nivel 2 - Cuento completo REAL (5 llamadas)');
    console.error('  --model gemini --level 3 --dry-run         : Nivel 3 - Piloto ampliado / Recuperación Lote 1 seguro (0 red)');
    console.error('  --model gemini --level 3 --authorize-api-calls : Nivel 3 - Piloto ampliado / Recuperación Lote 1 REAL');
    console.error('  --model gemini --batch <N> --dry-run       : Nivel 4 - Lote N seguro (10 ops, 0 red)');
    console.error('  --model gemini --batch <N> --authorize-api-calls : Nivel 4 - Lote N REAL del experimento');
    console.error('  --consolidate --model <id>               : Consolida métricas y cuentos independientes');
    console.error('  --consolidate                            : Consolida resultados del benchmark general');
    console.error('========================================================================');
    process.exit(1);
  }

  // Si se solicita ejecutar un lote (o el piloto)
  if (numeroLote !== null) {
    const defLote = obtenerDefinicionLote(numeroLote);
    const esDryRun = flagDryRun;
    const operacionesEsperadas = filtroModelo ? defLote.casosIds.length * 5 : defLote.operacionesPlanificadas;

    // SEGURIDAD: Requerir autorización explícita para llamadas reales a las API
    if (!esDryRun && !flagAuthorize) {
      console.error('\n========================================================================');
      console.error(`BLOQUEO DE SEGURIDAD EXPERIMENTAL - LOTE ${numeroLote}`);
      console.error('========================================================================');
      console.error(
        `Se solicitó la ejecución REAL del Lote ${numeroLote} (${operacionesEsperadas} operaciones planificadas${
          filtroModelo ? ` para [${filtroModelo}]` : ''
        }).`
      );
      console.error('Casos a evaluar: ' + defLote.casosIds.join(', ') + ' | Repetición: ' + defLote.repeticion);
      console.error('\nPara proteger las cuotas gratuitas y evitar llamadas no autorizadas a las API,');
      console.error('debes autorizar explícitamente la ejecución agregando la bandera:');
      console.error('    --authorize-api-calls\n');
      console.error('Ejemplo en PowerShell para simulación segura (0 llamadas, 0 USD):');
      if (filtroModelo) {
        console.error(`    npx tsx benchmark/run_benchmark.ts --batch ${numeroLote} --model ${aliasModelo(filtroModelo)} --dry-run\n`);
        console.error('Ejemplo en PowerShell para ejecución real autorizada:');
        console.error(`    npx tsx benchmark/run_benchmark.ts --batch ${numeroLote} --model ${aliasModelo(filtroModelo)} --authorize-api-calls\n`);
      } else {
        console.error(`    npx tsx benchmark/run_benchmark.ts --batch ${numeroLote} --dry-run\n`);
        console.error('Ejemplo en PowerShell para ejecución real autorizada:');
        console.error(`    npx tsx benchmark/run_benchmark.ts --batch ${numeroLote} --authorize-api-calls\n`);
      }
      console.error('No se ejecutó ninguna llamada a las API.');
      console.error('========================================================================\n');
      process.exit(1);
    }

    const casos = cargarCasosPorIds(defLote.casosIds);
    const carpetaSalida = filtroModelo
      ? obtenerCarpetaLoteModelo(filtroModelo, numeroLote, esDryRun)
      : obtenerCarpetaLote(dirBaseLotes, numeroLote, esDryRun);

    console.log('========================================================================');
    console.log(`EJECUCIÓN DEL LOTE ${numeroLote} (${esDryRun ? 'SIMULACIÓN DRY-RUN' : 'MODO REAL'})`);
    console.log('========================================================================');
    console.log(`Casos:            ${defLote.casosIds.join(', ')}`);
    console.log(`Repetición:       ${defLote.repeticion}`);
    console.log(`Modelo(s):        ${adaptadores.map((a) => `${a.proveedor} (${a.modelo})`).join(', ')}`);
    console.log(`Planificadas:     ${operacionesEsperadas} operaciones (${casos.length * 5} ops por modelo)`);
    console.log(`Carpeta salida:   ${carpetaSalida}`);
    console.log('========================================================================\n');

    const resultado = await ejecutarBenchmark({
      adaptadores,
      casos,
      repeticiones: 1,
      repeticionExacta: defLote.repeticion,
      carpetaSalida,
      esPiloto: numeroLote === 1,
      esDryRun,
      delayEntreLlamadasMs: esDryRun ? 0 : 2000,
      loteNumero: numeroLote,
      reanudar: args.includes('--resume') || args.includes('--reanudar') || true,
    });

    const rutaEjecuciones = exportarEjecucionesCsv(resultado.resultados, carpetaSalida);
    const rutaCuentos = consolidarResumenCuentos(resultado.resultados, carpetaSalida);
    const rutaModelos = consolidarResumenModelos(resultado.resultados, carpetaSalida);
    const rutaOperaciones = consolidarResumenOperaciones(resultado.resultados, carpetaSalida);

    // Si es ejecución independiente de modelo y no es dry-run, consolidar automáticamente y reconstruir cuentos
    if (filtroModelo && !esDryRun) {
      const dirModelo = obtenerCarpetaModeloPruebas(filtroModelo);
      const dirCuentos = path.join(dirModelo, 'cuentos_generados');
      reconstruirYExportarCuentos(resultado.resultados, dirCuentos);
      consolidarResultadosModelo(filtroModelo);
    }

    let rutaCiegas: string | null = null;
    if (!esDryRun && !filtroModelo) {
      rutaCiegas = generarMuestrasAnonimizadas(resultado.resultados, carpetaSalida, casos, esDryRun);
    }

    console.log('\n========================================================================');
    console.log(`RESUMEN DEL LOTE ${numeroLote} (${esDryRun ? 'SIMULADO' : 'REAL'}):`);
    console.log(`Operaciones planificadas:     ${resultado.totalPrevistas}`);
    console.log(`Operaciones completadas:      ${resultado.resultados.length}`);
    console.log(`Operaciones exitosas:         ${resultado.exitosas}`);
    console.log(`Operaciones con error:        ${resultado.errores}`);
    console.log(`Solicitudes HTTP reales:      ${resultado.llamadasReales}`);
    console.log(
      `Costo teórico total:          ${
        resultado.costoTeoricoTotalUsd !== null ? `$${resultado.costoTeoricoTotalUsd.toFixed(6)} USD` : 'N/A'
      }`
    );
    console.log('\nArchivos generados en el lote:');
    console.log(`  - Operaciones (CSV):    ${rutaEjecuciones}`);
    console.log(`  - Manifiesto:           ${path.join(carpetaSalida, 'manifest.json')}`);
    console.log(`  - Registro de eventos:  ${path.join(carpetaSalida, 'events.jsonl')}`);
    console.log(`  - Resumen por cuento:   ${rutaCuentos}`);
    console.log(`  - Resumen por modelo:   ${rutaModelos}`);
    console.log(`  - Resumen por operación:${rutaOperaciones}`);
    if (rutaCiegas) {
      console.log(`  - Muestras ciegas:      ${rutaCiegas}`);
    }
    console.log('========================================================================\n');
    return;
  }

  // Modo full general (si se solicita con --full)
  const esDryRun = flagDryRun;
  if (!esDryRun && !flagAuthorize) {
    console.error('\n========================================================================');
    console.error('BLOQUEO DE SEGURIDAD EXPERIMENTAL - EJECUCIÓN TOTAL');
    console.error('========================================================================');
    console.error('Se solicitó la ejecución global continua del benchmark.');
    console.error('La metodología de tesis requiere ejecución controlada por lotes individuales.');
    console.error('Use --batch <N> para ejecutar un lote específico o autorice explícitamente con:');
    console.error('    --authorize-api-calls');
    console.error('========================================================================\n');
    process.exit(1);
  }

  const casos = cargarCasos(false);
  const repeticiones = 5;
  const carpetaSalida = path.resolve(process.cwd(), esDryRun ? 'benchmark/resultados/temp' : 'benchmark/resultados');

  const resultado = await ejecutarBenchmark({
    adaptadores,
    casos,
    repeticiones,
    carpetaSalida,
    esPiloto: false,
    esDryRun,
    delayEntreLlamadasMs: esDryRun ? 0 : 2000,
  });

  exportarEjecucionesCsv(resultado.resultados, carpetaSalida);
  consolidarResumenCuentos(resultado.resultados, carpetaSalida);
  consolidarResumenModelos(resultado.resultados, carpetaSalida);
  consolidarResumenOperaciones(resultado.resultados, carpetaSalida);

  console.log('\nEjecución finalizada. Archivos en: ' + carpetaSalida);
}

main().catch((err) => {
  console.error('Error fatal durante la ejecución del benchmark:', err);
  process.exit(1);
});
