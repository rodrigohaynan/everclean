// Wrapper V2 para forçar um novo bundle da API temporária e renovar o contexto/credenciais do Netlify Blobs.
import handler from './test-api.mjs';

export default async (request, context) => handler(request, context);
