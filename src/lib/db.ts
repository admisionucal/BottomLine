import { Client } from 'pg';
import type { Env } from '../types';

export async function getClient(env: Env): Promise<Client> {
  const client = new Client({ connectionString: env.RUMBO_DB.connectionString });
  await client.connect();
  return client;
}
