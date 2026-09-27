/**
 * app/api/revalidate/route.ts — on-demand cache purge for CLI writes.
 *
 * Payload's afterChange hooks purge the cache when a document is saved in the
 * admin, but scripts run outside the Next.js runtime, so `blog:publish`
 * calls this endpoint after a production write instead of triggering a
 * redeploy. Only named scopes can be purged; the secret is compared in
 * constant time.
 *
 * Set REVALIDATE_SECRET in the hosting provider (production) and in the
 * local `.env` of whoever runs the publish script, with the same value.
 */
import { timingSafeEqual } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ARTICLE_TARGETS, type RevalidateTarget } from './revalidate-targets'

export const runtime = 'nodejs'

const SCOPES: Record<string, RevalidateTarget[]> = {
  articles: ARTICLE_TARGETS,
}

function isAuthorized(header: string | null, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header ?? '')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) return NextResponse.json({ error: 'Revalidation is not configured' }, { status: 503 })
  if (!isAuthorized(request.headers.get('authorization'), secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { scope?: unknown } | null
  const scope = typeof body?.scope === 'string' ? body.scope : ''
  if (!Object.hasOwn(SCOPES, scope)) {
    return NextResponse.json({ error: `scope must be one of: ${Object.keys(SCOPES).join(', ')}` }, { status: 400 })
  }

  for (const [path, type] of SCOPES[scope]) revalidatePath(path, type)
  return NextResponse.json({ ok: true, scope, paths: SCOPES[scope].map(([path, type]) => (type ? `${path} (${type})` : path)) })
}
