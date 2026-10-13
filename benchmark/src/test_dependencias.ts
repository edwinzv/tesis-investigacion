import { AdaptadorModelo } from './adaptadores/base.js';
import { PromptMensajes } from './prompts.js';
import { CasoEstudio, RawModelResponse } from './types.js';
import { ejecutarBenchmark } from './runner.js';
import * as path from 'path';

class AdaptadorMockControlado extends AdaptadorModelo {
  readonly id = 'mock-dependencias';
  readonly proveedor = 'MockProvider';
  readonly modelo = 'mock-model-test';
  readonly tarifaInputUsdPorMillon = 1.0;
  readonly tarifaOutputUsdPorMillon = 2.0;
  readonly tarifaFuenteRuntime = 'mock_pricing';
  readonly freeTierActivo = false;

  public failAnalisis = false;
  public failEscena1 = false;
  public failEscena2 = false;
  public failEscena3 = false;

  private etapa = 0; // 0=analisis, 1=escena1, 2=escena2, 3=escena3, 4=escena4
  private ultimoTipo: string | null = null;

  resetEtapas() {
    this.etapa = 0;
    this.ultimoTipo = null;
  }

  async verificarDisponibilidad() {
    return { disponible: true, mensaje: 'Mock disponible', providerRuntime: 'local-mock' };
  }

  async ejecutarLlamada(
    prompt: PromptMensajes,
    _schema: any,
    tipoOperacion?: string,
    _maxTokens?: number
  ): Promise<RawModelResponse> {
    const isRetry = prompt.contents.some((c) => c.role === 'model') || prompt.contents.length > 1;

    if (!isRetry) {
      if (tipoOperacion === 'analisis') {
        this.etapa = 0;
      } else if (tipoOperacion === 'escena_intermedia') {
        if (this.etapa === 0) this.etapa = 1; // escena 1
        else if (this.etapa === 1) this.etapa = 2; // escena 2
        else if (this.etapa === 2) this.etapa = 3; // escena 3
      } else if (tipoOperacion === 'escena_final') {
        this.etapa = 4;
      }
    }

    const debeFallar =
      (this.failAnalisis && this.etapa === 0) ||
      (this.failEscena1 && this.etapa === 1) ||
      (this.failEscena2 && this.etapa === 2) ||
      (this.failEscena3 && this.etapa === 3);

    if (debeFallar) {
      return {
        rawText: '{"error": "fallo deliberado total para probar cascada"}',
        status: 200,
        latencyMs: 10,
        usage: {
          tokensEntrada: 50,
          tokensSalida: 20,
          tokensRazonamiento: 0,
          tokensSalidaFacturables: 20,
          tokensTotales: 70,
          tokensDisponibles: true,
        },
        providerRuntime: 'local-mock',
        structuredOutputMode: 'json_schema',
      };
    }

    if (this.etapa === 0) {
      return {
        rawText: JSON.stringify({
          titulo: 'Cuento de Prueba',
          tituloOriginal: 'Cuento Original',
          protagonista: 'Tobi',
          descripcionProtagonista: 'Perrito valiente',
          resumen: 'Tobi busca su hueso.',
          escenario: 'El jardin',
          conflicto: 'El hueso ha desaparecido',
          finalOriginal: 'Tobi encontro su hueso bajo el rosal',
        }),
        status: 200,
        latencyMs: 15,
        usage: {
          tokensEntrada: 100,
          tokensSalida: 50,
          tokensRazonamiento: 0,
          tokensSalidaFacturables: 50,
          tokensTotales: 150,
          tokensDisponibles: true,
        },
        providerRuntime: 'local-mock',
        structuredOutputMode: 'json_schema',
      };
    }

    if (this.etapa >= 1 && this.etapa <= 3) {
      const opciones = ['Buscar en el jardin', 'Preguntar al gato', 'Seguir el rastro'];
      return {
        rawText: JSON.stringify({
          contenido: `Tobi avanza cautelosamente en la etapa ${this.etapa}.`,
          opciones,
          esFinal: false,
        }),
        status: 200,
        latencyMs: 15,
        usage: {
          tokensEntrada: 100,
          tokensSalida: 50,
          tokensRazonamiento: 0,
          tokensSalidaFacturables: 50,
          tokensTotales: 150,
          tokensDisponibles: true,
        },
        providerRuntime: 'local-mock',
        structuredOutputMode: 'json_schema',
      };
    }

    // Escena final
    return {
      rawText: JSON.stringify({
        contenido: 'Tobi encontro su hueso bajo el rosal y comprendio la importancia de la perseverancia.',
        opciones: [],
        esFinal: true,
      }),
      status: 200,
      latencyMs: 15,
      usage: {
        tokensEntrada: 100,
        tokensSalida: 50,
        tokensRazonamiento: 0,
        tokensSalidaFacturables: 50,
        tokensTotales: 150,
        tokensDisponibles: true,
      },
      providerRuntime: 'local-mock',
      structuredOutputMode: 'json_schema',
    };
  }
}

async function ejecutarTest() {
  console.log('====================================================');
  console.log('TEST LOCAL DETERMINISTA DE DEPENDENCIAS NARRATIVAS (0 RED)');
  console.log('====================================================\n');

  const casoDummy: CasoEstudio = {
    id: 'caso_test_dep',
    titulo: 'Cuento Test',
    genero: 'Aventura',
    nivelEducativo: 'Primaria',
    textoFuente: 'Texto fuente de prueba completo con resolucion clara.',
    protagonistaBase: 'Tobi',
    decisionesFijas: ['Buscar en el jardin', 'Preguntar al gato', 'Seguir el rastro'],
    origenTexto: 'Sintetico',
    esTextoEmpiricoPdf: false,
  };

  const carpetaTemp = path.resolve(process.cwd(), 'benchmark/resultados/temp_dep_test');

  // ESCENARIO 1: Analisis falla
  console.log('--- TEST 1: Analisis falla -> Escenas 1-4 deben ser dependency_failed (0 HTTP) ---');
  const mock1 = new AdaptadorMockControlado();
  mock1.failAnalisis = true;
  const res1 = await ejecutarBenchmark({
    adaptadores: [mock1],
    casos: [casoDummy],
    repeticiones: 1,
    carpetaSalida: carpetaTemp,
    esPiloto: true,
    esDryRun: false,
    delayEntreLlamadasMs: 0,
  });

  const depFailed1 = res1.resultados.filter((o) => o.error_categoria === 'dependency_failed');
  const httpCount1 = depFailed1.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

  if (depFailed1.length === 4 && httpCount1 === 0) {
    console.log('  [PASS] Analisis fallo: 4 escenas marcadas como dependency_failed con 0 solicitudes HTTP.');
  } else {
    throw new Error(`TEST 1 FALLO: se esperaban 4 dependency_failed, obtenidos ${depFailed1.length}, HTTP ${httpCount1}`);
  }

  // ESCENARIO 2: Escena 1 falla
  console.log('\n--- TEST 2: Escena 1 falla -> Escenas 2-4 deben ser dependency_failed (0 HTTP) ---');
  const mock2 = new AdaptadorMockControlado();
  mock2.failEscena1 = true;
  const res2 = await ejecutarBenchmark({
    adaptadores: [mock2],
    casos: [casoDummy],
    repeticiones: 1,
    carpetaSalida: carpetaTemp,
    esPiloto: true,
    esDryRun: false,
    delayEntreLlamadasMs: 0,
  });

  const depFailed2 = res2.resultados.filter((o) => o.error_categoria === 'dependency_failed');
  const opsNames2 = depFailed2.map((o) => o.operacion);
  const httpCount2 = depFailed2.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);
  if (depFailed2.length === 3 && opsNames2.includes('escena_2') && opsNames2.includes('escena_3') && opsNames2.includes('escena_4') && httpCount2 === 0) {
    console.log('  [PASS] Escena 1 fallo: escenas 2, 3 y 4 marcadas como dependency_failed con 0 solicitudes HTTP.');
  } else {
    throw new Error(`TEST 2 FALLO: se esperaban 3 dependency_failed para escenas 2-4, obtenidos ${depFailed2.length}`);
  }

  // ESCENARIO 3: Escena 2 falla
  console.log('\n--- TEST 3: Escena 2 falla -> Escenas 3-4 deben ser dependency_failed (0 HTTP) ---');
  const mock3 = new AdaptadorMockControlado();
  mock3.failEscena2 = true;
  const res3 = await ejecutarBenchmark({
    adaptadores: [mock3],
    casos: [casoDummy],
    repeticiones: 1,
    carpetaSalida: carpetaTemp,
    esPiloto: true,
    esDryRun: false,
    delayEntreLlamadasMs: 0,
  });

  const depFailed3 = res3.resultados.filter((o) => o.error_categoria === 'dependency_failed');
  const opsNames3 = depFailed3.map((o) => o.operacion);
  const httpCount3 = depFailed3.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);
  if (depFailed3.length === 2 && opsNames3.includes('escena_3') && opsNames3.includes('escena_4') && httpCount3 === 0) {
    console.log('  [PASS] Escena 2 fallo: escenas 3 y 4 marcadas como dependency_failed con 0 solicitudes HTTP.');
  } else {
    throw new Error(`TEST 3 FALLO: se esperaban 2 dependency_failed para escenas 3-4, obtenidos ${depFailed3.length}`);
  }

  // ESCENARIO 4: Escena 3 falla
  console.log('\n--- TEST 4: Escena 3 falla -> Escena 4 debe ser dependency_failed (0 HTTP) ---');
  const mock4 = new AdaptadorMockControlado();
  mock4.failEscena3 = true;
  const res4 = await ejecutarBenchmark({
    adaptadores: [mock4],
    casos: [casoDummy],
    repeticiones: 1,
    carpetaSalida: carpetaTemp,
    esPiloto: true,
    esDryRun: false,
    delayEntreLlamadasMs: 0,
  });

  const depFailed4 = res4.resultados.filter((o) => o.error_categoria === 'dependency_failed');
  const opsNames4 = depFailed4.map((o) => o.operacion);
  const httpCount4 = depFailed4.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);
  if (depFailed4.length === 1 && opsNames4.includes('escena_4') && httpCount4 === 0) {
    console.log('  [PASS] Escena 3 fallo: escena 4 marcada como dependency_failed con 0 solicitudes HTTP.');
  } else {
    throw new Error(`TEST 4 FALLO: se esperaba 1 dependency_failed para escena 4, obtenidos ${depFailed4.length}`);
  }

  console.log('\n====================================================');
  console.log('TODAS LAS PRUEBAS DE DEPENDENCIAS NARRATIVAS PASARON CON EXITO.');
  console.log('0 llamadas reales efectuadas. 0 gasto incurrido.');
  console.log('====================================================\n');
}

ejecutarTest().catch((err) => {
  console.error('Error en test de dependencias:', err);
  process.exit(1);
});
