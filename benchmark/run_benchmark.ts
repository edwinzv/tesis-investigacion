import * as fs from 'fs';
import * as path from 'path';
import { AdaptadorGoogle } from './src/adaptadores/google.js';
import { AdaptadorGroq } from './src/adaptadores/groq.js';
import { AdaptadorGroqGptOss } from './src/adaptadores/groq_gpt_oss.js';
import { AdaptadorModelo } from './src/adaptadores/base.js';
import { CasoEstudio } from './src/types.js';
import { ejecutarBenchmark } from './src/runner.js';
import { SCHEMAS, validarPreflight } from './src/contratos.js';
import { construirPromptPreflight } from './src/prompts.js';
import {
  consolidarResumenCuentos,
  consolidarResumenModelos,
  consolidarResumenOperaciones,
  exportarEjecucionesCsv,
} from './src/reportes.js';
import { generarMuestrasAnonimizadas } from './src/evaluacion_ciega.js';
import { validarArgumentos, ejecutarTest20Cli } from './src/test20.js';

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
  console.log('Sin retries. Schema: {\"estado\":\"ok\"}. Limite: 256 tokens.');
  console.log('NO forma parte del benchmark. NO escribe en resultados/ ni resultados_piloto/.\\n');

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
        console.log('  -> PREFLIGHT_OK: Contrato valido {\"estado\":\"ok\"}');
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
  console.log('====================================================\\n');
  console.log('Preflight finalizado. Deteniendo ejecucion sin benchmark.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  validarArgumentos(args);
  if (args.includes('--test20')) {
    await ejecutarTest20Cli(args);
    return;
  }
  cargarVariablesEntorno();

  const flagCheckProviders = args.includes('--check-providers');
  const flagPreflight = args.includes('--preflight');
  const flagDryRun = args.includes('--dry-run');
  const flagPilot = args.includes('--pilot');
  const flagFull = args.includes('--full');

  if (args.length === 0 || (!flagCheckProviders && !flagPreflight && !flagDryRun && !flagPilot && !flagFull)) {
    console.error('====================================================');
    console.error('ERROR: No se especificó ningún modo de ejecución.');
    console.error('No se ejecutó ninguna llamada. Use --pilot o --full explícitamente.');
    console.error('Opciones disponibles:');
    console.error('  --dry-run             : Simulación del benchmark definitivo (150 ops, 0 red, 0 gasto)');
    console.error('  --pilot --dry-run     : Simulación del piloto (15 ops, 0 red, 0 gasto)');
    console.error('  --check-providers     : Comprobación de conectividad sin generación (0 tokens)');
    console.error('  --preflight           : Comprobación técnica de 1 llamada mínima por modelo');
    console.error('  --pilot               : Ejecución REAL del piloto (15 ops experimentales)');
    console.error('  --full                : Ejecución REAL definitiva (150 ops experimentales)');
    console.error('====================================================');
    process.exit(1);
  }

  const adaptadores: AdaptadorModelo[] = [
    new AdaptadorGoogle(),
    new AdaptadorGroq(),
    new AdaptadorGroqGptOss(),
  ];

  if (flagCheckProviders) {
    await ejecutarCheckProviders(adaptadores);
    return;
  }

  if (flagPreflight) {
    await ejecutarPreflight(adaptadores);
    return;
  }

  const esPiloto = flagPilot;
  const esDryRun = flagDryRun;

  const casos = cargarCasos(esPiloto);
  const repeticiones = esPiloto ? 1 : 2;

  let carpetaSalida = esPiloto
    ? path.resolve(process.cwd(), 'benchmark/resultados_piloto/piloto_02_corregido')
    : path.resolve(process.cwd(), 'benchmark/resultados');

  if (esDryRun) {
    carpetaSalida = esPiloto
      ? path.resolve(process.cwd(), 'benchmark/resultados_piloto/temp')
      : path.resolve(process.cwd(), 'benchmark/resultados/temp');
  }

  const resultado = await ejecutarBenchmark({
    adaptadores,
    casos,
    repeticiones,
    carpetaSalida,
    esPiloto,
    esDryRun,
    delayEntreLlamadasMs: esDryRun ? 0 : 2000,
  });

  const rutaEjecuciones = exportarEjecucionesCsv(resultado.resultados, carpetaSalida);
  const rutaCuentos = consolidarResumenCuentos(resultado.resultados, carpetaSalida);
  const rutaModelos = consolidarResumenModelos(resultado.resultados, carpetaSalida);
  const rutaOperaciones = consolidarResumenOperaciones(resultado.resultados, carpetaSalida);

  let rutaCiegas: string | null = null;
  if (!esDryRun) {
    rutaCiegas = generarMuestrasAnonimizadas(resultado.resultados, carpetaSalida, casos, esDryRun);
  }

  console.log('\n====================================================');
  if (esDryRun) {
    if (esPiloto) {
      console.log('PILOT DRY RUN:');
      console.log(`operaciones_simuladas = ${resultado.operacionesSimuladas}`);
      console.log('llamadas_reales = 0');
      console.log('tokens_reales = N/A');
      console.log('costo_teorico_experimental = N/A');
      console.log('gasto_real = 0 USD');
    } else {
      console.log('FULL DRY RUN:');
      console.log(`operaciones_simuladas = ${resultado.operacionesSimuladas}`);
      console.log('llamadas_reales = 0');
      console.log('tokens_reales = N/A');
      console.log('costo_teorico_experimental = N/A');
      console.log('gasto_real = 0 USD');
    }
  } else {
    console.log('RESUMEN DE EJECUCIÓN REAL:');
    console.log(`operaciones_previstas = ${resultado.totalPrevistas}`);
    console.log(`solicitudes_http_reales = ${resultado.llamadasReales}`);
    console.log(`operaciones_exitosas = ${resultado.exitosas}`);
    console.log(`operaciones_con_error = ${resultado.errores}`);
    console.log(
      `costo_teorico_total = ${
        resultado.costoTeoricoTotalUsd !== null ? `$${resultado.costoTeoricoTotalUsd.toFixed(6)} USD` : 'N/A (hay solicitudes sin usage/costo calculable)'
      }`
    );
    console.log(
      `costo_efectivo_total = ${
        resultado.costoEfectivoTotalUsd !== null ? `$${resultado.costoEfectivoTotalUsd.toFixed(6)} USD` : 'desconocido'
      }`
    );
  }

  console.log('\nArchivos estructurados generados en:');
  console.log(`  - Detalle operaciones:  ${rutaEjecuciones}`);
  console.log(`  - Resumen por cuento:   ${rutaCuentos}`);
  console.log(`  - Resumen por modelo:   ${rutaModelos}`);
  console.log(`  - Resumen por operación:${rutaOperaciones}`);
  if (rutaCiegas) {
    console.log(`  - Muestras para ciega:  ${rutaCiegas}`);
  } else {
    console.log(`  - Muestras ciegas:      (Omitidas en simulación dry-run)`);
  }
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Error fatal durante la ejecución del benchmark:', err);
  process.exit(1);
});
