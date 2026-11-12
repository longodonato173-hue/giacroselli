import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/lib/handler.mjs';

// Store in memoria con lo stesso contratto di netlify/lib/store.mjs (inclusa la regola di giacenza).
function fakeStore() {
  const prodotti = new Map();
  const movimenti = new Map();
  const stock = (pid) => [...movimenti.values()].filter((m) => m.prodottoId === pid).reduce((a, m) => a + m.delta, 0);
  return {
    async listAll() {
      return {
        prodotti: [...prodotti.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
        movimenti: [...movimenti.values()].map((m) => ({ ...m })),
      };
    },
    async upsertProdotto(p) { prodotti.set(p.id, { ...p }); return { status: 'ok' }; },
    async deleteProdotto(id) {
      if (!prodotti.has(id)) return { status: 'not_found' };
      if ([...movimenti.values()].some((m) => m.prodottoId === id)) return { status: 'has_movimenti' };
      prodotti.delete(id);
      return { status: 'deleted' };
    },
    async insertMovimento(m) {
      if (!prodotti.has(m.prodottoId)) return { status: 'no_product' };
      if (movimenti.has(m.id)) return { status: 'exists' };
      if (m.delta < 0) {
        const g = stock(m.prodottoId);
        if (g + m.delta < 0) return { status: 'insufficient', disponibili: g };
      }
      movimenti.set(m.id, { ...m });
      return { status: 'created' };
    },
    async deleteMovimento(id) { movimenti.delete(id); return { status: 'ok' }; },
  };
}

function setup() {
  const handle = createHandler({ store: fakeStore() });
  const call = async (method, path, { body, raw, headers } = {}) => {
    const h = { ...(headers || {}) };
    const init = { method, headers: h };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) { init.body = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await handle(new Request('https://example.test' + path, init));
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* corpo vuoto */ }
    return { res, status: res.status, json };
  };
  return { call };
}

const prod = { nome: 'Pellet abete', marca: 'Marca', cert: 'ENplus A1', kgSacco: 15, sacchiBancale: 65, scortaMinBancali: 2, costo: 4.2 };
const mkProd = (call, id = 'p1') => call('PUT', '/api/prodotti/' + id, { body: prod });

test('GET /api/state: stato vuoto, no-store, nessun CORS', async () => {
  const { call } = setup();
  const r = await call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { prodotti: [], movimenti: [] });
  assert.equal(r.res.headers.get('cache-control'), 'no-store');
  assert.equal(r.res.headers.get('access-control-allow-origin'), null);
  assert.match(r.res.headers.get('content-type'), /application\/json/);
});

test('upsert prodotto e lettura con la forma attesa dalla pagina', async () => {
  const { call } = setup();
  assert.equal((await mkProd(call)).status, 200);
  const upd = await call('PUT', '/api/prodotti/p1', { body: { ...prod, nome: 'Pellet faggio', costo: 5 } });
  assert.equal(upd.status, 200);
  const s = await call('GET', '/api/state');
  assert.equal(s.json.prodotti.length, 1);
  assert.deepEqual(s.json.prodotti[0], { id: 'p1', nome: 'Pellet faggio', marca: 'Marca', cert: 'ENplus A1', kgSacco: 15, sacchiBancale: 65, scortaMinBancali: 2, costo: 5 });
});

test('validazione prodotto: 400 con codice errore breve', async () => {
  const { call } = setup();
  const bad = [
    { ...prod, nome: '' },
    { ...prod, nome: 'x'.repeat(201) },
    { ...prod, kgSacco: 0 },
    { ...prod, kgSacco: '15' },
    { ...prod, sacchiBancale: 0 },
    { ...prod, sacchiBancale: 1.5 },
    { ...prod, scortaMinBancali: -1 },
    { ...prod, costo: -0.1 },
    { ...prod, marca: 5 },
    [],
  ];
  for (const b of bad) {
    const r = await call('PUT', '/api/prodotti/p1', { body: b });
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(typeof r.json.error, 'string');
  }
  assert.equal((await call('PUT', '/api/prodotti/p1', { raw: '{non json' })).status, 400);
  assert.equal((await call('PUT', '/api/prodotti/' + encodeURIComponent('a b;c'), { body: prod })).status, 400);
});

test('carico con fattura e CMR, poi scarico con ricevuta', async () => {
  const { call } = setup();
  await mkProd(call);
  const c = await call('PUT', '/api/movimenti/m1', { body: { tipo: 'carico', prodottoId: 'p1', delta: 130, data: '2026-11-10', controparte: 'Fornitore', fattura: 'F1', cmr: 'C1', nota: '', ts: 1000 } });
  assert.equal(c.status, 201);
  const s = await call('PUT', '/api/movimenti/m2', { body: { tipo: 'scarico', prodottoId: 'p1', delta: -30, data: '2026-11-11', controparte: 'Cliente', ricevuta: 'si', nota: 'x', ts: 2000 } });
  assert.equal(s.status, 201);
  const st = await call('GET', '/api/state');
  const [m1, m2] = st.json.movimenti;
  assert.deepEqual(m1, { id: 'm1', tipo: 'carico', prodottoId: 'p1', delta: 130, data: '2026-11-10', controparte: 'Fornitore', fattura: 'F1', cmr: 'C1', nota: '', ts: 1000 });
  assert.deepEqual(m2, { id: 'm2', tipo: 'scarico', prodottoId: 'p1', delta: -30, data: '2026-11-11', controparte: 'Cliente', ricevuta: 'si', nota: 'x', ts: 2000 });
  assert.equal('ricevuta' in m1, false);
  assert.equal('fattura' in m2, false);
});

test('inserimento idempotente: stesso id ripetuto non duplica', async () => {
  const { call } = setup();
  await mkProd(call);
  const body = { tipo: 'carico', prodottoId: 'p1', delta: 10, data: '2026-11-10' };
  assert.equal((await call('PUT', '/api/movimenti/m1', { body })).status, 201);
  assert.equal((await call('PUT', '/api/movimenti/m1', { body })).status, 200);
  assert.equal((await call('GET', '/api/state')).json.movimenti.length, 1);
});

test('scarico senza ricevuta rifiutato; ricevuta/fattura vietate sugli altri tipi', async () => {
  const { call } = setup();
  await mkProd(call);
  await call('PUT', '/api/movimenti/m1', { body: { tipo: 'carico', prodottoId: 'p1', delta: 50, data: '2026-11-10' } });
  const a = await call('PUT', '/api/movimenti/m2', { body: { tipo: 'scarico', prodottoId: 'p1', delta: -5, data: '2026-11-10' } });
  assert.equal(a.status, 400);
  assert.equal(a.json.error, 'ricevuta_richiesta');
  const b = await call('PUT', '/api/movimenti/m3', { body: { tipo: 'carico', prodottoId: 'p1', delta: 5, data: '2026-11-10', ricevuta: 'si' } });
  assert.equal(b.status, 400);
  const c = await call('PUT', '/api/movimenti/m4', { body: { tipo: 'scarico', prodottoId: 'p1', delta: -5, data: '2026-11-10', ricevuta: 'si', fattura: 'F' } });
  assert.equal(c.status, 400);
  const d = await call('PUT', '/api/movimenti/m5', { body: { tipo: 'scarico', prodottoId: 'p1', delta: -5, data: '2026-11-10', ricevuta: 'forse' } });
  assert.equal(d.status, 400);
});

test('validazione movimento: tipo, delta, data, prodotto', async () => {
  const { call } = setup();
  await mkProd(call);
  const ok = { tipo: 'rettifica', prodottoId: 'p1', delta: 3, data: '2026-11-10' };
  const bad = [
    { ...ok, tipo: 'altro' },
    { ...ok, delta: 0 },
    { ...ok, delta: 1.5 },
    { ...ok, delta: '3' },
    { ...ok, tipo: 'carico', delta: -3 },
    { ...ok, data: '2026-02-30' },
    { ...ok, data: '10/11/2026' },
    { ...ok, controparte: 'x'.repeat(201) },
    { ...ok, nota: 7 },
    { ...ok, prodottoId: 'nonesiste' },
  ];
  for (const b of bad) {
    const r = await call('PUT', '/api/movimenti/mx', { body: b });
    assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal((await call('PUT', '/api/movimenti/mx', { body: ok })).status, 201);
});

test('409 giacenza_insufficiente con disponibili', async () => {
  const { call } = setup();
  await mkProd(call);
  await call('PUT', '/api/movimenti/m1', { body: { tipo: 'carico', prodottoId: 'p1', delta: 10, data: '2026-11-10' } });
  const r = await call('PUT', '/api/movimenti/m2', { body: { tipo: 'scarico', prodottoId: 'p1', delta: -11, data: '2026-11-10', ricevuta: 'no' } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { error: 'giacenza_insufficiente', disponibili: 10 });
  const ok = await call('PUT', '/api/movimenti/m3', { body: { tipo: 'scarico', prodottoId: 'p1', delta: -10, data: '2026-11-10', ricevuta: 'no' } });
  assert.equal(ok.status, 201);
  const rett = await call('PUT', '/api/movimenti/m4', { body: { tipo: 'rettifica', prodottoId: 'p1', delta: -1, data: '2026-11-10' } });
  assert.equal(rett.status, 409);
});

test('elimina prodotto: 409 ha_movimenti, poi ok dopo aver tolto i movimenti', async () => {
  const { call } = setup();
  await mkProd(call);
  await call('PUT', '/api/movimenti/m1', { body: { tipo: 'carico', prodottoId: 'p1', delta: 10, data: '2026-11-10' } });
  const blocked = await call('DELETE', '/api/prodotti/p1');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'ha_movimenti');
  assert.equal((await call('DELETE', '/api/movimenti/m1')).status, 200);
  assert.equal((await call('DELETE', '/api/prodotti/p1')).status, 200);
  assert.deepEqual((await call('GET', '/api/state')).json, { prodotti: [], movimenti: [] });
});

test('elimina movimento', async () => {
  const { call } = setup();
  await mkProd(call);
  await call('PUT', '/api/movimenti/m1', { body: { tipo: 'carico', prodottoId: 'p1', delta: 10, data: '2026-11-10' } });
  assert.equal((await call('DELETE', '/api/movimenti/m1')).status, 200);
  assert.equal((await call('GET', '/api/state')).json.movimenti.length, 0);
});

test('rotta sconosciuta 404; metodo sbagliato 405 con Allow', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/nulla')).status, 404);
  assert.equal((await call('GET', '/api/prodotti')).status, 404);
  assert.equal((await call('GET', '/api/prodotti/p1/extra')).status, 404);
  const a = await call('POST', '/api/state');
  assert.equal(a.status, 405);
  assert.equal(a.res.headers.get('allow'), 'GET');
  const b = await call('GET', '/api/prodotti/p1');
  assert.equal(b.status, 405);
  assert.equal(b.res.headers.get('allow'), 'PUT, DELETE');
  assert.equal((await call('POST', '/api/movimenti/m1', { body: {} })).status, 405);
  assert.equal((await call('OPTIONS', '/api/state')).status, 405);
});

test('corpo troppo grande: 413 (content-length e flusso reale)', async () => {
  const { call } = setup();
  const big = JSON.stringify({ ...prod, nome: 'a'.repeat(20000) });
  const a = await call('PUT', '/api/prodotti/p1', { raw: big });
  assert.equal(a.status, 413);
  const b = await call('PUT', '/api/prodotti/p1', { raw: big, headers: { 'content-length': '10' } });
  assert.ok(b.status === 413 || b.status === 400);
});

test('errore imprevisto dello store: 500 generico senza dettagli', async () => {
  const store = fakeStore();
  store.listAll = async () => { throw new Error('boom segreto'); };
  const handle = createHandler({ store });
  const origErr = console.error; console.error = () => {};
  try {
    const res = await handle(new Request('https://example.test/api/state'));
    assert.equal(res.status, 500);
    assert.equal(JSON.stringify(await res.json()), '{"error":"errore_interno"}');
  } finally { console.error = origErr; }
});
