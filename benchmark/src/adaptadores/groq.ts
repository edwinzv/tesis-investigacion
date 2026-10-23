import { AdaptadorModelo } from './base.js';
import { PromptMensajes } from '../prompts.js';
import { ApiCallError, RawModelResponse } from '../types.js';

export class AdaptadorGroq extends AdaptadorModelo {
  readonly id = 'qwen-3.8-27b';
  readonly proveedor = 'Groq';
  readonly modelo = 'qwen/qwen3.8-27b';
  readonly tarifaInputUsdPorMillon = 0.80;
  readonly tarifaOutputUsdPorMillon = 4.00;
  readonly tarifaFuenteRuntime = 'Groq Cloud Official Pricing';
  readonly freeTierActivo = true;

  private obtenerApiKey(): string {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error('GROQ_API_KEY no configurada');
    }
    return key;
  }

  async verificarDisponibilidad(): Promise<{ disponible: boolean; mensaje: string; providerRuntime?: string }> {
    try {
      const apiKey = this.obtenerApiKey();
      const resp = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: 'Bearer ' + apiKey },
      });
      if (!resp.ok) {
        return { disponible: false, mensaje: `HTTP ${resp.status} al consultar catalogo de Groq` };
      }
      const data: any = await resp.json();
      const existe = data.data?.some((m: any) => m.id === this.modelo);
      if (existe) {
        return { disponible: true, mensaje: `Modelo ${this.modelo} disponible en catalogo de Groq`, providerRuntime: 'groq-cloud' };
      } else {
        return { disponible: false, mensaje: `Modelo ${this.modelo} no encontrado en catalogo de Groq` };
      }
    } catch (err: any) {
      return { disponible: false, mensaje: err.message || 'Error de configuracion' };
    }
  }

  async ejecutarLlamada(
    prompt: PromptMensajes,
    schema: any,
    tipoOperacion?: string,
    maxTokens?: number
  ): Promise<RawModelResponse> {
    const apiKey = this.obtenerApiKey();
    const inicio = Date.now();

    const messages = [
      {
        role: 'system',
        content: prompt.systemInstruction + '\n\nIMPORTANTE: Debes responder UNICAMENTE con un objeto JSON valido que se ajuste a este schema exacto:\n' + JSON.stringify(schema),
      },
      ...prompt.contents.map((c) => ({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.parts.map((p) => p.text).join('\n'),
      })),
    ];

    const schemaName = (tipoOperacion || 'output_schema').replace(/[^a-zA-Z0-9_]/g, '_');

    // Presupuesto estricto de tokens de salida para respetar límite Free Tier de Groq (1000 OTPM):
    // - analisis: ~350-450 tokens requeridos -> tope de seguridad: 650 tokens
    // - escenas: ~200-350 tokens requeridos -> tope de seguridad: 500 tokens
    // - preflight: 256 tokens
    let completionTokensLimit = maxTokens;
    if (!completionTokensLimit) {
      if (tipoOperacion === 'analisis') {
        completionTokensLimit = 650;
      } else if (tipoOperacion === 'escena_intermedia' || tipoOperacion === 'escena_final') {
        completionTokensLimit = 500;
      } else if (tipoOperacion === 'preflight') {
        completionTokensLimit = 256;
      } else {
        completionTokensLimit = 650;
      }
    }

    // Control de razonamiento para Qwen en Groq:
    // En Groq Free Tier (1000 OTPM), los tokens de razonamiento consumen cuota de salida (hasta 1024 tokens).
    // Por defecto se establece 'none' para que Qwen responda directamente el contrato estructurado con 0 tokens de razonamiento.
    // Puede configurarse via variable de entorno GROQ_QWEN_REASONING_EFFORT ('none' | 'low').
    const reasoningEffort = process.env.GROQ_QWEN_REASONING_EFFORT || 'none';

    const body: any = {
      model: this.modelo,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: schema,
        },
      },
      max_completion_tokens: completionTokensLimit,
      reasoning_effort: reasoningEffort,
      reasoning_format: 'hidden',
    };

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const latenciaMs = Date.now() - inicio;

      if (!resp.ok) {
        const errorText = await resp.text();
        const retryAfterVal = resp.headers.get('retry-after');
        const retryAfterMs = this.parsearRetryAfterHeader(retryAfterVal);
        let errorJson: any = null;
        try {
          errorJson = JSON.parse(errorText);
        } catch {}
        let errorMsg = errorJson?.error?.message || errorText;
        if (errorJson?.error?.failed_generation) {
          const fg = typeof errorJson.error.failed_generation === 'string'
            ? errorJson.error.failed_generation
            : JSON.stringify(errorJson.error.failed_generation);
          errorMsg += ` [failed_generation: ${fg}]`;
        }
        const categoria = this.categorizarError({
          status: resp.status,
          message: errorMsg,
          rawBody: errorText,
        });
        throw new ApiCallError({
          status: resp.status,
          message: errorMsg,
          rawBody: errorText,
          latencyMs: latenciaMs,
          isNonRetryable: categoria === 'authentication' || categoria === 'billing',
          categoria,
          retryAfterMs,
        });
      }

      const json: any = await resp.json();
      const choice = json.choices?.[0];
      const rawText = choice?.message?.content ?? '';
      const usage = json.usage;

      const tokensEntrada = usage?.prompt_tokens ?? 0;
      const tokensSalida = usage?.completion_tokens ?? 0;
      const tokensRazonamiento = usage?.completion_tokens_details?.reasoning_tokens ?? 0;

      // En OpenAI-compatible, completion_tokens ya engloba los reasoning tokens
      const tokensSalidaFacturables = tokensSalida;

      return {
        rawText,
        status: resp.status,
        latencyMs: latenciaMs,
        usage: {
          tokensEntrada,
          tokensSalida,
          tokensRazonamiento,
          tokensSalidaFacturables,
          tokensTotales: tokensEntrada + tokensSalidaFacturables,
          tokensDisponibles: true,
        },
        providerRuntime: 'groq-cloud',
        tarifaInputUsdPorMillon: this.tarifaInputUsdPorMillon,
        tarifaOutputUsdPorMillon: this.tarifaOutputUsdPorMillon,
        tarifaFuenteRuntime: this.tarifaFuenteRuntime,
        structuredOutputMode: 'json_schema',
        reasoningConfig: reasoningEffort,
      };
    } catch (err: any) {
      if (err instanceof ApiCallError) throw err;
      const latenciaMs = Date.now() - inicio;
      const categoria = this.categorizarError(err);
      throw new ApiCallError({
        status: 0,
        message: err.message || 'Error de llamada',
        latencyMs: latenciaMs,
        isNonRetryable: categoria === 'authentication' || categoria === 'billing',
        categoria,
      });
    }
  }
}
