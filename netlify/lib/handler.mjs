// Logica delle richieste: routing, validazione, formato JSON.
// Nessun accesso diretto al database: tutto passa dallo "store" iniettato.

const MAX_BODY = 16 * 1024;
const MAX_LEN = 200;
const MAX_NUM = 1e6;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(status, body, extra) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(extra || {}),
  };
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}
const fail = (status, error, extra) => json(status, { error, ...(extra || {}) });

async function readBody(req) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) return { tooBig: true };
  if (!req.body) return { text: '' };
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      try { await reader.cancel(); } catch { /* ignora */ }
      return { tooBig: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function optText(v, key) {
  if (v === undefined || v === null) return { value: '' };
  if (!isStr(v) || v.length > MAX_LEN) return { error: 'campo_non_valido:' + key };
  return { value: v.trim() };
}

function validProdotto(b) {
  if (!isObj(b)) return { error: 'corpo_non_valido' };
  if (!isStr(b.nome) || !b.nome.trim() || b.nome.length > MAX_LEN) return { error: 'nome_non_valido' };
  const marca = optText(b.marca, 'marca'); if (marca.error) return marca;
  const cert = optText(b.cert, 'cert'); if (cert.error) return cert;
  if (!isNum(b.kgSacco) || b.kgSacco <= 0 || b.kgSacco > MAX_NUM) return { error: 'kg_sacco_non_valido' };
  if (!Number.isInteger(b.sacchiBancale) || b.sacchiBancale < 1 || b.sacchiBancale > MAX_NUM) return { error: 'sacchi_bancale_non_valido' };
  const scorta = b.scortaMinBancali === undefined ? 0 : b.scortaMinBancali;
  if (!isNum(scorta) || scorta < 0 || scorta > MAX_NUM) return { error: 'scorta_non_valida' };
  const costo = b.costo === undefined ? 0 : b.costo;
  if (!isNum(costo) || costo < 0 || costo > MAX_NUM) return { error: 'costo_non_valido' };
  return {
    value: {
      nome: b.nome.trim(), marca: marca.value, cert: cert.value,
      kgSacco: b.kgSacco, sacchiBancale: b.sacchiBancale, scortaMinBancali: scorta, costo,
    },
  };
}

function realDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2200 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validMovimento(b) {
  if (!isObj(b)) return { error: 'corpo_non_valido' };
  if (b.tipo !== 'carico' && b.tipo !== 'scarico' && b.tipo !== 'rettifica') return { error: 'tipo_non_valido' };
  if (!isStr(b.prodottoId) || !ID_RE.test(b.prodottoId)) return { error: 'prodotto_non_valido' };
  if (!Number.isInteger(b.delta) || b.delta === 0 || Math.abs(b.delta) > MAX_NUM) return { error: 'delta_non_valido' };
  if (b.tipo === 'carico' && b.delta < 0) return { error: 'delta_non_valido' };
  if (b.tipo === 'scarico' && b.delta > 0) return { error: 'delta_non_valido' };
  if (!isStr(b.data) || !realDate(b.data)) return { error: 'data_non_valida' };
  const controparte = optText(b.controparte, 'controparte'); if (controparte.error) return controparte;
  const nota = optText(b.nota, 'nota'); if (nota.error) return nota;
  let fattura = '', cmr = '';
  if (b.tipo === 'carico') {
    const f = optText(b.fattura, 'fattura'); if (f.error) return f;
    const c = optText(b.cmr, 'cmr'); if (c.error) return c;
    fattura = f.value; cmr = c.value;
  } else if (b.fattura !== undefined || b.cmr !== undefined) {
    return { error: 'fattura_cmr_solo_carico' };
  }
  let ricevuta = null;
  if (b.tipo === 'scarico') {
    if (b.ricevuta !== 'si' && b.ricevuta !== 'no') return { error: 'ricevuta_richiesta' };
    ricevuta = b.ricevuta;
  } else if (b.ricevuta !== undefined) {
    return { error: 'ricevuta_solo_scarico' };
  }
  let ts = Date.now();
  if (b.ts !== undefined) {
    if (!Number.isInteger(b.ts) || b.ts < 0 || b.ts > 8.64e15) return { error: 'ts_non_valido' };
    ts = b.ts;
  }
  return {
    value: { tipo: b.tipo, prodottoId: b.prodottoId, delta: b.delta, data: b.data, controparte: controparte.value, fattura, cmr, ricevuta, nota: nota.value, ts },
  };
}

// Forma esatta usata dalla pagina: ricevuta solo sugli scarichi, fattura/cmr solo sui carichi.
function shapeMovimento(m) {
  const o = {
    id: m.id, tipo: m.tipo, prodottoId: m.prodottoId, delta: m.delta, data: m.data,
    controparte: m.controparte || '',
  };
  if (m.tipo === 'carico') { o.fattura = m.fattura || ''; o.cmr = m.cmr || ''; }
  if (m.tipo === 'scarico' && m.ricevuta) o.ricevuta = m.ricevuta;
  o.nota = m.nota || '';
  o.ts = m.ts == null ? null : Number(m.ts);
  return o;
}
function shapeProdotto(p) {
  return {
    id: p.id, nome: p.nome, marca: p.marca || '', cert: p.cert || '',
    kgSacco: Number(p.kgSacco), sacchiBancale: Number(p.sacchiBancale),
    scortaMinBancali: Number(p.scortaMinBancali), costo: Number(p.costo),
  };
}

export function createHandler({ store }) {
  return async function handle(req) {
    try {
      const path = new URL(req.url).pathname.replace(/\/+$/, '');
      const method = req.method.toUpperCase();
      const allow = (...m) => json(405, { error: 'metodo_non_consentito' }, { allow: m.join(', ') });

      if (path === '/api/state') {
        if (method !== 'GET') return allow('GET');
        const { prodotti, movimenti } = await store.listAll();
        return json(200, { prodotti: prodotti.map(shapeProdotto), movimenti: movimenti.map(shapeMovimento) });
      }

      const m = /^\/api\/(prodotti|movimenti)\/([^/]+)$/.exec(path);
      if (!m) return fail(404, 'non_trovato');
      const coll = m[1];
      let id;
      try { id = decodeURIComponent(m[2]); } catch { return fail(400, 'id_non_valido'); }
      if (method !== 'PUT' && method !== 'DELETE') return allow('PUT', 'DELETE');
      if (!ID_RE.test(id)) return fail(400, 'id_non_valido');

      if (method === 'DELETE') {
        if (coll === 'prodotti') {
          const r = await store.deleteProdotto(id);
          if (r.status === 'has_movimenti') return fail(409, 'ha_movimenti');
          return json(200, { ok: true });
        }
        await store.deleteMovimento(id);
        return json(200, { ok: true });
      }

      // PUT
      const body = await readBody(req);
      if (body.tooBig) return fail(413, 'corpo_troppo_grande');
      let parsed;
      try { parsed = JSON.parse(body.text); } catch { return fail(400, 'json_non_valido'); }

      if (coll === 'prodotti') {
        const v = validProdotto(parsed);
        if (v.error) return fail(400, v.error);
        await store.upsertProdotto({ id, ...v.value });
        return json(200, { ok: true });
      }
      const v = validMovimento(parsed);
      if (v.error) return fail(400, v.error);
      const r = await store.insertMovimento({ id, ...v.value });
      if (r.status === 'no_product') return fail(400, 'prodotto_inesistente');
      if (r.status === 'insufficient') return fail(409, 'giacenza_insufficiente', { disponibili: r.disponibili });
      return json(r.status === 'created' ? 201 : 200, { ok: true });
    } catch (e) {
      console.error('Errore API', e && e.message ? e.message : e);
      return fail(500, 'errore_interno');
    }
  };
}
