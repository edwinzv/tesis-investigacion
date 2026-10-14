import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AdaptadorModelo } from './adaptadores/base.js';
import type { ApiCallError, CasoEstudio, ResultadoOperacion, StoryAnalysis } from './types.js';
import { crearResultadoDependenciaFallida, ejecutarOperacionIndividual, ErrorPersistenciaFatal, type OperacionParams } from './runner.js';
import { SCHEMAS, validarStoryAnalysis, validarEscenaIntermedia, validarEscenaFinal } from './contratos.js';
import { construirPromptAnalisis, construirPromptEscena1, construirPromptEscenaIntermedia, construirPromptEscenaFinal } from './prompts.js';
import { exportarEjecucionesCsv } from './reportes.js';

export const CASOS_TEST20 = ['caso_01_misterio_agua', 'caso_02_robot_cielo', 'caso_03_arbol_hueco', 'caso_04_cometa_viento'];
export const MODELOS_TEST20 = ['gemini-3.8-flash', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const OPERACIONES = ['analisis', 'escena_1', 'escena_2', 'escena_3', 'escena_4'];
const LABEL = 'ENSAYOOPERATIVOREDUCIDO';

// Only provider-returned error text is inspected; never request headers, URLs or process.env.
export function sanitizarErrorTest20(error: ApiCallError) {
  const redactions: {kind: string; path: string}[] = [];
  const secrets = new Set<string>();
  const sensitiveKey = (key: string) => /^(?:key|apikey|password|passwd|pwd|secret|clientsecret|authorization|proxyauthorization|token|accesstoken|refreshtoken|idtoken|credential|credentials)$/.test(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const remember = (value: unknown): void => {
    if (typeof value === 'string' && value) secrets.add(value);
    else if (Array.isArray(value)) value.forEach(remember);
    else if (value && typeof value === 'object') Object.values(value).forEach(remember);
  };
  const scrub = (text: string, location: string) => {
    let clean = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/%=-]+/gi, value => {
      secrets.add(value.replace(/^Bearer\s+/i, ''));
      redactions.push({kind: 'bearer', path: location}); return 'Bearer [REDACTED]';
    });
    clean = clean.replace(/((?:["']?)(?:api[_-]?key|key|password|passwd|pwd|secret|client[_-]?secret|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|token)(?:["']?)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;<>"']+)/gi, (_match, prefix: string, value: string) => {
      remember(value.replace(/^["']|["']$/g, ''));
      redactions.push({kind: 'named_assignment', path: location}); return prefix + '[REDACTED]';
    });
    clean = clean.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})\b/g, value => {
      remember(value); redactions.push({kind: 'credential_pattern', path: location}); return '[REDACTED]';
    });
    return clean;
  };
  const bodyAvailable = typeof error.rawBody === 'string';
  let parsed: any;
  let isJson = false;
  if (bodyAvailable) { try { parsed = JSON.parse(error.rawBody!); isJson = true; } catch {} }
  const redactFields = (value: any, location: string): any => {
    if (Array.isArray(value)) return value.map((v, i) => redactFields(v, location + '[' + i + ']'));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => {
      const fieldPath = location + '.' + key;
      if (sensitiveKey(key) && v !== null) {
        remember(v); redactions.push({kind: 'sensitive_field', path: fieldPath}); return [key, '[REDACTED]'];
      }
      return [key, redactFields(v, fieldPath)];
    }));
    return typeof value === 'string' ? scrub(value, location) : value;
  };
  const body = isJson ? JSON.stringify(redactFields(parsed, 'rawBody')) : bodyAvailable ? scrub(error.rawBody!, 'rawBody') : null;
  const message = scrub(error.message, 'message');
  // Also remove echoed credential values from diagnostic strings outside sensitive fields.
  const removeEchoes = (text: string | null, location: string) => {
    if (text === null) return null;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(secret.length < 4 ? '\\b' + escaped + '\\b' : escaped, 'g');
      text = text.replace(pattern, () => { redactions.push({kind: 'credential_echo', path: location}); return '[REDACTED]'; });
    }
    return text;
  };
  return {
    status: error.status ?? null, category: error.categoria, message: removeEchoes(message, 'message')!,
    rawBody: removeEchoes(body, 'rawBody'), rawBodyAvailable: bodyAvailable,
    rawBodySha256: bodyAvailable ? createHash('sha256').update(error.rawBody!, 'utf8').digest('hex') : null,
    rawBodyBytes: bodyAvailable ? Buffer.byteLength(error.rawBody!, 'utf8') : null,
    sanitizationPolicy: 'provider-error-v1', bodyFormat: isJson ? 'json' : bodyAvailable ? 'text' : 'unavailable', redactions,
  };
}

export function validarArgumentos(args: string[]): void {
  const conocidos = ['--test20', '--execute-test20', '--budget-validated-external', '--dry-run', '--pilot', '--full', '--preflight', '--check-providers'];
  if (!args.length || args.some(a => !conocidos.includes(a)) || new Set(args).size !== args.length) {
    throw new Error('Argumentos ausentes, desconocidos o duplicados; ninguna llamada autorizada.');
  }
  if (args.includes('--test20')) {
    if (args.some(a => !['--test20', '--dry-run', '--execute-test20', '--budget-validated-external'].includes(a))) throw new Error('TEST20 no se combina con otros modos.');
    const real = args.includes('--execute-test20');
    const budget = args.includes('--budget-validated-external');
    if (real !== budget || (real && args.includes('--dry-run'))) throw new Error('Ejecución TEST20 requiere bandera real y presupuesto/cuota validados externamente; incompatible con dry-run.');
    return;
  }
  if (args.includes('--execute-test20') || args.includes('--budget-validated-external')) throw new Error('Bandera exclusiva de TEST20.');
  const modos = args.filter(a => ['--pilot', '--full', '--preflight', '--check-providers'].includes(a));
  if (modos.length > 1 || (args.includes('--dry-run') && modos.some(a => ['--preflight', '--check-providers'].includes(a)))) throw new Error('Combinación de modos inválida.');
}

export function planTest20(root: string) {
  const casos = CASOS_TEST20.map(id => {
    const c = JSON.parse(fs.readFileSync(path.join(root, 'benchmark/casos', id + '.json'), 'utf8').replace(/^\uFEFF/, '')) as CasoEstudio;
    if (c.id !== id || c.decisionesFijas.length !== 3) throw new Error('Corpus TEST20 incompatible: ' + id);
    return c;
  });
  const hashes: Record<string, string> = {};
  // Config JSON is archived as documentary input, not loaded as runtime configuration.
  const files = [
    ...fs.readdirSync(path.join(root, 'benchmark/casos')).filter(f => f.endsWith('.json')).map(f => 'benchmark/casos/' + f),
    'benchmark/config/benchmark.config.json', 'benchmark/config/modelos.config.json',
    'benchmark/src/prompts.ts', 'benchmark/src/contratos.ts', 'benchmark/src/runner.ts',
    'benchmark/src/test20.ts', 'benchmark/run_benchmark.ts', 'benchmark/src/adaptadores/base.ts',
    'benchmark/src/adaptadores/google.ts', 'benchmark/src/adaptadores/groq.ts', 'benchmark/src/adaptadores/groq_gpt_oss.ts',
  ];
  for (const f of files) hashes[f] = createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
  let localHead: string | null = null;
  try { localHead = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(); } catch {}
  return {
    casos,
    manifest: {
      label: LABEL, comparisonFinal: false, createdUtc: new Date().toISOString(),
      selectedCases: CASOS_TEST20, omittedCases: files.filter(f => f.startsWith('benchmark/casos/') && !CASOS_TEST20.some(id => f.endsWith(id + '.json'))),
      models: MODELOS_TEST20, repetitions: 1, operationsPerCase: OPERACIONES,
      plannedOperations: 60, candidateHttpCap: 20, totalHttpCap: 60, retry: false,
      effectiveParameters: {source: 'adapter code, not config JSON', maxOutputTokens: 2048,
        google: {thinkingLevel: 'low', responseMimeType: 'application/json', responseSchema: 'existing sanitizer'},
        groq: {reasoning_effort: 'low', reasoning_format: 'hidden', response_format: 'json_schema', strict: true},
        pacingMs: [2000, 65000, 15000], temperature: 'omitted', topP: 'omitted', timeoutMs: null, durationLimitMs: null},
      budget: 'pending external validation; no economic ceiling implemented', costs: 'unknown', freeTier: 'unknown',
      exclusions: ['C2', 'C3', 'C5', 'human evaluation', 'case aggregation', 'final comparison', 'preflight', 'catalog'],
      version: {verifiedLocalHead: localHead, provenance: 'local checkout; hashes identify dirty/untracked code, no original-owner attribution'},
      environment: {node: process.version, platform: process.platform, arch: process.arch}, hashes,
    },
  };
}

export class LimiteTest20 {
  total = 0;
  porModelo = new Map<string, number>();
  reservar(modelo: string): void {
    if (!MODELOS_TEST20.includes(modelo) || this.total >= 60 || (this.porModelo.get(modelo) ?? 0) >= 20) throw new Error('HTTP_CAP');
    this.total++;
    this.porModelo.set(modelo, (this.porModelo.get(modelo) ?? 0) + 1);
  }
  estado() { return {total: this.total, porModelo: Object.fromEntries(this.porModelo)}; }
}

export function crearRegistroExclusivo(parent: string, manifest: object, uid = new Date().toISOString().replace(/[:.]/g, '-') + '_' + randomUUID()) {
  if (!/^[A-Za-z0-9_-]+$/.test(uid)) throw new Error('UID inválido');
  if (!fs.existsSync(parent)) fs.mkdirSync(parent); // Never recursively create arbitrary ancestor paths.
  const dir = path.join(parent, uid);
  fs.mkdirSync(dir); // EEXIST fails; never resume/reuse an existing run.
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), {flag: 'wx'});
  const fd = fs.openSync(path.join(dir, 'events.jsonl'), 'ax');
  let cerrado = false;
  return {
    dir,
    append(event: object) {
      if (cerrado) throw new Error('Registro cerrado');
      fs.writeSync(fd, JSON.stringify({utc: new Date().toISOString(), ...event}) + '\n');
      fs.fsyncSync(fd);
    },
    close() { if (!cerrado) { fs.closeSync(fd); cerrado = true; } },
  };
}

export function crearTransporteTest20(originalFetch: typeof fetch, onDispatch: (model: string) => void = () => {}) {
  let permits = 0;
  let activeModel = '';
  let persistenceFailure: ErrorPersistenciaFatal | null = null;
  return {
    fetch: (async (input, init) => {
      if (persistenceFailure) throw persistenceFailure;
      if (permits !== 1) throw new Error('TEST20_UNEXPECTED_HTTP');
      permits = 0;
      try { onDispatch(activeModel); } catch {
        persistenceFailure = new ErrorPersistenciaFatal();
        throw persistenceFailure;
      }
      return originalFetch(input, {...init, redirect: 'error'});
    }) as typeof fetch,
    envolver(adaptador: AdaptadorModelo) {
      const call = adaptador.ejecutarLlamada.bind(adaptador);
      adaptador.ejecutarLlamada = async (...params) => {
        if (persistenceFailure) throw persistenceFailure;
        if (permits !== 0) throw new Error('TEST20_CONCURRENT_ADAPTER');
        permits = 1;
        activeModel = adaptador.modelo;
        try {
          const response = await call(...params);
          if (persistenceFailure) throw persistenceFailure;
          return response;
        } catch (error) {
          // Adapters wrap fetch failures as ApiCallError; restore the latched fatal persistence error.
          if (persistenceFailure) throw persistenceFailure;
          throw error;
        } finally { permits = 0; activeModel = ''; }
      };
    },
  };
}

type EventSink = (event: object) => void;
export async function ejecutarTest20(adaptadores: AdaptadorModelo[], casos: CasoEstudio[], append: EventSink,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  limite = new LimiteTest20()) {
  if (adaptadores.map(a => a.modelo).join('|') !== MODELOS_TEST20.join('|') || casos.map(c => c.id).join('|') !== CASOS_TEST20.join('|')) throw new Error('Selección TEST20 inválida');
  const sink = append;
  append = event => {
    try { sink(event); } catch { throw new ErrorPersistenciaFatal(); }
  };
  const resultados: ResultadoOperacion[] = [];
  let id = 0;
  const emitir = (r: ResultadoOperacion, reason: string | null) => {
    // Do not transfer unverified tariffs/free-tier assertions into this operational trial.
    const limpio = {...r, tarifa_input_usd_por_millon: null, tarifa_output_usd_por_millon: null,
      tarifa_fuente_runtime: null, costo_entrada_usd: null, costo_salida_usd: null,
      costo_teorico_usd: null, costo_efectivo_experimento_usd: null, free_tier_activo: null};
    resultados.push(limpio as unknown as ResultadoOperacion); // Existing CSV writer renders null as an empty cell.
    append({type: 'operation', result: limpio, stopReason: reason, counters: limite.estado()});
  };
  try {
    for (const adaptador of adaptadores) {
      let stop: string | null = null;
      let called = false;
      for (const caso of casos) {
        let analysis: StoryAnalysis | null = null;
        let historia = '';
        let dependency: string | null = null;
        for (let n = 0; n < 5; n++) {
          const common = {idEjecucion: 'ejec_' + (++id), adaptador, caso, repeticion: 1, nombreOperacion: OPERACIONES[n], esDryRun: false};
          if (stop || dependency) {
            const r = crearResultadoDependenciaFallida({...common, esSimulado: false, errorMsg: stop ?? dependency!});
            if (stop) r.error_categoria = 'candidate_stopped';
            emitir(r, stop);
            continue;
          }
          let operation: Pick<OperacionParams, 'prompt' | 'schema' | 'tipoContrato' | 'validador' | 'decisionControladaSiguiente'>;
          if (n === 0) operation = {prompt: construirPromptAnalisis(caso.textoFuente), schema: SCHEMAS.analisis, tipoContrato: 'analisis', validador: validarStoryAnalysis};
          else if (n === 4) operation = {prompt: construirPromptEscenaFinal(historia, caso.decisionesFijas[2]), schema: SCHEMAS.escenaFinal, tipoContrato: 'escena_final', validador: validarEscenaFinal};
          else {
            const decision = caso.decisionesFijas[n - 1];
            operation = {prompt: n === 1 ? construirPromptEscena1(analysis!, decision) : construirPromptEscenaIntermedia(historia, caso.decisionesFijas[n - 2], n, decision),
              schema: SCHEMAS.escena, tipoContrato: 'escena_intermedia', decisionControladaSiguiente: decision, validador: data => validarEscenaIntermedia(data, decision)};
          }
          if (called) await sleep(adaptador.modelo === MODELOS_TEST20[1] ? 65000 : adaptador.proveedor === 'Groq' ? 15000 : 2000);
          try { limite.reservar(adaptador.modelo); } catch {
            stop = 'HTTP_CAP';
            append({type: 'candidate_stop', model: adaptador.modelo, stopReason: stop, counters: limite.estado()});
            const r = crearResultadoDependenciaFallida({...common, esSimulado: false, errorMsg: stop});
            r.error_categoria = 'candidate_stopped'; emitir(r, stop); continue;
          }
          // Durable reservation before entering the actual adapter; incomplete attempts remain visible on interruption.
          append({type: 'attempt_start', model: adaptador.modelo, case: caso.id, operation: common.nombreOperacion, id: common.idEjecucion, counters: limite.estado()});
          called = true;
          let safeError: ReturnType<typeof sanitizarErrorTest20> | null = null;
          const r = await ejecutarOperacionIndividual({...common, ...operation, permitirRetry: false, propagarFallosPersistencia: true,
            registrarRespuesta: response => append({type: 'attempt_response', id: common.idEjecucion, response, counters: limite.estado()}),
            registrarErrorApi: error => {
              safeError = sanitizarErrorTest20(error);
              append({type: 'attempt_error_response', id: common.idEjecucion, model: adaptador.modelo,
                case: caso.id, operation: common.nombreOperacion, response: safeError, counters: limite.estado()});
            }});
          // Never leak the original provider error message through operation JSONL or derived CSV.
          if (safeError) r.error = (safeError as ReturnType<typeof sanitizarErrorTest20>).message;
          if ([400, 401, 402, 403, 404, 429].includes(r.http_status ?? 0) || ['rate_limit', 'authentication', 'billing', 'model_not_found', 'invalid_request'].includes(r.error_categoria)) stop = 'HTTP_' + r.http_status + ':' + r.error_categoria;
          emitir(r, stop);
          if (stop) append({type: 'candidate_stop', model: adaptador.modelo, stopReason: stop, counters: limite.estado()});
          if (!r.estructura_valida || !r.contenido_generado) dependency = 'Dependencia fallida: ' + common.nombreOperacion;
          else if (n === 0) analysis = r.contenido_generado as StoryAnalysis;
          else if (n === 1) historia += 'Inicio: ' + r.contenido_generado.contenido + '\n';
          else if (n < 4) historia += 'Decision ' + (n - 1) + ' (' + caso.decisionesFijas[n - 2] + '): ' + r.contenido_generado.contenido + '\n';
        }
      }
      append({type: 'candidate_end', model: adaptador.modelo, stopReason: stop, counters: limite.estado()});
    }
    append({type: 'complete', counters: limite.estado(), operations: resultados.length, costs: 'unknown'});
    return resultados;
  } catch (error) {
    try { sink({type: 'interrupted', stopReason: error instanceof ErrorPersistenciaFatal ? 'persistence_fatal' : 'local_exception', counters: limite.estado()}); } catch {}
    throw error;
  }
}

export async function ejecutarTest20Cli(args: string[]): Promise<void> {
  validarArgumentos(args);
  const root = process.cwd();
  const {casos, manifest} = planTest20(root);
  if (!args.includes('--execute-test20')) {
    console.log(JSON.stringify({...manifest, mode: 'SAFE', actualHttpCalls: 0, outputFiles: []}, null, 2));
    return;
  }
  // The flag is an external attestation, not verification of a tariff, quota or monetary ceiling.
  const registro = crearRegistroExclusivo(path.join(root, 'benchmark/resultados_ensayo'), {...manifest, mode: 'REAL', budget: 'operator attests external budget/quota validation'});
  const limite = new LimiteTest20();
  const originalFetch = globalThis.fetch;
  const dispatched = new Map<string, number>();
  // Exactly one direct fetch per adapter invocation. No redirect chain, catalog or hidden retries.
  const transporte = crearTransporteTest20(originalFetch, model => {
    dispatched.set(model, (dispatched.get(model) ?? 0) + 1);
    registro.append({type: 'http_dispatch', model, dispatchedHttp: Object.fromEntries(dispatched), counters: limite.estado()});
  });
  globalThis.fetch = transporte.fetch;
  const onSignal = (signal: string) => {
    try { registro.append({type: 'interrupted', stopReason: signal, counters: limite.estado()}); } finally { registro.close(); process.exit(130); }
  };
  const sigint = () => onSignal('SIGINT');
  const sigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', sigint); process.once('SIGTERM', sigterm);
  try {
    // Lazy imports/construction only in explicitly authorized real mode; no dotenv/autoload.
    const [{AdaptadorGoogle}, {AdaptadorGroq}, {AdaptadorGroqGptOss}] = await Promise.all([
      import('./adaptadores/google.js'), import('./adaptadores/groq.js'), import('./adaptadores/groq_gpt_oss.js'),
    ]);
    const adaptadores = [new AdaptadorGoogle(), new AdaptadorGroq(), new AdaptadorGroqGptOss()];
    for (const a of adaptadores) transporte.envolver(a);
    await ejecutarTest20(adaptadores, casos, e => registro.append(e), undefined, limite);
    const events = fs.readFileSync(path.join(registro.dir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const rows = events.filter(e => e.type === 'operation').map(e => e.result) as ResultadoOperacion[];
    const staging = path.join(registro.dir, 'csv_derivation');
    fs.mkdirSync(staging);
    const csv = exportarEjecucionesCsv(rows, staging);
    fs.copyFileSync(csv, path.join(registro.dir, 'ejecuciones_raw.csv'), fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(csv); fs.rmdirSync(staging);
    registro.append({type: 'csv_derived', file: 'ejecuciones_raw.csv'});
    console.log(registro.dir);
  } catch (error) {
    try { registro.append({type: 'fatal', stopReason: error instanceof ErrorPersistenciaFatal ? 'persistence_fatal' : 'local_exception', counters: limite.estado()}); } catch {}
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
    process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm);
    registro.close();
  }
}
