import { obtenerGroqApiKeySegura } from './verificar_entorno_groq';

export interface GroqChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_time?: number;
    completion_time?: number;
    total_time?: number;
  };
}

export interface ResultadoLlamadaJuez {
  exito: boolean;
  httpStatus: number;
  latenciaMs: number;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotales: number;
  costoEstimadoUsd: number;
  contenidoJson: any | null;
  contenidoRaw: string;
  error?: string;
}

export class AdaptadorGroqJuez {
  readonly modelo = 'llama-3.3-70b-versatile';
  readonly endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  readonly tarifaInputUsdPorMillon = 0.59;
  readonly tarifaOutputUsdPorMillon = 0.79;

  private apiKeyOverride?: string;

  constructor(apiKeyOverride?: string) {
    this.apiKeyOverride = apiKeyOverride;
  }

  private obtenerApiKey(): string {
    if (this.apiKeyOverride && this.apiKeyOverride.trim().length > 0) {
      return this.apiKeyOverride.trim();
    }
    const envInfo = obtenerGroqApiKeySegura();
    if (envInfo.disponible && envInfo.clave) {
      return envInfo.clave;
    }
    throw new Error(
      'GROQ_API_KEY no encontrada. Configure la variable de entorno en PowerShell con: $env:GROQ_API_KEY="tu-clave-aqui"'
    );
  }

  public async evaluarCuento(
    promptSistema: string,
    promptUsuario: string
  ): Promise<ResultadoLlamadaJuez> {
    const apiKey = this.obtenerApiKey();
    const tInicio = Date.now();

    const bodyPayload = {
      model: this.modelo,
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: promptUsuario }
      ],
      temperature: 0.1, // Baja temperatura para máxima consistencia y reproducibilidad evaluativa
      response_format: { type: 'json_object' }
    };

    try {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(bodyPayload)
      });

      const latenciaMs = Date.now() - tInicio;
      const status = resp.status;

      if (!resp.ok) {
        const errText = await resp.text();
        return {
          exito: false,
          httpStatus: status,
          latenciaMs,
          tokensPrompt: 0,
          tokensCompletion: 0,
          tokensTotales: 0,
          costoEstimadoUsd: 0,
          contenidoJson: null,
          contenidoRaw: errText,
          error: `HTTP ${status}: ${errText}`
        };
      }

      const data: GroqChatCompletionResponse = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

      const costoUsd = (promptTokens / 1_000_000) * this.tarifaInputUsdPorMillon +
                       (completionTokens / 1_000_000) * this.tarifaOutputUsdPorMillon;

      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseErr: any) {
        return {
          exito: false,
          httpStatus: status,
          latenciaMs,
          tokensPrompt: promptTokens,
          tokensCompletion: completionTokens,
          tokensTotales: totalTokens,
          costoEstimadoUsd: Number(costoUsd.toFixed(6)),
          contenidoJson: null,
          contenidoRaw: content,
          error: `Error al parsear JSON devuelto por Llama 3.3: ${parseErr.message}`
        };
      }

      return {
        exito: true,
        httpStatus: status,
        latenciaMs,
        tokensPrompt: promptTokens,
        tokensCompletion: completionTokens,
        tokensTotales: totalTokens,
        costoEstimadoUsd: Number(costoUsd.toFixed(6)),
        contenidoJson: parsedJson,
        contenidoRaw: content
      };
    } catch (networkErr: any) {
      return {
        exito: false,
        httpStatus: 0,
        latenciaMs: Date.now() - tInicio,
        tokensPrompt: 0,
        tokensCompletion: 0,
        tokensTotales: 0,
        costoEstimadoUsd: 0,
        contenidoJson: null,
        contenidoRaw: '',
        error: networkErr.message || 'Error de red en llamada a Groq API'
      };
    }
  }
}
