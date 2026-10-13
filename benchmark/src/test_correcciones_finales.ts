import { SCHEMAS, sanitizarSchemaParaGoogle } from './contratos.js';
import { AdaptadorGroq } from './adaptadores/groq.js';
import { construirPromptEscenaIntermedia, construirPromptRetry } from './prompts.js';

function ejecutarTestsCorrecciones() {
  console.log('====================================================');
  console.log('TESTS LOCALES DETERMINISTAS DE CORRECCIONES (0 RED)');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // TEST 1: Sanitizacion Gemini para boolean enum
  // ----------------------------------------------------
  console.log('--- TEST 1: Sanitizacion Gemini de Schema Booleano ---');
  
  // 1.1 Verificar schema original de escena intermedia
  const schemaEscenaOriginal = SCHEMAS.escena;
  const esFinalOriginal = (schemaEscenaOriginal.properties as any).esFinal;
  if (!esFinalOriginal || esFinalOriginal.type !== 'boolean' || !Array.isArray(esFinalOriginal.enum) || esFinalOriginal.enum[0] !== false) {
    throw new Error('TEST 1.1 FALLO: SCHEMAS.escena original debe contener type: boolean y enum: [false]');
  }

  // 1.2 Sanitizar para Google
  const schemaEscenaGoogle = sanitizarSchemaParaGoogle(schemaEscenaOriginal);

  // 1.3 Comprobar que el original permanece intacto
  if (!((schemaEscenaOriginal.properties as any).esFinal.enum)) {
    throw new Error('TEST 1.3 FALLO: El schema original fue mutado indebidamente');
  }

  // 1.4 Comprobar que en schema Google se elimino enum pero se conserva esFinal y type: boolean
  const esFinalGoogle = schemaEscenaGoogle.properties.esFinal;
  if (!esFinalGoogle) {
    throw new Error('TEST 1.4 FALLO: esFinal desaparecio del schema sanitizado para Google');
  }
  if (esFinalGoogle.type !== 'boolean') {
    throw new Error(`TEST 1.4 FALLO: type de esFinal deberia ser 'boolean', recibido: ${esFinalGoogle.type}`);
  }
  if ('enum' in esFinalGoogle) {
    throw new Error('TEST 1.4 FALLO: el enum booleano [false] aun existe en el schema sanitizado para Google');
  }
  console.log('  [PASS] Escena intermedia: enum: [false] eliminado en schema Google; original intacto; type: boolean conservado.');

  // 1.5 Sanitizar escena final (enum: [true])
  const schemaFinalOriginal = SCHEMAS.escenaFinal;
  const schemaFinalGoogle = sanitizarSchemaParaGoogle(schemaFinalOriginal);
  const esFinalEnFinalGoogle = schemaFinalGoogle.properties.esFinal;
  if ('enum' in esFinalEnFinalGoogle) {
    throw new Error('TEST 1.5 FALLO: el enum booleano [true] aun existe en escenaFinal sanitizada');
  }
  if (esFinalEnFinalGoogle.type !== 'boolean') {
    throw new Error(`TEST 1.5 FALLO: type de esFinal deberia ser 'boolean' en escenaFinal sanitizada`);
  }
  console.log('  [PASS] Escena final: enum: [true] eliminado en schema Google; original intacto; type: boolean conservado.');

  // 1.6 Probar que enums de strings y numeros NO se eliminan indebidamente
  const schemaConOtrosEnums = {
    type: 'object',
    properties: {
      estado: { type: 'string', enum: ['ok', 'error'] },
      codigo: { type: 'number', enum: [200, 400] },
      bandera: { type: 'boolean', enum: [true] },
    },
  };
  const schemaSanitizadoConOtros = sanitizarSchemaParaGoogle(schemaConOtrosEnums);
  if (!schemaSanitizadoConOtros.properties.estado.enum || schemaSanitizadoConOtros.properties.estado.enum.length !== 2) {
    throw new Error('TEST 1.6 FALLO: el enum de string fue eliminado indebidamente');
  }
  if (!schemaSanitizadoConOtros.properties.codigo.enum || schemaSanitizadoConOtros.properties.codigo.enum.length !== 2) {
    throw new Error('TEST 1.6 FALLO: el enum de numero fue eliminado indebidamente');
  }
  if ('enum' in schemaSanitizadoConOtros.properties.bandera) {
    throw new Error('TEST 1.6 FALLO: el enum booleano de bandera no fue eliminado');
  }
  console.log('  [PASS] Enums de string y numero conservados; enum booleano eliminado correctamente.\n');

  // ----------------------------------------------------
  // TEST 2: Categorizacion HTTP 429 como rate_limit
  // ----------------------------------------------------
  console.log('--- TEST 2: Categorizacion HTTP 429 como rate_limit con prioridad ---');
  const adaptador = new AdaptadorGroq();

  // Caso 1: Status 429 con texto de billing y upgrade
  const error429ConBilling = {
    status: 429,
    message: 'Rate limit exceeded. OTPM Limit 1000 Used 743 Requested 537. Please upgrade your plan in billing settings.',
    rawBody: '{"error": {"message": "Rate limit exceeded. Upgrade billing plan."}}',
  };
  const cat1 = adaptador.categorizarError(error429ConBilling);
  if (cat1 !== 'rate_limit') {
    throw new Error(`TEST 2.1 FALLO: status 429 con mensaje de billing debe ser 'rate_limit', obtenido: '${cat1}'`);
  }
  console.log('  [PASS] Status 429 con "upgrade/billing" clasificado estrictamente como rate_limit (NO billing).');

  // Caso 2: Error 402 o 400 con texto de billing debe seguir siendo billing
  const error402Billing = {
    status: 402,
    message: 'Insufficient balance / payment required. Billing credits depleted.',
  };
  const cat2 = adaptador.categorizarError(error402Billing);
  if (cat2 !== 'billing') {
    throw new Error(`TEST 2.2 FALLO: status 402 con billing debe ser 'billing', obtenido: '${cat2}'`);
  }
  console.log('  [PASS] Status no-429 con saldo/pago clasificado correctamente como billing.\n');

  // ----------------------------------------------------
  // TEST 3: Retry correctivo con contexto completo
  // ----------------------------------------------------
  console.log('--- TEST 3: Construccion de Retry con Contexto Completo ---');
  
  const historiaPrevia = 'Inicio del cuento: El perrito Tobi salio a buscar su pelota.';
  const decisionTomada = 'Ir hacia el arbol centenario';
  const decisionControlada = 'Cruzar el puente de madera';

  const promptOriginal = construirPromptEscenaIntermedia(
    historiaPrevia,
    decisionTomada,
    2,
    decisionControlada
  );

  const rawInvalido = '{"contenido": "Tobi corre hacia el puente", "opciones": ["Opcion A", "Opcion B"], "esFinal": false}';
  const errorMsg = 'Se requieren exactamente 3 opciones, se recibieron 2';
  const schemaStr = JSON.stringify(SCHEMAS.escena, null, 2);

  const promptRetry = construirPromptRetry(
    promptOriginal,
    rawInvalido,
    errorMsg,
    schemaStr,
    decisionControlada
  );

  // Verificaciones de conservacion de contexto:
  // 1. systemInstruction original
  if (promptRetry.systemInstruction !== promptOriginal.systemInstruction) {
    throw new Error('TEST 3.1 FALLO: systemInstruction original no fue preservada');
  }

  // 2. contents originales conservados
  if (promptRetry.contents.length < 3) {
    throw new Error(`TEST 3.2 FALLO: Se esperaban al menos 3 turnos en contents, obtenidos: ${promptRetry.contents.length}`);
  }

  const turnoUserOriginal = promptRetry.contents[0];
  if (!turnoUserOriginal.parts[0].text.includes(historiaPrevia)) {
    throw new Error('TEST 3.3 FALLO: La historia previa original no se encuentra en el retry');
  }
  if (!turnoUserOriginal.parts[0].text.includes(decisionTomada)) {
    throw new Error('TEST 3.4 FALLO: La decision tomada original no se encuentra en el retry');
  }

  // 3. Turno del modelo con la salida anterior
  const turnoModel = promptRetry.contents[1];
  if (turnoModel.role !== 'model' || turnoModel.parts[0].text !== rawInvalido) {
    throw new Error('TEST 3.5 FALLO: El turno model con la salida invalida anterior no se conservo correctamente');
  }

  // 4. Turno de correccion del usuario
  const turnoUserCorreccion = promptRetry.contents[2];
  if (turnoUserCorreccion.role !== 'user') {
    throw new Error('TEST 3.6 FALLO: El turno de feedback correctivo debe ser role user');
  }
  const feedbackText = turnoUserCorreccion.parts[0].text;
  if (!feedbackText.includes(errorMsg)) {
    throw new Error('TEST 3.7 FALLO: El mensaje de error no esta presente en el turno correctivo');
  }
  if (!feedbackText.includes('esFinal')) {
    throw new Error('TEST 3.8 FALLO: El schema no esta presente en el turno correctivo');
  }
  if (!feedbackText.includes(decisionControlada)) {
    throw new Error('TEST 3.9 FALLO: La decision controlada no fue reiterada textualmente en el turno correctivo');
  }

  console.log('  [PASS] Retry conserva: systemInstruction original, historia previa, decision tomada, salida raw anterior (model), error, schema y decision controlada intacta.');

  console.log('\n====================================================');
  console.log('TODAS LAS PRUEBAS DE CORRECCIONES PASARON EXITOSAMENTE (0 RED).');
  console.log('====================================================\n');
}

ejecutarTestsCorrecciones();
