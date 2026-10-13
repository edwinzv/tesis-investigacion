import { AdaptadorModelo } from './base.js';
import { PromptMensajes } from '../prompts.js';
import { ApiCallError, RawModelResponse } from '../types.js';
import { sanitizarSchemaParaGoogle } from '../contratos.js';

export class AdaptadorGoogle extends AdaptadorModelo {
  readonly id = 'gemini-3.8-flash';
  readonly proveedor = 'Google';
  readonly modelo = 'gemini-3.8-flash';
  readonly tarifaInputUsdPorMillon = 0.75;
  readonly tarifaOutputUsdPorMillon = 3.75;
  readonly tarifaFuenteRuntime = 'Google AI Gemini 3.8 Flash Pricing (vigente 2026-10-09 a 2026-12-31)';
  readonly freeTierActivo = false;

  private obtenerApiKey(): string {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY no configurada');
    }
    return key;
  }

  async verificarDisponibilidad(): Promise<{ disponible: boolean; mensaje: string; providerRuntime?: string }> {
    try {
      this.obtenerApiKey();
      return { disponible: true, mensaje: 'Credenciales de Google Gemini configuradas correctamente' };
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

    const schemaSanitizado = sanitizarSchemaParaGoogle(schema);

    const body: any = {
      contents: prompt.contents,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schemaSanitizado,
        maxOutputTokens: maxTokens ?? 2048,
        thinkingConfig: {
          thinkingLevel: 'low',
        },
      },
    };

    if (prompt.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: prompt.systemInstruction }],
      };
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + this.modelo + ':generateContent?key=' + apiKey;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const latenciaMs = Date.now() - inicio;

      if (!resp.ok) {
        const errorText = await resp.text();
        let errorJson: any = null;
        try {
          errorJson = JSON.parse(errorText);
        } catch {}
        const errorMsg = errorJson?.error?.message || errorText;
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
        });
      }

      const json: any = await resp.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const usageMetadata = json.usageMetadata;

      const tokensEntrada = usageMetadata?.promptTokenCount ?? 0;
      const tokensSalida = usageMetadata?.candidatesTokenCount ?? 0;
      const tokensRazonamiento = usageMetadata?.thoughtsTokenCount ?? 0;

      // Req 6: tokensSalidaFacturablesGemini = candidatesTokenCount + (thoughtsTokenCount ?? 0)
      const tokensSalidaFacturables = tokensSalida + tokensRazonamiento;

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
        providerRuntime: 'google-ai-studio',
        tarifaInputUsdPorMillon: this.tarifaInputUsdPorMillon,
        tarifaOutputUsdPorMillon: this.tarifaOutputUsdPorMillon,
        tarifaFuenteRuntime: this.tarifaFuenteRuntime,
        structuredOutputMode: 'json_schema',
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
