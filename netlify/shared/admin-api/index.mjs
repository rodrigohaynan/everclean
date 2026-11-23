// API administrativa e do catálogo legado.
// As versões v1–v7 eram funções públicas separadas (test-api*). Agora ficam
// aqui, fora de netlify/functions, e só a versão final é publicada como endpoint.
export {default} from './v7.mjs';
