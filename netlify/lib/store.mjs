// Tutto l'SQL del progetto sta qui. Valori sempre passati come parametri, mai concatenati.
import { getDatabase } from '@netlify/database';

let db;
const getDb = () => (db ??= getDatabase());

// Esegue fn(client) dentro una transazione su una connessione dedicata.
async function tx(fn) {
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignora */ }
    throw e;
  } finally {
    client.release();
  }
}

export const store = {
  async listAll() {
    const { sql } = getDb();
    const [prodotti, movimenti] = await Promise.all([
      sql`SELECT id, nome, marca, cert,
                 kg_sacco::float8 AS "kgSacco",
                 sacchi_bancale AS "sacchiBancale",
                 scorta_min_bancali::float8 AS "scortaMinBancali",
                 costo::float8 AS costo
          FROM prodotti ORDER BY nome, id`,
      sql`SELECT id, tipo, prodotto_id AS "prodottoId", delta,
                 data::text AS data, controparte, fattura, cmr, ricevuta, nota,
                 ts::float8 AS ts
          FROM movimenti ORDER BY data, ts, id`,
    ]);
    return { prodotti, movimenti };
  },

  async upsertProdotto(p) {
    const { sql } = getDb();
    await sql`INSERT INTO prodotti (id, nome, marca, cert, kg_sacco, sacchi_bancale, scorta_min_bancali, costo)
              VALUES (${p.id}, ${p.nome}, ${p.marca}, ${p.cert}, ${p.kgSacco}, ${p.sacchiBancale}, ${p.scortaMinBancali}, ${p.costo})
              ON CONFLICT (id) DO UPDATE SET
                nome = EXCLUDED.nome, marca = EXCLUDED.marca, cert = EXCLUDED.cert,
                kg_sacco = EXCLUDED.kg_sacco, sacchi_bancale = EXCLUDED.sacchi_bancale,
                scorta_min_bancali = EXCLUDED.scorta_min_bancali, costo = EXCLUDED.costo,
                updated_at = now()`;
    return { status: 'ok' };
  },

  // -> {status:'deleted'|'not_found'|'has_movimenti'}
  async deleteProdotto(id) {
    return tx(async (c) => {
      const lock = await c.query('SELECT id FROM prodotti WHERE id = $1 FOR UPDATE', [id]);
      if (lock.rows.length === 0) return { status: 'not_found' };
      const n = await c.query('SELECT 1 FROM movimenti WHERE prodotto_id = $1 LIMIT 1', [id]);
      if (n.rows.length > 0) return { status: 'has_movimenti' };
      await c.query('DELETE FROM prodotti WHERE id = $1', [id]);
      return { status: 'deleted' };
    });
  },

  // -> {status:'created'|'exists'|'no_product'|'insufficient', disponibili?}
  async insertMovimento(m) {
    return tx(async (c) => {
      // Blocca il prodotto: due scarichi simultanei non possono superare la giacenza.
      const lock = await c.query('SELECT id FROM prodotti WHERE id = $1 FOR UPDATE', [m.prodottoId]);
      if (lock.rows.length === 0) return { status: 'no_product' };
      const dup = await c.query('SELECT 1 FROM movimenti WHERE id = $1', [m.id]);
      if (dup.rows.length > 0) return { status: 'exists' };
      if (m.delta < 0) {
        const s = await c.query('SELECT COALESCE(SUM(delta), 0)::int AS giacenza FROM movimenti WHERE prodotto_id = $1', [m.prodottoId]);
        const giacenza = s.rows[0].giacenza;
        if (giacenza + m.delta < 0) return { status: 'insufficient', disponibili: giacenza };
      }
      const r = await c.query(
        `INSERT INTO movimenti (id, tipo, prodotto_id, delta, data, controparte, fattura, cmr, ricevuta, nota, ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [m.id, m.tipo, m.prodottoId, m.delta, m.data, m.controparte, m.fattura, m.cmr, m.ricevuta, m.nota, m.ts],
      );
      return { status: r.rowCount === 1 ? 'created' : 'exists' };
    });
  },

  async deleteMovimento(id) {
    const { sql } = getDb();
    await sql`DELETE FROM movimenti WHERE id = ${id}`;
    return { status: 'ok' };
  },
};
