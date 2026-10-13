import { PromptMensajes } from '../prompts.js';
import { ApiCallError, CategoriaError, RawModelResponse } from '../types.js';

export abstract class AdaptadorModelo {
  abstract readonly id: string;
  abstract readonly proveedor: string;
  abstract readonly modelo: string;
  abstract readonly tarifaInputUsdPorMillon: number | null;
  abstract readonly tarifaOutputUsdPorMillon: number | null;
  abstract readonly tarifaFuenteRuntime: string | null;
  abstract readonly freeTierActivo: boolean;

  abstract verificarDisponibilidad(): Promise<{
    disponible: boolean;
    mensaje: string;
    providerRuntime?: string;
  }>;

  abstract ejecutarLlamada(
    prompt: PromptMensajes,
    schema: any,
    tipoOperacion?: string,
    maxTokens?: number
  ): Promise<RawModelResponse>;

  categorizarError(error: any): CategoriaError {
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;
    const msg = (error?.message ?? '').toLowerCase();
    const rawBody = (typeof error?.rawBody === 'string' ? error.rawBody : '').toLowerCase();
    const combined = (msg + ' ' + rawBody).toLowerCase();

    // 1. Status 429 => SIEMPRE rate_limit con maxima prioridad
    // Un mensaje 429 puede contener invitacion a cambiar de plan o 'upgrade/billing', pero sigue siendo rate limit.
    if (status === 429) {
      return 'rate_limit';
    }

    // 2. Status 401 => authentication
    if (status === 401) {
      return 'authentication';
    }

    // 3. Status 403 => authentication/permissions o billing
    if (status === 403) {
      if (
        combined.includes('billing') ||
        combined.includes('credit') ||
        combined.includes('balance') ||
        combined.includes('payment')
      ) {
        return 'billing';
      }
      return 'authentication';
    }

    // 4. Frases explicitas de autenticacion (NO 'token' generico)
    if (
      combined.includes('invalid api key') ||
      combined.includes('invalid token') ||
      combined.includes('unauthorized') ||
      combined.includes('bearer token') ||
      combined.includes('api key not found') ||
      combined.includes('api_key_invalid') ||
      combined.includes('authentication failed')
    ) {
      return 'authentication';
    }

    // 5. Frases de billing / credit
    if (
      combined.includes('credit') ||
      combined.includes('balance') ||
      combined.includes('billing') ||
      combined.includes('exhausted') ||
      combined.includes('payment required')
    ) {
      return 'billing';
    }

    // 6. 404 / model not found
    if (
      status === 404 ||
      combined.includes('model not found') ||
      combined.includes('does not exist') ||
      combined.includes('not found')
    ) {
      return 'model_not_found';
    }

    // 7. 400 => invalid_request / invalid_request
    if (status === 400) {
      if (
        combined.includes('schema') ||
        combined.includes('response_format') ||
        combined.includes('json_schema')
      ) {
        return 'invalid_request';
      }
      return 'invalid_request';
    }

    // 8. Timeout
    if (combined.includes('timeout') || combined.includes('abort') || combined.includes('deadline')) {
      return 'timeout';
    }

    // 9. Conectividad / red
    if (
      combined.includes('fetch failed') ||
      combined.includes('econnrefused') ||
      combined.includes('network') ||
      combined.includes('enotfound')
    ) {
      return 'network';
    }

    // 10. Fallback rate limit si la frase es clara
    if (
      combined.includes('rate limit') ||
      combined.includes('tokens per minute') ||
      combined.includes('requests per minute') ||
      combined.includes('tpm') ||
      combined.includes('rpm')
    ) {
      return 'rate_limit';
    }

    return 'unknown';
  }
}
