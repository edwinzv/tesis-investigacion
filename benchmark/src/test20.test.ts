import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AdaptadorModelo } from './adaptadores/base.js';
import { ApiCallError, type RawModelResponse } from './types.js';
import { CASOS_TEST20, MODELOS_TEST20, LimiteTest20, validarArgumentos, planTest20, ejecutarTest20, crearRegistroExclusivo, crearTransporteTest20 } from './test20.js';
import { ejecutarOperacionIndividual } from './runner.js';
import { SCHEMAS, validarStoryAnalysis } from './contratos.js';
import { construirPromptAnalisis } from './prompts.js';

const root = process.cwd();
const temp = 'C:/Users/Ignacia/AppData/Local/Temp/opencode';
const {casos} = planTest20(root);
const analysis = {titulo:'Título', tituloOriginal:'Título', protagonista:'Niña', descripcionProtagonista:'Curiosa', resumen:'Resumen', escenario:'Bosque', conflicto:'Problema', finalOriginal:'Resolución'};
class Mock extends AdaptadorModelo {
  readonly id: string;
  readonly proveedor: string;
  readonly tarifaInputUsdPorMillon = null;
  readonly tarifaOutputUsdPorMillon = null;
  readonly tarifaFuenteRuntime = null;
  readonly freeTierActivo = false;
  calls = 0;
  constructor(readonly modelo: string, readonly failure?: number | 'malformed' | 'interrupt') {
    super(); this.id = modelo; this.proveedor = modelo === MODELOS_TEST20[0] ? 'Google' : 'Groq';
  }
  async verificarDisponibilidad(): Promise<never> { throw new Error('No catalog/preflight'); }
  async ejecutarLlamada(_prompt: unknown, schema: any): Promise<RawModelResponse> {
    this.calls++;
    if (typeof this.failure === 'number') throw new ApiCallError({status:this.failure, message:'mock error', latencyMs:1, isNonRetryable:false, categoria:this.failure === 429 ? 'rate_limit' : this.failure === 400 ? 'invalid_request' : this.failure === 404 ? 'model_not_found' : this.failure === 402 ? 'billing' : 'authentication'});
    if (this.failure === 'interrupt') throw new Error('mock interruption');
    const final = schema === SCHEMAS.escenaFinal;
    const value: any = schema === SCHEMAS.analisis ? analysis : {contenido:'Relato', opciones:final ? [] : ['A','B','C'], esFinal:final};
    // Extract the prescribed option from the scene schema (the prompt is tested below with corpus fixtures).
    if (!final && schema !== SCHEMAS.analisis) {
      const prompt = JSON.stringify(_prompt).split('REGLA EXPERIMENTAL OBLIGATORIA:').at(-1)!;
      const decision = casos.flatMap(c=>c.decisionesFijas).find(d=>prompt.includes(d));
      value.opciones = [decision ?? 'A','Otra opción B','Otra opción C'];
    }
    return {rawText:this.failure === 'malformed' ? '{bad' : JSON.stringify(value), status:200, latencyMs:1,
      usage:{tokensEntrada:null,tokensSalida:null,tokensRazonamiento:null,tokensSalidaFacturables:null,tokensTotales:null,tokensDisponibles:false}, structuredOutputMode:'json_schema'};
  }
}
function mocks(failure?: number | 'malformed') { return MODELOS_TEST20.map((id,i)=>new Mock(id,i===0 ? failure : undefined)); }
const noSleep = async () => {};

test('strict CLI rejects unknown, duplicates and invalid combinations before execution', () => {
  for (const args of [[], ['--pilot','--oops'],['--test20','--pilot'],['--pilot','--full'],['--preflight','--dry-run'],['--test20','--execute-test20'],['--test20','--budget-validated-external'],['--execute-test20'],['--test20','--test20'],['--test20','--dry-run','--execute-test20','--budget-validated-external']]) assert.throws(()=>validarArgumentos(args));
  for (const args of [['--test20'],['--test20','--dry-run'],['--test20','--execute-test20','--budget-validated-external'],['--pilot'],['--pilot','--dry-run'],['--full'],['--dry-run']]) assert.doesNotThrow(()=>validarArgumentos(args));
});

test('SAFE subprocess blocks credentials, dotenv, provider constructors, fetch and target writes', () => {
  const cli = path.join(root,'node_modules/tsx/dist/cli.mjs');
  assert.equal(fs.existsSync(temp),true);
  const guard = path.join(temp,'test20-prep-safe-guard-'+randomUUID()+'.cjs');
  fs.writeFileSync(guard, `
const fs = require('node:fs');
const Module = require('node:module');
const read = fs.readFileSync;
fs.readFileSync = function(file,...rest) {
  if (String(file).replaceAll('\\\\','/').match(/\\/\\.env(?:$|\\.)/)) throw new Error('GUARD dotenv read');
  return read.call(this,file,...rest);
};
for (const method of ['writeFileSync','appendFileSync','mkdirSync','openSync','copyFileSync']) {
  const old = fs[method];
  fs[method] = function(file,...rest) {
    if (String(file).replaceAll('\\\\','/').includes('/tesis_investigacion/') && (method !== 'openSync' || rest[0] !== 'r')) throw new Error('GUARD target write');
    return old.call(this,file,...rest);
  };
}
const env = process.env;
process.env = new Proxy(env,{get(target,key) {
  if (/API_KEY|TOKEN|SECRET|PASSWORD/.test(String(key))) throw new Error('GUARD credential access');
  return target[key];
}});
globalThis.fetch = () => { throw new Error('GUARD network'); };
const load = Module._load;
Module._load = function(request,...args) {
  if (/adaptadores\\/(google|groq|groq_gpt_oss)\\.js$/.test(request)) {
    const blocked = class { constructor() { throw new Error('GUARD provider constructor'); } };
    return {AdaptadorGoogle:blocked,AdaptadorGroq:blocked,AdaptadorGroqGptOss:blocked};
  }
  return load.call(this,request,...args);
};
`,{flag:'wx'});
  const r = spawnSync(process.execPath,['--require',guard,cli,'benchmark/run_benchmark.ts','--test20'],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.mode,'SAFE'); assert.equal(plan.actualHttpCalls,0); assert.deepEqual(plan.outputFiles,[]);
  assert.equal(plan.plannedOperations,60); assert.deepEqual(plan.selectedCases,CASOS_TEST20);
  assert.equal(plan.effectiveParameters.maxOutputTokens,2048);
  for (const args of [['--test20','--typo'],['--test20','--execute-test20'],['--pilot','--full']]) {
    const invalid = spawnSync(process.execPath,['--require',guard,cli,'benchmark/run_benchmark.ts',...args],{cwd:root,encoding:'utf8'});
    assert.notEqual(invalid.status,0);
    assert.match(invalid.stderr,/Argumentos|requiere|Combinación/);
    assert.doesNotMatch(invalid.stderr,/GUARD/);
  }
});

test('inspected real adapters use single mocked fetch, unchanged parameters, no credential access or redirect', async () => {
  const [{AdaptadorGoogle},{AdaptadorGroq},{AdaptadorGroqGptOss}] = await Promise.all([
    import('./adaptadores/google.js'),import('./adaptadores/groq.js'),import('./adaptadores/groq_gpt_oss.js'),
  ]);
  const adapters = [new AdaptadorGoogle(),new AdaptadorGroq(),new AdaptadorGroqGptOss()];
  for (const a of adapters) (a as any).obtenerApiKey = ()=>'LOCAL_MOCK_NOT_A_KEY';
  const original = globalThis.fetch;
  const requests: {url:string; init:RequestInit}[] = [];
  const transport = crearTransporteTest20(async (url,init)=>{
    requests.push({url:String(url),init:init!});
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(analysis)}]}}],choices:[{message:{content:JSON.stringify(analysis)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  });
  globalThis.fetch = transport.fetch;
  try {
    for(const a of adapters) {
      transport.envolver(a);
      await a.ejecutarLlamada(construirPromptAnalisis(casos[0].textoFuente),SCHEMAS.analisis,'analisis');
    }
    assert.equal(requests.length,3);
    for(const r of requests) { assert.equal(r.init.redirect,'error'); assert.equal(r.init.method,'POST'); assert.doesNotMatch(r.url,/\/models$/); }
    const google = JSON.parse(String(requests[0].init.body));
    assert.equal(google.generationConfig.maxOutputTokens,2048); assert.deepEqual(google.generationConfig.thinkingConfig,{thinkingLevel:'low'});
    for(const r of requests.slice(1)) {
      const body = JSON.parse(String(r.init.body));
      assert.equal(body.max_completion_tokens,2048); assert.equal(body.reasoning_effort,'low'); assert.equal(body.reasoning_format,'hidden'); assert.equal(body.response_format.json_schema.strict,true);
    }
    await assert.rejects(globalThis.fetch('https://local.invalid'),/TEST20_UNEXPECTED_HTTP/);
    const extra = new Mock(MODELOS_TEST20[0]);
    extra.ejecutarLlamada = async ()=>{
      await globalThis.fetch('https://local.invalid');
      await globalThis.fetch('https://local.invalid');
      throw new Error('unreachable');
    };
    transport.envolver(extra);
    await assert.rejects(extra.ejecutarLlamada({},{}),/TEST20_UNEXPECTED_HTTP/);
    assert.equal(requests.length,4); // The second fetch never reaches the mock transport.
  } finally { globalThis.fetch = original; }
});

test('selection: exactly 60 operations, 20 calls per candidate, pacing preserved, no cost assumptions', async () => {
  const adapters = mocks(); const events: any[] = []; const delays: number[] = [];
  const rows = await ejecutarTest20(adapters,casos,e=>events.push(e),async ms=>{delays.push(ms);});
  assert.equal(rows.length,60); assert.deepEqual(adapters.map(a=>a.calls),[20,20,20]);
  assert.equal(rows.filter(r=>r.estructura_valida).length,60);
  assert.equal(events.filter(e=>e.type==='attempt_start').length,60);
  assert.deepEqual(delays,[...Array(19).fill(2000),...Array(19).fill(65000),...Array(19).fill(15000)]);
  for (const r of rows) { assert.equal(r.numero_reintentos,0); assert.equal(r.costo_teorico_usd,null); assert.equal(r.free_tier_activo,null); }
  assert.deepEqual(events.at(-1).counters,{total:60,porModelo:Object.fromEntries(MODELOS_TEST20.map(id=>[id,20]))});
});

test('hard cap prevents candidate call 21 and total call 61; unknown candidate rejected', async () => {
  const cap = new LimiteTest20();
  for (const id of MODELOS_TEST20) { for (let n=0;n<20;n++) cap.reservar(id); assert.throws(()=>cap.reservar(id),/HTTP_CAP/); }
  assert.equal(cap.total,60); assert.throws(()=>cap.reservar('other'));
  const prefilled = new LimiteTest20(); for(let n=0;n<20;n++) prefilled.reservar(MODELOS_TEST20[0]);
  const adapters = mocks(); const events: any[] = [];
  const rows = await ejecutarTest20(adapters,casos,e=>events.push(e),noSleep,prefilled);
  assert.equal(adapters[0].calls,0); assert.equal(rows.slice(0,20).every(r=>r.numero_solicitudes_http===0),true);
  assert.equal(prefilled.total,60); assert.equal(events.some(e=>e.stopReason==='HTTP_CAP'),true);
});

test('malformed JSON has no retry, four dependent scenes omitted; subsequent cases continue', async () => {
  const adapters = mocks('malformed'); const events: any[] = [];
  const rows = await ejecutarTest20(adapters,casos,e=>events.push(e),noSleep);
  assert.equal(adapters[0].calls,4);
  assert.equal(rows.slice(0,20).filter(r=>r.error_categoria==='dependency_failed').length,16);
  assert.equal(rows.slice(0,20).filter(r=>r.estructura_valida).length,0);
  assert.equal(rows.every(r=>r.numero_reintentos===0),true);
  assert.equal(events.filter(e=>e.type==='attempt_response').length,44);
  assert.deepEqual(adapters.slice(1).map(a=>a.calls),[20,20]);
});

for (const status of [429,400,401,402,403,404]) test('HTTP '+status+' stops candidate, logs omissions, other candidates continue', async () => {
  const adapters = mocks(status); const events: any[] = [];
  const rows = await ejecutarTest20(adapters,casos,e=>events.push(e),noSleep);
  assert.deepEqual(adapters.map(a=>a.calls),[1,20,20]);
  assert.equal(rows[0].http_status,status);
  assert.equal(rows.slice(1,20).every(r=>r.numero_solicitudes_http===0 && r.error_categoria==='candidate_stopped' && !r.contenido_generado),true);
  assert.equal(events.filter(e=>e.type==='candidate_stop').length,1);
  assert.equal(events.at(-1).counters.total,41);
});

test('legacy operation retains corrective retry, TEST20 disables it', async () => {
  const adapter = new Mock(MODELOS_TEST20[0],'malformed');
  const p = {idEjecucion:'test',adaptador:adapter,caso:casos[0],repeticion:1,nombreOperacion:'analisis',prompt:construirPromptAnalisis(casos[0].textoFuente),schema:SCHEMAS.analisis,tipoContrato:'analisis' as const,validador:validarStoryAnalysis,esDryRun:false};
  const legacy = await ejecutarOperacionIndividual(p); assert.equal(legacy.numero_reintentos,1); assert.equal(adapter.calls,2);
  const reduced = await ejecutarOperacionIndividual({...p,permitirRetry:false}); assert.equal(reduced.numero_reintentos,0); assert.equal(adapter.calls,3);
});

test('exclusive folder rejects reuse/traversal and interruption preserves incremental JSONL', async () => {
  assert.equal(fs.existsSync(temp),true);
  const parent = path.join(temp,'test20-prep-test-'+randomUUID());
  const log = crearRegistroExclusivo(parent,{label:'TEST_FIXTURE'},'UTC_fixture');
  assert.throws(()=>crearRegistroExclusivo(parent,{},'UTC_fixture'));
  assert.throws(()=>crearRegistroExclusivo(parent,{},'../escape'));
  const adapters = mocks(); let interrupted = false;
  await assert.rejects(ejecutarTest20(adapters,casos,e=>log.append(e),async ()=>{interrupted=true; throw new Error('mock SIGINT');}),/mock SIGINT/);
  log.close(); assert.equal(interrupted,true);
  const events = fs.readFileSync(path.join(log.dir,'events.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(events.filter(e=>e.type==='attempt_start').length,1);
  assert.equal(events.filter(e=>e.type==='operation').length,1);
  assert.equal(events.at(-1).type,'interrupted'); assert.equal(events.at(-1).counters.total,1);
  assert.equal(events.some(e=>e.type==='complete'),false);
  assert.equal(fs.existsSync(path.join(log.dir,'ejecuciones_raw.csv')),false);
});
