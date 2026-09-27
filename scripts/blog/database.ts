/**
 * Which database this process is about to write, decided before Payload connects.
 *
 * The guard is deliberately dumb: a host list and an explicit per-command flag.
 * An agent that forgets which `.env` it loaded still cannot touch production,
 * and every output line says which database it used.
 */
import { blogConfig } from './config'

export type DatabaseTarget = { host: string; production: boolean }

export function resolveDatabase(): DatabaseTarget {
  const url = process.env[blogConfig.databaseUrlEnv]
  if (!url) throw new Error(`${blogConfig.databaseUrlEnv} is not set`)
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    host = 'unparsed'
  }
  const production = blogConfig.productionDbHosts.some((known) => host === known || host.endsWith(`.${known}`))
  if (production && process.env.ALLOW_PRODUCTION_DB !== 'true') {
    throw new Error(`${host} is a production database. Re-run with ALLOW_PRODUCTION_DB=true only when writing production is intended.`)
  }
  if (!blogConfig.productionDbHosts.length) {
    console.error('[db] PRODUCTION_DB_HOSTS is empty: the production guard is off.')
  }
  console.error(`[db] ${production ? 'PRODUCTION' : 'development'} (${host})`)
  return { host, production }
}
