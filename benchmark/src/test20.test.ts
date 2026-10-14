import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { AdaptadorModelo } from './adaptadores/base.js';
import { ApiCallError, type RawModelResponse } from './types.js';
import { CASOS_TEST20, MODELOS_TEST20, LimiteTest20, validarArgumentos, planTest20, ejecutarTest20, crearRegistroExclusivo, crearTransporteTest20, sanitizarErrorTest20 } from './test20.js';
import { ejecutarOperacionIndividual, ErrorPersistenciaFatal } from './runner.js';
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

test('interruption after durable attempt reservation leaves no fabricated operation or success', async () => {
  const adapters = mocks(); const events: any[] = [];
  await assert.rejects(ejecutarTest20(adapters,casos,e=>{
    events.push(e);
    if ((e as any).type==='attempt_start') throw new Error('mock abrupt interruption');
  },noSleep),ErrorPersistenciaFatal);
  assert.equal(adapters[0].calls,0);
  assert.equal(events[0].type,'attempt_start'); assert.equal(events[0].counters.total,1);
  assert.equal(events.some(e=>e.type==='operation'),false);
  assert.equal(events.at(-1).type,'interrupted');
  assert.equal(events.at(-1).stopReason,'persistence_fatal');
});

test('one-shot attempt_response persistence failure aborts globally, preserving prior progress without completion/CSV', async () => {
  const adapters = mocks(); const events: any[] = [];
  const log = crearRegistroExclusivo(path.join(temp,'test20-prep-ciclo2-response-'+randomUUID()),{label:'MOCK_ONLY'},'fixture');
  let responses = 0, csvReached = false;
  try {
    await assert.rejects((async ()=>{
      await ejecutarTest20(adapters,casos,event=>{
        if ((event as any).type==='attempt_response' && ++responses===2) throw new Error('mock single disk failure');
        log.append(event); events.push(event);
      },noSleep);
      csvReached=true;
    })(),ErrorPersistenciaFatal);
  } finally { log.close(); }
  assert.deepEqual(adapters.map(a=>a.calls),[2,0,0]);
  assert.equal(csvReached,false);
  assert.equal(events.filter(e=>e.type==='attempt_start').length,2);
  assert.equal(events.filter(e=>e.type==='operation').length,1);
  assert.equal(events.filter(e=>e.type==='attempt_response').length,1);
  assert.equal(events.at(-1).stopReason,'persistence_fatal'); assert.equal(events.at(-1).counters.total,2);
  assert.equal(events.some(e=>['complete','candidate_end','csv_derived'].includes(e.type)),false);
  const saved=fs.readFileSync(path.join(log.dir,'events.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(saved.at(-1).stopReason,'persistence_fatal');
  assert.equal(fs.existsSync(path.join(log.dir,'ejecuciones_raw.csv')),false);
});

for (const index of [0,1,2]) test('http_dispatch one-shot persistence failure survives adapter wrapping and aborts globally: '+MODELOS_TEST20[index], async () => {
  const [{AdaptadorGoogle},{AdaptadorGroq},{AdaptadorGroqGptOss}] = await Promise.all([
    import('./adaptadores/google.js'),import('./adaptadores/groq.js'),import('./adaptadores/groq_gpt_oss.js'),
  ]);
  const actual = [AdaptadorGoogle,AdaptadorGroq,AdaptadorGroqGptOss][index];
  const adapter = new actual();
  (adapter as any).obtenerApiKey = ()=>'LOCAL_MOCK_NOT_A_KEY';
  let adapterCalls=0, transportCalls=0, dispatches=0;
  const originalCall=adapter.ejecutarLlamada.bind(adapter);
  adapter.ejecutarLlamada=async (...params)=>{adapterCalls++;return originalCall(...params);};
  const adapters: AdaptadorModelo[]=mocks(); adapters[index]=adapter;
  const events:any[]=[];
  const log=crearRegistroExclusivo(path.join(temp,'test20-prep-ciclo2-dispatch-'+randomUUID()),{label:'MOCK_ONLY'},'fixture');
  const originalFetch=globalThis.fetch;
  const transport=crearTransporteTest20(async ()=>{
    transportCalls++;
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(analysis)}]}}],choices:[{message:{content:JSON.stringify(analysis)}}]}),{status:200});
  },model=>{
    if (++dispatches===2) throw new Error('mock single disk failure');
    const e={type:'http_dispatch',model}; log.append(e); events.push(e);
  });
  transport.envolver(adapter); globalThis.fetch=transport.fetch;
  let csvReached=false;
  try {
    await assert.rejects((async ()=>{
      await ejecutarTest20(adapters,casos,e=>{log.append(e);events.push(e);},noSleep);
      csvReached=true;
    })(),ErrorPersistenciaFatal);
    // A recovered sink cannot re-enable the failed transport, even outside the stopped runner.
    await assert.rejects(adapter.ejecutarLlamada(construirPromptAnalisis(casos[0].textoFuente),SCHEMAS.analisis),ErrorPersistenciaFatal);
  } finally { globalThis.fetch=originalFetch; log.close(); }
  assert.equal(adapterCalls,2); assert.equal(transportCalls,1); assert.equal(csvReached,false);
  for(let n=index+1;n<3;n++) assert.equal((adapters[n] as Mock).calls,0);
  assert.equal(events.at(-1).stopReason,'persistence_fatal'); assert.equal(events.at(-1).counters.total,index*20+2);
  assert.equal(events.some(e=>e.type==='complete'||e.type==='csv_derived'),false);
  assert.equal(events.filter(e=>e.type==='operation').length,index*20+1);
  assert.equal(events.filter(e=>e.type==='attempt_error_response').length,0); // No fake API-error conversion.
  assert.equal(fs.existsSync(path.join(log.dir,'ejecuciones_raw.csv')),false);
});

const fakeBody=JSON.stringify({error:{code:'SCHEMA_REJECTED',message:'Schema diagnosis; echo FAKE_KEY_VALUE_ABC',
  api_key:'FAKE_KEY_VALUE_ABC',password:'FAKE_PASSWORD_VALUE_ABC',nested:{authorization:'Bearer FAKE_BEARER_VALUE_ABC',access_token:'FAKE_ACCESS_VALUE_ABC'}}});
for(const status of [429,400]) test('HTTP '+status+' persists sanitized rawBody/hash/status linked to attempt; stops only candidate',async ()=>{
  const adapters=mocks();
  adapters[0].ejecutarLlamada=async ()=>{
    adapters[0].calls++;
    throw new ApiCallError({status,categoria:status===429?'rate_limit':'invalid_request',message:'Schema diagnosis; Bearer FAKE_BEARER_VALUE_ABC; echo FAKE_KEY_VALUE_ABC',rawBody:fakeBody,latencyMs:1,isNonRetryable:true});
  };
  const events:any[]=[];
  const rows=await ejecutarTest20(adapters,casos,e=>events.push(e),noSleep);
  const errors=events.filter(e=>e.type==='attempt_error_response'); assert.equal(errors.length,1);
  const e=errors[0]; assert.equal(e.id,events[0].id); assert.equal(e.case,CASOS_TEST20[0]); assert.equal(e.operation,'analisis');
  assert.equal(e.response.status,status); assert.equal(e.response.category,status===429?'rate_limit':'invalid_request');
  assert.equal(e.response.rawBodyAvailable,true); assert.equal(e.response.rawBodySha256,createHash('sha256').update(fakeBody).digest('hex'));
  assert.equal(e.response.rawBodyBytes,Buffer.byteLength(fakeBody));
  const body=JSON.parse(e.response.rawBody); assert.equal(body.error.code,'SCHEMA_REJECTED'); assert.match(body.error.message,/Schema diagnosis/);
  assert.equal(body.error.api_key,'[REDACTED]'); assert.equal(body.error.password,'[REDACTED]');
  assert.equal(e.response.sanitizationPolicy,'provider-error-v1'); assert.ok(e.response.redactions.length>=4);
  const all=JSON.stringify({events,rows}); for(const value of ['FAKE_KEY_VALUE_ABC','FAKE_PASSWORD_VALUE_ABC','FAKE_BEARER_VALUE_ABC','FAKE_ACCESS_VALUE_ABC']) assert.equal(all.includes(value),false);
  assert.deepEqual(adapters.map(a=>a.calls),[1,20,20]); assert.equal(rows[0].http_status,status);
  assert.match(rows[0].error,/Schema diagnosis/); assert.equal(events.at(-1).type,'complete');
});

test('plain-text error redacts assignments and Bearer; missing and empty body remain distinguishable',()=>{
  const error=new ApiCallError({status:400,categoria:'invalid_request',message:'provider diagnosis',rawBody:'schema rejected password="FAKE PASS VALUE" key=FAKE_QUERY_VALUE & Authorization: Bearer FAKE_BEARER_VALUE',latencyMs:1,isNonRetryable:true});
  const clean=sanitizarErrorTest20(error);
  assert.match(clean.rawBody!,/schema rejected/);
  for(const value of ['FAKE PASS VALUE','FAKE_QUERY_VALUE','FAKE_BEARER_VALUE']) assert.equal(clean.rawBody!.includes(value),false);
  assert.equal(clean.bodyFormat,'text'); assert.ok(clean.redactions.length>0);
  error.rawBody=undefined; const missing=sanitizarErrorTest20(error); assert.equal(missing.rawBodyAvailable,false); assert.equal(missing.rawBody,null); assert.equal(missing.rawBodySha256,null);
  error.rawBody=''; const empty=sanitizarErrorTest20(error); assert.equal(empty.rawBodyAvailable,true); assert.equal(empty.rawBody,''); assert.equal(empty.rawBodyBytes,0);
});

test('failure writing HTTP error response is fatal, not converted into mock API error',async ()=>{
  const adapters=mocks(429); const events:any[]=[];
  await assert.rejects(ejecutarTest20(adapters,casos,e=>{
    if ((e as any).type==='attempt_error_response') throw new Error('one-shot disk error');
    events.push(e);
  },noSleep),ErrorPersistenciaFatal);
  assert.deepEqual(adapters.map(a=>a.calls),[1,0,0]); assert.equal(events.at(-1).stopReason,'persistence_fatal');
  assert.equal(events.some(e=>e.type==='operation'||e.type==='complete'),false);
});

test('historical callback failure remains unknown unless TEST20 fatal option enabled',async ()=>{
  const adapter=new Mock(MODELOS_TEST20[0]);
  const p={idEjecucion:'legacy',adaptador:adapter,caso:casos[0],repeticion:1,nombreOperacion:'analisis',prompt:construirPromptAnalisis(casos[0].textoFuente),schema:SCHEMAS.analisis,tipoContrato:'analisis' as const,validador:validarStoryAnalysis,esDryRun:false,
    registrarRespuesta:()=>{throw new Error('mock callback failure');}};
  const legacy=await ejecutarOperacionIndividual(p); assert.equal(legacy.error_categoria,'unknown'); assert.equal(legacy.error,'mock callback failure'); assert.equal(legacy.numero_solicitudes_http,1);
  await assert.rejects(ejecutarOperacionIndividual({...p,propagarFallosPersistencia:true}),ErrorPersistenciaFatal);
});
