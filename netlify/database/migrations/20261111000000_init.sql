-- Schema iniziale: prodotti e movimenti di magazzino. Non modificare dopo il primo deploy:
-- per cambiamenti futuri aggiungere un nuovo file con timestamp successivo.

CREATE TABLE prodotti (
  id                 text PRIMARY KEY,
  nome               text NOT NULL,
  marca              text NOT NULL DEFAULT '',
  cert               text NOT NULL DEFAULT '',
  kg_sacco           numeric NOT NULL CHECK (kg_sacco > 0),
  sacchi_bancale     integer NOT NULL CHECK (sacchi_bancale >= 1),
  scorta_min_bancali numeric NOT NULL DEFAULT 0 CHECK (scorta_min_bancali >= 0),
  costo              numeric NOT NULL DEFAULT 0 CHECK (costo >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE movimenti (
  id          text PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('carico', 'scarico', 'rettifica')),
  prodotto_id text NOT NULL REFERENCES prodotti(id),
  delta       integer NOT NULL CHECK (delta <> 0),
  data        date NOT NULL,
  controparte text NOT NULL DEFAULT '',
  fattura     text NOT NULL DEFAULT '',
  cmr         text NOT NULL DEFAULT '',
  ricevuta    text CHECK (ricevuta IN ('si', 'no')),
  nota        text NOT NULL DEFAULT '',
  ts          bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX movimenti_prodotto_id_idx ON movimenti (prodotto_id);
CREATE INDEX movimenti_data_idx ON movimenti (data);
