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
import {
  cargarOperacionesPrevias,
  generarIdEjecucion,
  obtenerDefinicionLote,
  obtenerGitCommit,
  obtenerHashesArchivosClave,
} from './lotes.js';

export interface RunnerOptions {
  adaptadores: AdaptadorModelo[];
  casos: CasoEstudio[];
  repeticiones: number;
  repeticionExacta?: number;
  carpetaSalida: string;
  esPiloto: boolean;
  esDryRun: boolean;
  delayEntreLlamadasMs?: number;
  loteNumero?: number;
  reanudar?: boolean;
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
  if (adaptador.modelo === 'openai/gpt-oss-20b' || adaptador.proveedor === 'Groq') {
    return 15000;
  }
  if (adaptador.proveedor === 'Google' || adaptador.modelo === 'gemini-3.5-flash-lite') {
    // Pacing conservador de 5s para respetar límite de 15 RPM en Free Tier de Gemini
    return 5000;
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

  // Resolver las repeticiones experimentales exactas
  let repeticionesLista: number[];
  if (opts.repeticionExacta !== undefined) {
    repeticionesLista = [opts.repeticionExacta];
  } else if (opts.loteNumero !== undefined) {
    const def = obtenerDefinicionLote(opts.loteNumero);
    repeticionesLista = [def.repeticion];
  } else {
    repeticionesLista = Array.from({ length: repeticiones }, (_, i) => i + 1);
  }

  const totalOperacionesPrevistas = adaptadores.length * casos.length * repeticionesLista.length * 5;

  console.log('====================================================');
  console.log('PLAN DE EJECUCION (' + totalOperacionesPrevistas + ' operaciones)');
  console.log('Modelos:         ' + adaptadores.map((a) => a.modelo).join(', '));
  console.log('Casos:           ' + casos.map((c) => c.id).join(', '));
  console.log('Repetición(es):  ' + repeticionesLista.join(', '));
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

  const fechaInicioUtc = new Date().toISOString();

  if (!fs.existsSync(carpetaSalida)) {
    fs.mkdirSync(carpetaSalida, { recursive: true });
  }

  const rutaEvents = path.join(carpetaSalida, 'events.jsonl');
  const appendEvent = (ev: object) => {
    try {
      fs.appendFileSync(rutaEvents, JSON.stringify({ utc: new Date().toISOString(), ...ev }) + '\n', 'utf-8');
    } catch {}
  };

  const reanudarActivo = opts.reanudar === true || (opts.loteNumero !== undefined && opts.reanudar !== false);
  const { operacionesMap: previasMap, eventosHistorial } = reanudarActivo && fs.existsSync(carpetaSalida)
    ? cargarOperacionesPrevias(carpetaSalida, !opts.esDryRun)
    : { operacionesMap: new Map<string, ResultadoOperacion>(), eventosHistorial: [] };

  // Salvaguarda documental: preservar estado histórico previo del lote antes de cualquier reanudación
  if (reanudarActivo && fs.existsSync(carpetaSalida) && opts.loteNumero) {
    const pad = String(opts.loteNumero).padStart(2, '0');
    const rutaEventsOrig = path.join(carpetaSalida, `events_originales_lote${pad}.jsonl`);
    const rutaCsvOrig = path.join(carpetaSalida, `ejecuciones_raw_originales_lote${pad}.csv`);
    const rutaEventsActual = path.join(carpetaSalida, 'events.jsonl');
    const rutaCsvActual = path.join(carpetaSalida, 'ejecuciones_raw.csv');

    if (fs.existsSync(rutaEventsActual) && !fs.existsSync(rutaEventsOrig)) {
      try { fs.copyFileSync(rutaEventsActual, rutaEventsOrig); } catch {}
    }
    if (fs.existsSync(rutaCsvActual) && !fs.existsSync(rutaCsvOrig)) {
      try { fs.copyFileSync(rutaCsvActual, rutaCsvOrig); } catch {}
    }
  }

  const conteoIntentosPrevios = new Map<string, number>();
  for (const ev of eventosHistorial) {
    if (ev.type === 'operation_result' && ev.result) {
      const r = ev.result as ResultadoOperacion;
      const key = `${r.modelo}___${r.caso}___${r.repeticion}___${r.operacion}`;
      conteoIntentosPrevios.set(key, (conteoIntentosPrevios.get(key) || 0) + 1);
    }
  }

  const cuotaAgotadaModelos = new Set<string>();
  const resultados: ResultadoOperacion[] = [];
  let contadorEjecucion = 0;

  const resolverInfoEjecucion = (
    modelo: string,
    casoId: string,
    rep: number,
    nombreOp: string
  ): { idEjecucion: string; esRecuperacion: boolean; intentoNumero: number } => {
    const key = `${modelo}___${casoId}___${rep}___${nombreOp}`;
    const intentosPrevios = conteoIntentosPrevios.get(key) || 0;
    const intentoNumero = intentosPrevios + 1;
    const esRecuperacion = intentosPrevios > 0;
    if (opts.loteNumero) {
      return {
        idEjecucion: generarIdEjecucion(opts.loteNumero, modelo, casoId, rep, nombreOp, intentoNumero),
        esRecuperacion,
        intentoNumero,
      };
    }
    contadorEjecucion++;
    return {
      idEjecucion: 'ejec_' + contadorEjecucion,
      esRecuperacion,
      intentoNumero,
    };
  };

  const resolverIdEjecucion = (modelo: string, casoId: string, rep: number, nombreOp: string): string => {
    return resolverInfoEjecucion(modelo, casoId, rep, nombreOp).idEjecucion;
  };

  for (const adaptador of adaptadores) {
    for (const caso of casos) {
      for (const rep of repeticionesLista) {
        console.log('--> [' + adaptador.proveedor + ' - ' + adaptador.modelo + '] Caso: ' + caso.id + ' | Repeticion: ' + rep);

        let analisisContexto: StoryAnalysis | null = null;
        let historiaAcumulada = '';

        // OPERACION 1: ANALISIS
        const keyAnalisis = `${adaptador.modelo}___${caso.id}___${rep}___analisis`;
        const previaAnalisis = previasMap.get(keyAnalisis);
        const infoAnalisis = resolverInfoEjecucion(adaptador.modelo, caso.id, rep, 'analisis');
        let resAnalisis: ResultadoOperacion;

        if (reanudarActivo && previaAnalisis && previaAnalisis.estructura_valida && previaAnalisis.contenido_generado && (!previaAnalisis.es_simulado || esDryRun)) {
          console.log('    [REANUDACIÓN] analisis (' + adaptador.modelo + ' - ' + caso.id + ') completada previamente con éxito.');
          resAnalisis = previaAnalisis;
        } else if (cuotaAgotadaModelos.has(adaptador.modelo)) {
          resAnalisis = crearResultadoDependenciaFallida({
            idEjecucion: infoAnalisis.idEjecucion,
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'analisis',
            errorMsg: 'Omitida por agotamiento previo de cuota en este candidato (rate_limit / 429)',
            esSimulado: esDryRun,
          });
          resAnalisis.error_categoria = 'rate_limit';
        } else {
          resAnalisis = await ejecutarOperacionIndividual({
            idEjecucion: infoAnalisis.idEjecucion,
            esRecuperacion: infoAnalisis.esRecuperacion,
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
          appendEvent({ type: 'operation_result', result: resAnalisis });
          if (resAnalisis.error_categoria === 'rate_limit' || resAnalisis.http_status === 429) {
            cuotaAgotadaModelos.add(adaptador.modelo);
            console.warn('    [SUSPENSIÓN DE CUOTA] Agotamiento de cuota detectado en ' + adaptador.modelo + '. Se omiten operaciones restantes.');
          }
        }
        resultados.push(resAnalisis);

        // Regla de dependencia narrativa: si analisis falla, omitir escenas 1-4
        if (!resAnalisis.estructura_valida || !resAnalisis.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de analisis previa no produjo un resultado valido.';
          for (const opRestante of ['escena_1', 'escena_2', 'escena_3', 'escena_4']) {
            const resDep = crearResultadoDependenciaFallida({
              idEjecucion: resolverIdEjecucion(adaptador.modelo, caso.id, rep, opRestante),
              adaptador,
              caso,
              repeticion: rep,
              nombreOperacion: opRestante,
              errorMsg: msgDep,
              esSimulado: esDryRun,
            });
            resultados.push(resDep);
            appendEvent({ type: 'operation_result', result: resDep });
          }
          continue;
        }

        analisisContexto = resAnalisis.contenido_generado as StoryAnalysis;

        if (!esDryRun && resAnalisis.numero_solicitudes_http > 0) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 2: ESCENA 1
        const keyEscena1 = `${adaptador.modelo}___${caso.id}___${rep}___escena_1`;
        const previaEscena1 = previasMap.get(keyEscena1);
        const infoEscena1 = resolverInfoEjecucion(adaptador.modelo, caso.id, rep, 'escena_1');
        let resEscena1: ResultadoOperacion;

        if (reanudarActivo && previaEscena1 && previaEscena1.estructura_valida && previaEscena1.contenido_generado && (!previaEscena1.es_simulado || esDryRun)) {
          console.log('    [REANUDACIÓN] escena_1 (' + adaptador.modelo + ' - ' + caso.id + ') completada previamente con éxito.');
          resEscena1 = previaEscena1;
        } else if (cuotaAgotadaModelos.has(adaptador.modelo)) {
          resEscena1 = crearResultadoDependenciaFallida({
            idEjecucion: infoEscena1.idEjecucion,
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'escena_1',
            errorMsg: 'Omitida por agotamiento previo de cuota en este candidato (rate_limit / 429)',
            esSimulado: esDryRun,
          });
          resEscena1.error_categoria = 'rate_limit';
        } else {
          resEscena1 = await ejecutarOperacionIndividual({
            idEjecucion: infoEscena1.idEjecucion,
            esRecuperacion: infoEscena1.esRecuperacion,
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
          appendEvent({ type: 'operation_result', result: resEscena1 });
          if (resEscena1.error_categoria === 'rate_limit' || resEscena1.http_status === 429) {
            cuotaAgotadaModelos.add(adaptador.modelo);
            console.warn('    [SUSPENSIÓN DE CUOTA] Agotamiento de cuota detectado en ' + adaptador.modelo + '. Se omiten operaciones restantes.');
          }
        }
        resultados.push(resEscena1);

        // Regla de dependencia narrativa: si escena 1 falla, omitir escenas 2-4
        if (!resEscena1.estructura_valida || !resEscena1.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de escena_1 previa no produjo un resultado valido.';
          for (const opRestante of ['escena_2', 'escena_3', 'escena_4']) {
            const resDep = crearResultadoDependenciaFallida({
              idEjecucion: resolverIdEjecucion(adaptador.modelo, caso.id, rep, opRestante),
              adaptador,
              caso,
              repeticion: rep,
              nombreOperacion: opRestante,
              errorMsg: msgDep,
              esSimulado: esDryRun,
            });
            resultados.push(resDep);
            appendEvent({ type: 'operation_result', result: resDep });
          }
          continue;
        }

        historiaAcumulada += 'Inicio: ' + resEscena1.contenido_generado.contenido + '\n';

        if (!esDryRun && resEscena1.numero_solicitudes_http > 0) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 3: ESCENA 2
        const keyEscena2 = `${adaptador.modelo}___${caso.id}___${rep}___escena_2`;
        const previaEscena2 = previasMap.get(keyEscena2);
        const infoEscena2 = resolverInfoEjecucion(adaptador.modelo, caso.id, rep, 'escena_2');
        let resEscena2: ResultadoOperacion;

        if (reanudarActivo && previaEscena2 && previaEscena2.estructura_valida && previaEscena2.contenido_generado && (!previaEscena2.es_simulado || esDryRun)) {
          console.log('    [REANUDACIÓN] escena_2 (' + adaptador.modelo + ' - ' + caso.id + ') completada previamente con éxito.');
          resEscena2 = previaEscena2;
        } else if (cuotaAgotadaModelos.has(adaptador.modelo)) {
          resEscena2 = crearResultadoDependenciaFallida({
            idEjecucion: infoEscena2.idEjecucion,
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'escena_2',
            errorMsg: 'Omitida por agotamiento previo de cuota en este candidato (rate_limit / 429)',
            esSimulado: esDryRun,
          });
          resEscena2.error_categoria = 'rate_limit';
        } else {
          resEscena2 = await ejecutarOperacionIndividual({
            idEjecucion: infoEscena2.idEjecucion,
            esRecuperacion: infoEscena2.esRecuperacion,
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
          appendEvent({ type: 'operation_result', result: resEscena2 });
          if (resEscena2.error_categoria === 'rate_limit' || resEscena2.http_status === 429) {
            cuotaAgotadaModelos.add(adaptador.modelo);
            console.warn('    [SUSPENSIÓN DE CUOTA] Agotamiento de cuota detectado en ' + adaptador.modelo + '. Se omiten operaciones restantes.');
          }
        }
        resultados.push(resEscena2);

        // Regla de dependencia narrativa: si escena 2 falla, omitir escenas 3-4
        if (!resEscena2.estructura_valida || !resEscena2.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de escena_2 previa no produjo un resultado valido.';
          for (const opRestante of ['escena_3', 'escena_4']) {
            const resDep = crearResultadoDependenciaFallida({
              idEjecucion: resolverIdEjecucion(adaptador.modelo, caso.id, rep, opRestante),
              adaptador,
              caso,
              repeticion: rep,
              nombreOperacion: opRestante,
              errorMsg: msgDep,
              esSimulado: esDryRun,
            });
            resultados.push(resDep);
            appendEvent({ type: 'operation_result', result: resDep });
          }
          continue;
        }

        historiaAcumulada += 'Decision 1 (' + caso.decisionesFijas[0] + '): ' + resEscena2.contenido_generado.contenido + '\n';

        if (!esDryRun && resEscena2.numero_solicitudes_http > 0) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 4: ESCENA 3
        const keyEscena3 = `${adaptador.modelo}___${caso.id}___${rep}___escena_3`;
        const previaEscena3 = previasMap.get(keyEscena3);
        const infoEscena3 = resolverInfoEjecucion(adaptador.modelo, caso.id, rep, 'escena_3');
        let resEscena3: ResultadoOperacion;

        if (reanudarActivo && previaEscena3 && previaEscena3.estructura_valida && previaEscena3.contenido_generado && (!previaEscena3.es_simulado || esDryRun)) {
          console.log('    [REANUDACIÓN] escena_3 (' + adaptador.modelo + ' - ' + caso.id + ') completada previamente con éxito.');
          resEscena3 = previaEscena3;
        } else if (cuotaAgotadaModelos.has(adaptador.modelo)) {
          resEscena3 = crearResultadoDependenciaFallida({
            idEjecucion: infoEscena3.idEjecucion,
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'escena_3',
            errorMsg: 'Omitida por agotamiento previo de cuota en este candidato (rate_limit / 429)',
            esSimulado: esDryRun,
          });
          resEscena3.error_categoria = 'rate_limit';
        } else {
          resEscena3 = await ejecutarOperacionIndividual({
            idEjecucion: infoEscena3.idEjecucion,
            esRecuperacion: infoEscena3.esRecuperacion,
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
          appendEvent({ type: 'operation_result', result: resEscena3 });
          if (resEscena3.error_categoria === 'rate_limit' || resEscena3.http_status === 429) {
            cuotaAgotadaModelos.add(adaptador.modelo);
            console.warn('    [SUSPENSIÓN DE CUOTA] Agotamiento de cuota detectado en ' + adaptador.modelo + '. Se omiten operaciones restantes.');
          }
        }
        resultados.push(resEscena3);

        // Regla de dependencia narrativa: si escena 3 falla, omitir escena 4
        if (!resEscena3.estructura_valida || !resEscena3.contenido_generado) {
          const msgDep = 'No ejecutada porque la operacion de escena_3 previa no produjo un resultado valido.';
          const resDep = crearResultadoDependenciaFallida({
            idEjecucion: resolverIdEjecucion(adaptador.modelo, caso.id, rep, 'escena_4'),
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'escena_4',
            errorMsg: msgDep,
            esSimulado: esDryRun,
          });
          resultados.push(resDep);
          appendEvent({ type: 'operation_result', result: resDep });
          continue;
        }

        historiaAcumulada += 'Decision 2 (' + caso.decisionesFijas[1] + '): ' + resEscena3.contenido_generado.contenido + '\n';

        if (!esDryRun && resEscena3.numero_solicitudes_http > 0) {
          const espera = obtenerPacingMs(adaptador, delayEntreLlamadasMs);
          await sleep(espera);
        }

        // OPERACION 5: ESCENA 4 (FINAL)
        const keyEscena4 = `${adaptador.modelo}___${caso.id}___${rep}___escena_4`;
        const previaEscena4 = previasMap.get(keyEscena4);
        const infoEscena4 = resolverInfoEjecucion(adaptador.modelo, caso.id, rep, 'escena_4');
        let resEscena4: ResultadoOperacion;

        if (reanudarActivo && previaEscena4 && previaEscena4.estructura_valida && previaEscena4.contenido_generado && (!previaEscena4.es_simulado || esDryRun)) {
          console.log('    [REANUDACIÓN] escena_4 (' + adaptador.modelo + ' - ' + caso.id + ') completada previamente con éxito.');
          resEscena4 = previaEscena4;
        } else if (cuotaAgotadaModelos.has(adaptador.modelo)) {
          resEscena4 = crearResultadoDependenciaFallida({
            idEjecucion: infoEscena4.idEjecucion,
            adaptador,
            caso,
            repeticion: rep,
            nombreOperacion: 'escena_4',
            errorMsg: 'Omitida por agotamiento previo de cuota en este candidato (rate_limit / 429)',
            esSimulado: esDryRun,
          });
          resEscena4.error_categoria = 'rate_limit';
        } else {
          resEscena4 = await ejecutarOperacionIndividual({
            idEjecucion: infoEscena4.idEjecucion,
            esRecuperacion: infoEscena4.esRecuperacion,
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
          appendEvent({ type: 'operation_result', result: resEscena4 });
          if (resEscena4.error_categoria === 'rate_limit' || resEscena4.http_status === 429) {
            cuotaAgotadaModelos.add(adaptador.modelo);
            console.warn('    [SUSPENSIÓN DE CUOTA] Agotamiento de cuota detectado en ' + adaptador.modelo + '. Se omiten operaciones restantes.');
          }
        }
        resultados.push(resEscena4);

        if (!esDryRun && resEscena4.numero_solicitudes_http > 0) {
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

  // Generar manifest.json
  const fechaFinUtc = new Date().toISOString();
  let estadoFinal: 'COMPLETADO' | 'FALLO_CUOTA' | 'INCOMPLETO' | 'INTERRUMPIDO' = 'COMPLETADO';
  if (errores > 0) {
    const huboFalloCuota = resultados.some(
      (r) => r.error_categoria === 'rate_limit' || r.http_status === 429
    );
    estadoFinal = huboFalloCuota ? 'FALLO_CUOTA' : 'INCOMPLETO';
  } else if (resultados.length < totalOperacionesPrevistas) {
    estadoFinal = 'INTERRUMPIDO';
  }

  const manifest = {
    loteId: opts.loteNumero ? `lote_${String(opts.loteNumero).padStart(2, '0')}` : (opts.esPiloto ? 'piloto' : 'completo'),
    lote: opts.loteNumero ?? null,
    repeticion: opts.loteNumero
      ? obtenerDefinicionLote(opts.loteNumero).repeticion
      : (opts.repeticionExacta ?? (repeticionesLista.length === 1 ? repeticionesLista[0] : null)),
    repeticiones: repeticionesLista.length,
    fechaInicioUtc,
    fechaFinUtc,
    estado: estadoFinal,
    modo: esDryRun ? 'DRY_RUN' : 'REAL',
    esSimulado: esDryRun,
    casos: casos.map((c) => c.id),
    modelos: adaptadores.map((a) => a.modelo),
    operacionesPlanificadas: totalOperacionesPrevistas,
    operacionesEjecutadas: resultados.length,
    operacionesExitosas: exitosas,
    operacionesFallidas: errores,
    solicitudesHttpReales: llamadasReales,
    costoTeoricoTotalUsd,
    costoEfectivoTotalUsd,
    configuracionEfectiva: {
      google: { modelo: 'gemini-3.5-flash-lite', pacingMs: 5000 },
      groq_qwen: { modelo: 'qwen/qwen3.8-27b', pacingMs: 65000 },
      groq_gpt_oss: { modelo: 'openai/gpt-oss-20b', pacingMs: 15000 },
    },
    gitCommit: obtenerGitCommit(process.cwd()),
    hashesCodigo: obtenerHashesArchivosClave(process.cwd()),
  };

  try {
    fs.writeFileSync(path.join(carpetaSalida, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  } catch {}

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
  esRecuperacion?: boolean;
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
      cumple_primer_intento: !p.esRecuperacion,
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

        // Soporte de espera por Retry-After si la API devuelve 429 o 503 con encabezado válido <= 70s
        if (
          p.permitirRetry !== false &&
          intento === 0 &&
          (errApi.status === 429 || errApi.categoria === 'rate_limit' || errApi.status === 503) &&
          errApi.retryAfterMs &&
          errApi.retryAfterMs > 0 &&
          errApi.retryAfterMs <= 70000
        ) {
          console.log(`    [ESPERA RETRY-AFTER] HTTP ${errApi.status}. Esperando ${Math.round(errApi.retryAfterMs / 1000)}s antes de reintentar según encabezado...`);
          await sleep(errApi.retryAfterMs);
          intento++;
          reintentos = 1;
          continue;
        }

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

  const cumplePrimerIntento = !p.esRecuperacion && estructuraValida && reintentos === 0;

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
    reasoning_config: rawResp?.reasoningConfig || 'low',
    structured_output_mode: rawResp?.structuredOutputMode || 'json_schema',
    es_simulado: false,
    contenido_generado: parsedJson,
  };
}
