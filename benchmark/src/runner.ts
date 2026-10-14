import * as fs from 'fs';
import * as path from 'path';
import { AdaptadorModelo } from './adaptadores/base.js';
import {
  SCHEMAS,
  validarEscenaFinal,
  validarEscenaIntermedia,
  validarStoryAnalysis,
} from './contratos.js';
import {
  construirPromptAnalisis,
  construirPromptEscena1,
  construirPromptEscenaIntermedia,
  construirPromptEscenaFinal,
  construirPromptRetry,
  PromptMensajes,
} from './prompts.js';
import {
  ApiCallError,
  CasoEstudio,
  Escena,
  ResultadoOperacion,
  StoryAnalysis,
} from './types.js';

export interface RunnerOptions {
  adaptadores: AdaptadorModelo[];
  casos: CasoEstudio[];
  repeticiones: number;
  carpetaSalida: string;
  esPiloto: boolean;
  esDryRun: boolean;
  delayEntreLlamadasMs?: number;
}

export interface RunnerResult {
  totalPrevistas: number;
  operacionesSimuladas: number;
  llamadasReales: number;
  exitosas: number;
  errores: number;
  costoTeoricoTotalUsd: number | null;
  costoEfectivoTotalUsd: number | null;
  resultados: ResultadoOperacion[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function obtenerPacingMs(adaptador: AdaptadorModelo, delayDefaultMs: number): number {
  if (adaptador.modelo === 'qwen/qwen3.8-27b') {
    // Pacing conservador de 65s entre operaciones reales consecutivas de Qwen al observar limite real de 1000 OTPM
    return 65000;
  }
  if (adaptador.proveedor === 'Groq') {
    return 15000;
  }
  return delayDefaultMs;
}

export function crearResultadoDependenciaFallida(params: {
  idEjecucion: string;
  adaptador: AdaptadorModelo;
  caso: CasoEstudio;
  repeticion: number;
  nombreOperacion: string;
  errorMsg: string;
  esSimulado: boolean;
}): ResultadoOperacion {
  return {
    id_ejecucion: params.idEjecucion,
    proveedor: params.adaptador.proveedor,
    modelo: params.adaptador.modelo,
    modelo_runtime: params.adaptador.modelo,
    provider_runtime: 'none',
    caso: params.caso.id,
    repeticion: params.repeticion,
    operacion: params.nombreOperacion,
    timestamp: new Date().toISOString(),
    http_status: null,
    tiempo_ms: null,
    tokens_entrada: null,
    tokens_salida: null,
    tokens_razonamiento: null,
    tokens_salida_facturables: null,
    tokens_totales: null,
    tokens_disponibles: false,
    json_valido: false,
    estructura_valida: false,
    ruta_controlada_valida: null,
    cumple_primer_intento: false,
    numero_reintentos: 0,
    numero_solicitudes_http: 0,
    error_categoria: 'dependency_failed',
    error: params.errorMsg,
    tarifa_input_usd_por_millon: params.adaptador.tarifaInputUsdPorMillon,
    tarifa_output_usd_por_millon: params.adaptador.tarifaOutputUsdPorMillon,
    tarifa_fuente_runtime: params.adaptador.tarifaFuenteRuntime,
    costo_entrada_usd: null,
    costo_salida_usd: null,
    costo_teorico_usd: null,
    costo_efectivo_experimento_usd: null,
    free_tier_activo: params.adaptador.freeTierActivo,
    reasoning_config: 'low',
    structured_output_mode: 'none',
    es_simulado: params.esSimulado,
  };
}

export async function ejecutarBenchmark(opts: RunnerOptions): Promise<RunnerResult> {
  const {
    adaptadores,
    casos,
    repeticiones,
    carpetaSalida,
    esDryRun,
    delayEntreLlamadasMs = 1500,
  } = opts;

  const totalOperacionesPrevistas = adaptadores.length * casos.length * repeticiones * 5;

  console.log('====================================================');
  console.log('PLAN DE EJECUCION (' + totalOperacionesPrevistas + ' operaciones)');
  console.log('Modelos:         ' + adaptadores.map((a) => a.modelo).join(', '));
  console.log('Casos:           ' + casos.map((c) => c.id).join(', '));
  console.log('Repeticiones:    ' + repeticiones);
  console.log('Operaciones/cuento: 5 (1 analisis + 4 escenas)');
  console.log('TOTAL PREVISTAS: ' + totalOperacionesPrevistas + ' operaciones');
  console.log('Carpeta salida:  ' + carpetaSalida);
  console.log('====================================================\n');

  if (esDryRun) {
    console.log('[DRY-RUN] Modo de validacion estricta sin red activado:');
    console.log('- 0 llamadas de red a APIs externas.');
    console.log('- 0 gasto en USD.');
    console.log('- Verificando integridad de contratos, prompts y flujo con respuestas sinteticas deterministas...\n');
  }

  if (!fs.existsSync(carpetaSalida)) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
  }

  const resultados: ResultadoOperacion[] = [];
  let contadorEjecucion = 0;

  for (const adaptador of adaptadores) {
    for (const caso of casos) {
      for (let rep = 1; rep <= repeticiones; rep++) {
        console.log('--> [' + adaptador.proveedor + ' - ' + adaptador.modelo + '] Caso: ' + caso.id + ' | Repeticion: ' + rep);

        let analisisContexto: StoryAnalysis | null = null;
        let historiaAcumulada = '';

        // OPERACION 1: ANALISIS
        contadorEjecucion++;
        const resAnalisis = await ejecutarOperacionIndividual({
          idEjecucion: 'ejec_' + contadorEjecucion,
          adaptador,
          caso,
          repeticion: rep,
          nombreOperacion: 'analisis',
          prompt: construirPromptAnalisis(caso.textoFuente),
          schema: SCHEMAS.analisis,
          tipoContrato: 'analisis',
          validador: (data) => validarStoryAnalysis(data),
          esDryRun,
        });
        resultados.push(resAnalisis);

        // Regla de dependencia narrativa: si analisis falla, omitir escenas 1-4
        if (!resAnalisis.estructura_valida || !resAnalisis.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de analisis previa no produjo un resultado valido.';
          for (const opRestante of ['escena_1', 'escena_2', 'escena_3', 'escena_4']) {
            contadorEjecucion++;
            resultados.push(crearResultadoDependenciaFallida({
              idEjecucion: 'ejec_' + contadorEjecucion,
              adaptador,
              caso,
              repeticion: rep,
              nombreOperacion: opRestante,
              errorMsg: msgDep,
              esSimulado: esDryRun,
            }));
          }
          continue;
        }

        analisisContexto = resAnalisis.contenido_generado as StoryAnalysis;

        if (!esDryRun) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 2: ESCENA 1
        contadorEjecucion++;
        const resEscena1 = await ejecutarOperacionIndividual({
          idEjecucion: 'ejec_' + contadorEjecucion,
          adaptador,
          caso,
          repeticion: rep,
          nombreOperacion: 'escena_1',
          prompt: construirPromptEscena1(analisisContexto, caso.decisionesFijas[0]),
          schema: SCHEMAS.escena,
          tipoContrato: 'escena_intermedia',
          decisionControladaSiguiente: caso.decisionesFijas[0],
          validador: (data) => validarEscenaIntermedia(data, caso.decisionesFijas[0]),
          esDryRun,
        });
        resultados.push(resEscena1);

        // Regla de dependencia narrativa: si escena 1 falla, omitir escenas 2-4
        if (!resEscena1.estructura_valida || !resEscena1.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de escena_1 previa no produjo un resultado valido.';
          for (const opRestante of ['escena_2', 'escena_3', 'escena_4']) {
            contadorEjecucion++;
            resultados.push(crearResultadoDependenciaFallida({
              idEjecucion: 'ejec_' + contadorEjecucion,
              adaptador,
              caso,
              repeticion: rep,
              nombreOperacion: opRestante,
              errorMsg: msgDep,
              esSimulado: esDryRun,
            }));
          }
          continue;
        }

        historiaAcumulada += 'Inicio: ' + resEscena1.contenido_generado.contenido + '\n';

        if (!esDryRun) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 3: ESCENA 2
        contadorEjecucion++;
        const resEscena2 = await ejecutarOperacionIndividual({
          idEjecucion: 'ejec_' + contadorEjecucion,
          adaptador,
          caso,
          repeticion: rep,
          nombreOperacion: 'escena_2',
          prompt: construirPromptEscenaIntermedia(
            historiaAcumulada,
            caso.decisionesFijas[0],
            2,
            caso.decisionesFijas[1]
          ),
          schema: SCHEMAS.escena,
          tipoContrato: 'escena_intermedia',
          decisionControladaSiguiente: caso.decisionesFijas[1],
          validador: (data) => validarEscenaIntermedia(data, caso.decisionesFijas[1]),
          esDryRun,
        });
        resultados.push(resEscena2);

        // Regla de dependencia narrativa: si escena 2 falla, omitir escenas 3-4
        if (!resEscena2.estructura_valida || !resEscena2.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de escena_2 previa no produjo un resultado valido.';
          for (const opRestante of ['escena_3', 'escena_4']) {
            contadorEjecucion++;
            resultados.push(crearResultadoDependenciaFallida({
              idEjecucion: 'ejec_' + contadorEjecucion,
              adaptador,
              caso,
              repeticion: rep,
              nombreOperacion: opRestante,
              errorMsg: msgDep,
              esSimulado: esDryRun,
            }));
          }
          continue;
        }

        historiaAcumulada += 'Decision 1 (' + caso.decisionesFijas[0] + '): ' + resEscena2.contenido_generado.contenido + '\n';

        if (!esDryRun) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 4: ESCENA 3
        contadorEjecucion++;
        const resEscena3 = await ejecutarOperacionIndividual({
          idEjecucion: 'ejec_' + contadorEjecucion,
          adaptador,
          caso,
          repeticion: rep,
          nombreOperacion: 'escena_3',
          prompt: construirPromptEscenaIntermedia(
            historiaAcumulada,
            caso.decisionesFijas[1],
            3,
            caso.decisionesFijas[2]
          ),
          schema: SCHEMAS.escena,
          tipoContrato: 'escena_intermedia',
          decisionControladaSiguiente: caso.decisionesFijas[2],
          validador: (data) => validarEscenaIntermedia(data, caso.decisionesFijas[2]),
          esDryRun,
        });
        resultados.push(resEscena3);

        // Regla de dependencia narrativa: si escena 3 falla, omitir escena 4
        if (!resEscena3.estructura_valida || !resEscena3.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de escena_3 previa no produjo un resultado valido.';
          contadorEjecucion++;
          resultados.push(crearResultadoDependenciaFallida({
            idEjecucion: 'ejec_' + contadorEjecucion,
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'escena_4',
            errorMsg: msgDep,
            esSimulado: esDryRun,
          }));
          continue;
        }

        historiaAcumulada += 'Decision 2 (' + caso.decisionesFijas[1] + '): ' + resEscena3.contenido_generado.contenido + '\n';

        if (!esDryRun) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 5: ESCENA 4 (FINAL)
        contadorEjecucion++;
        const resEscena4 = await ejecutarOperacionIndividual({
          idEjecucion: 'ejec_' + contadorEjecucion,
          adaptador,
          caso,
          repeticion: rep,
          nombreOperacion: 'escena_4',
          prompt: construirPromptEscenaFinal(historiaAcumulada, caso.decisionesFijas[2]),
          schema: SCHEMAS.escenaFinal,
          tipoContrato: 'escena_final',
          validador: (data) => validarEscenaFinal(data),
          esDryRun,
        });
        resultados.push(resEscena4);

        if (!esDryRun) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }
      }
    }
  }

  const exitosas = resultados.filter((r) => r.estructura_valida).length;
  const errores = resultados.filter((r) => !r.estructura_valida).length;
  const llamadasReales = esDryRun ? 0 : resultados.reduce((acc, r) => acc + r.numero_solicitudes_http, 0);

  const algunCostoTeoricoNull = resultados.some((r) => r.costo_teorico_usd === null && !r.es_simulado && r.error_categoria !== 'dependency_failed');
  const costoTeoricoTotalUsd = esDryRun
    ? null
    : algunCostoTeoricoNull
    ? null
    : resultados.reduce((acc, r) => acc + (r.costo_teorico_usd || 0), 0);

  const costoEfectivoTotalUsd = esDryRun
    ? null
    : resultados.some((r) => r.costo_efectivo_experimento_usd === null && !r.es_simulado && r.error_categoria !== 'dependency_failed')
    ? null
    : resultados.reduce((acc, r) => acc + (r.costo_efectivo_experimento_usd || 0), 0);

  return {
    totalPrevistas: totalOperacionesPrevistas,
    operacionesSimuladas: esDryRun ? resultados.length : 0,
    llamadasReales,
    exitosas,
    errores,
    costoTeoricoTotalUsd,
    costoEfectivoTotalUsd,
    resultados,
  };
}

export interface OperacionParams {
  idEjecucion: string;
  adaptador: AdaptadorModelo;
  caso: CasoEstudio;
  repeticion: number;
  nombreOperacion: string;
  prompt: PromptMensajes;
  schema: any;
  tipoContrato: 'analisis' | 'escena_intermedia' | 'escena_final';
  decisionControladaSiguiente?: string;
  validador: (data: unknown) => {
    valido: boolean;
    error?: string;
    parsed?: any;
    rutaControladaValida?: boolean | null;
  };
  esDryRun: boolean;
  permitirRetry?: boolean;
  registrarRespuesta?: (response: unknown) => void;
  registrarErrorApi?: (error: ApiCallError) => void;
  propagarFallosPersistencia?: boolean;
}

export class ErrorPersistenciaFatal extends Error {
  constructor() {
    // Do not expose filesystem errors, provider bodies or credentials in fatal diagnostics.
    super('TEST20_PERSISTENCE_FATAL');
    this.name = 'ErrorPersistenciaFatal';
  }
}

export async function ejecutarOperacionIndividual(p: OperacionParams): Promise<ResultadoOperacion> {
  const timestamp = new Date().toISOString();

  if (p.esDryRun) {
    let contenidoSimulado: any;
    let rutaValidaSimulada: boolean | null = null;

    if (p.tipoContrato === 'analisis') {
      contenidoSimulado = {
        titulo: p.caso.titulo,
        tituloOriginal: p.caso.titulo,
        protagonista: p.caso.protagonistaBase,
        descripcionProtagonista: p.caso.protagonistaBase,
        resumen: 'Resumen sintetico simulado para ' + p.caso.id,
        escenario: 'Entorno narrativo del caso',
        conflicto: 'Conflicto principal planteado',
        finalOriginal: 'Resolucion de la lectura',
      };
      rutaValidaSimulada = null;
    } else if (p.tipoContrato === 'escena_intermedia') {
      const opcionControlada = p.decisionControladaSiguiente || 'Opcion controlada simulada';
      contenidoSimulado = {
        contenido: 'Contenido narrativo simulado para la operacion ' + p.nombreOperacion + ' del caso ' + p.caso.id + '.',
        opciones: [opcionControlada, 'Opcion libre simulada B', 'Opcion libre simulada C'],
        esFinal: false,
      };
      rutaValidaSimulada = true;
    } else {
      contenidoSimulado = {
        contenido: 'Desenlace y conclusion final simulada para el caso ' + p.caso.id + '. Reflexion constructiva sobre el aprendizaje.',
        opciones: [],
        esFinal: true,
      };
      rutaValidaSimulada = null;
    }

    const valRes = p.validador(contenidoSimulado);

    return {
      id_ejecucion: p.idEjecucion,
      proveedor: p.adaptador.proveedor,
      modelo: p.adaptador.modelo,
      modelo_runtime: p.adaptador.modelo,
      provider_runtime: 'simulador_dry_run',
      caso: p.caso.id,
      repeticion: p.repeticion,
      operacion: p.nombreOperacion,
      timestamp,
      http_status: null,
      tiempo_ms: null,
      tokens_entrada: null,
      tokens_salida: null,
      tokens_razonamiento: null,
      tokens_salida_facturables: null,
      tokens_totales: null,
      tokens_disponibles: false,
      json_valido: true,
      estructura_valida: valRes.valido,
      ruta_controlada_valida: rutaValidaSimulada,
      cumple_primer_intento: true,
      numero_reintentos: 0,
      numero_solicitudes_http: 0,
      error_categoria: 'none',
      error: '',
      tarifa_input_usd_por_millon: p.adaptador.tarifaInputUsdPorMillon,
      tarifa_output_usd_por_millon: p.adaptador.tarifaOutputUsdPorMillon,
      tarifa_fuente_runtime: p.adaptador.tarifaFuenteRuntime,
      costo_entrada_usd: null,
      costo_salida_usd: null,
      costo_teorico_usd: null,
      costo_efectivo_experimento_usd: null,
      free_tier_activo: p.adaptador.freeTierActivo,
      reasoning_config: 'low',
      structured_output_mode: 'json_schema',
      es_simulado: true,
      contenido_generado: contenidoSimulado,
    };
  }

  // --- EJECUCION REAL ---
  let intento = 0;
  let reintentos = 0;
  let numeroSolicitudesHttp = 0;
  let rawResp: any = null;
  let parsedJson: any = null;
  let jsonValido = false;
  let estructuraValida = false;
  let rutaControladaValida: boolean | null = null;
  let errorCategoria = 'none';
  let errorMensaje = '';
  let tiempoMsAcumulado = 0;
  let httpStatus: number | null = null;
  let promptActual = p.prompt;

  let tokensEntradaAcumulados = 0;
  let tokensSalidaAcumulados = 0;
  let tokensRazonamientoAcumulados = 0;
  let tokensSalidaFacturablesAcumulados = 0;
  let tokensTotalesAcumulados = 0;
  let tokensDisponiblesGlobal = false;

  while (intento <= 1) {
    numeroSolicitudesHttp++;
    try {
      rawResp = await p.adaptador.ejecutarLlamada(promptActual, p.schema, p.tipoContrato);
      try { p.registrarRespuesta?.(rawResp); } catch (error) {
        if (p.propagarFallosPersistencia) throw new ErrorPersistenciaFatal();
        throw error;
      }
      httpStatus = rawResp.status;
      tiempoMsAcumulado += rawResp.latencyMs;

      if (rawResp.usage.tokensDisponibles) {
        tokensDisponiblesGlobal = true;
        tokensEntradaAcumulados += rawResp.usage.tokensEntrada ?? 0;
        tokensSalidaAcumulados += rawResp.usage.tokensSalida ?? 0;
        tokensRazonamientoAcumulados += rawResp.usage.tokensRazonamiento ?? 0;
        tokensSalidaFacturablesAcumulados += rawResp.usage.tokensSalidaFacturables ?? 0;
        tokensTotalesAcumulados += rawResp.usage.tokensTotales ?? 0;
      }

      try {
        parsedJson = JSON.parse(rawResp.rawText);
        jsonValido = true;
      } catch (errJson: any) {
        jsonValido = false;
        errorMensaje = 'JSON no parseable: ' + (errJson.message || String(errJson));
      }

      if (jsonValido) {
        const check = p.validador(parsedJson);
        rutaControladaValida = check.rutaControladaValida ?? null;
        if (check.valido) {
          estructuraValida = true;
          errorMensaje = '';
          break;
        } else {
          estructuraValida = false;
          errorMensaje = check.error || 'Violacion de contrato';
        }
      }
    } catch (errApi: any) {
      if (p.propagarFallosPersistencia && errApi instanceof ErrorPersistenciaFatal) throw errApi;
      if (errApi instanceof ApiCallError) {
        // This callback runs outside the inference try: persistence errors cannot become API errors.
        p.registrarErrorApi?.(errApi);
        httpStatus = errApi.status !== undefined ? errApi.status : 0;
        tiempoMsAcumulado += errApi.latencyMs;
        errorCategoria = errApi.categoria;
        errorMensaje = errApi.message;
        if (errApi.isNonRetryable) {
          break;
        }
      } else {
        httpStatus = 0;
        errorCategoria = 'unknown';
        errorMensaje = errApi.message || 'Error desconocido';
        break;
      }
    }

    // Unico retry correctivo permitido si HTTP fue 2xx pero la salida es invalida (JSON, contrato o ruta controlada)
    // NO hacer retry si ocurrio error de API (400, 401, 403, 404, 429, billing, model_not_found, etc.)
    const esHttp2xx = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
    if (p.permitirRetry !== false && intento === 0 && (!jsonValido || !estructuraValida) && errorCategoria === 'none' && esHttp2xx) {
      reintentos = 1;
      intento++;
      promptActual = construirPromptRetry(
        p.prompt,
        rawResp?.rawText ?? '',
        errorMensaje,
        JSON.stringify(p.schema, null, 2),
        p.decisionControladaSiguiente
      );
      console.log('    [REINTENTO CORRECTIVO] ' + p.nombreOperacion + ' - ' + p.adaptador.modelo + ': ' + errorMensaje);
    } else {
      break;
    }
  }

  const cumplePrimerIntento = estructuraValida && reintentos === 0;

  const tokensEntrada = tokensDisponiblesGlobal ? tokensEntradaAcumulados : null;
  const tokensSalida = tokensDisponiblesGlobal ? tokensSalidaAcumulados : null;
  const tokensRazonamiento = tokensDisponiblesGlobal ? tokensRazonamientoAcumulados : null;
  const tokensSalidaFacturables = tokensDisponiblesGlobal ? tokensSalidaFacturablesAcumulados : null;
  const tokensTotales = tokensDisponiblesGlobal ? tokensTotalesAcumulados : null;
  const tokensDisponibles = tokensDisponiblesGlobal;

  let costoEntrada: number | null = null;
  let costoSalida: number | null = null;
  let costoTeorico: number | null = null;

  if (
    tokensEntrada !== null &&
    tokensSalidaFacturables !== null &&
    p.adaptador.tarifaInputUsdPorMillon !== null &&
    p.adaptador.tarifaOutputUsdPorMillon !== null
  ) {
    costoEntrada = (tokensEntrada / 1_000_000) * p.adaptador.tarifaInputUsdPorMillon;
    costoSalida = (tokensSalidaFacturables / 1_000_000) * p.adaptador.tarifaOutputUsdPorMillon;
    costoTeorico = costoEntrada + costoSalida;
  }

  const costoEfectivo: number | null = null;

  return {
    id_ejecucion: p.idEjecucion,
    proveedor: p.adaptador.proveedor,
    modelo: p.adaptador.modelo,
    modelo_runtime: p.adaptador.modelo,
    provider_runtime: rawResp?.providerRuntime || 'no_reportado',
    caso: p.caso.id,
    repeticion: p.repeticion,
    operacion: p.nombreOperacion,
    timestamp,
    http_status: httpStatus,
    tiempo_ms: tiempoMsAcumulado,
    tokens_entrada: tokensEntrada,
    tokens_salida: tokensSalida,
    tokens_razonamiento: tokensRazonamiento,
    tokens_salida_facturables: tokensSalidaFacturables,
    tokens_totales: tokensTotales,
    tokens_disponibles: tokensDisponibles,
    json_valido: jsonValido,
    estructura_valida: estructuraValida,
    ruta_controlada_valida: rutaControladaValida,
    cumple_primer_intento: cumplePrimerIntento,
    numero_reintentos: reintentos,
    numero_solicitudes_http: numeroSolicitudesHttp,
    error_categoria: errorCategoria,
    error: errorMensaje,
    tarifa_input_usd_por_millon: p.adaptador.tarifaInputUsdPorMillon,
    tarifa_output_usd_por_millon: p.adaptador.tarifaOutputUsdPorMillon,
    tarifa_fuente_runtime: p.adaptador.tarifaFuenteRuntime,
    costo_entrada_usd: costoEntrada,
    costo_salida_usd: costoSalida,
    costo_teorico_usd: costoTeorico,
    costo_efectivo_experimento_usd: costoEfectivo,
    free_tier_activo: p.adaptador.freeTierActivo,
    reasoning_config: 'low',
    structured_output_mode: rawResp?.structuredOutputMode || 'json_schema',
    es_simulado: false,
    contenido_generado: parsedJson,
  };
}
