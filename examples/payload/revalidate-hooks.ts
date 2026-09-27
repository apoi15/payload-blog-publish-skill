/**
 * Cache purge for writes made inside Next.js (the Payload admin).
 *
 * `revalidatePath` needs the Next.js request context. From a CLI script
 * (seed, `blog:publish`) it throws, so the hook swallows the error and the
 * script calls the /api/revalidate route instead (examples/next/revalidate-route.ts).
 */
import { revalidatePath } from 'next/cache'
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { ARTICLE_TARGETS } from '../next/revalidate-targets'

function purge(logger: { info: (message: string) => void }) {
  try {
    for (const [path, type] of ARTICLE_TARGETS) revalidatePath(path, type)
  } catch (error) {
    logger.info(`revalidate skipped outside Next.js: ${(error as Error).message}`)
  }
}

export const revalidateArticleAfterChange: CollectionAfterChangeHook = ({ doc, req }) => {
  purge(req.payload.logger)
  return doc
}

export const revalidateArticleAfterDelete: CollectionAfterDeleteHook = ({ doc, req }) => {
  purge(req.payload.logger)
  return doc
}
