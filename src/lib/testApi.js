const API_URL = '/.netlify/functions/test-api-v4';
const TOKEN_KEY = 'everclean-test-session';

export function getTestToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setTestToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export async function testApi(action, payload = {}, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getTestToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  let data = null;
  try { data = await response.json(); } catch { data = { ok: false, message: 'Resposta inválida do servidor de testes.' }; }
  if (!response.ok && !data?.message) data.message = `Erro ${response.status}`;
  return data;
}

export function logoutTest() {
  setTestToken('');
}
