import { getStore } from '@netlify/blobs';

export default async () => {
  try {
    const store = getStore({ name: 'everclean-test', consistency: 'strong' });
    const key = 'health/latest';
    const value = { ok: true, checked_at: new Date().toISOString() };
    await store.setJSON(key, value);
    const read = await store.get(key, { type: 'json', consistency: 'strong' });
    return Response.json({ ok: Boolean(read?.ok), checked_at: read?.checked_at || null });
  } catch (error) {
    console.error('Ever Clean health:', error);
    return Response.json({ ok: false, message: error?.message || 'Falha no armazenamento temporário.' }, { status: 500 });
  }
};
