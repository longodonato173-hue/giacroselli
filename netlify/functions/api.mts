import type { Config } from '@netlify/functions';
import { createHandler } from '../lib/handler.mjs';
import { store } from '../lib/store.mjs';

export default async (req: Request): Promise<Response> => {
  const handle = createHandler({ store });
  return handle(req);
};

export const config: Config = {
  path: '/api/*',
  // Forma verificata sulla documentazione Netlify (senza "action": le richieste in eccesso ricevono 429).
  // Limite generoso: più persone del negozio possono stare dietro lo stesso IP e la pagina fa polling.
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
