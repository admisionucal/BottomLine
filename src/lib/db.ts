import { Client } from 'pg';
import type { Env } from '../types';

// Un client nuevo por request. En Workers esto es lo normal: Hyperdrive
// se encarga del pooling real por detrás, así que no hay que mantener
// conexiones abiertas nosotros mismos entre requests.
export async function getClient(env: Env): Promise<Client> {
  const client = new Client({ connectionString: env.RUMBO_DB.connectionString });
  await client.connect();
  return client;
}
