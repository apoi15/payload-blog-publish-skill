/**
 * Exports a published article (every locale) to the Markdown drafts that
 * `blog:publish` reads, so an existing article is edited in the same format a
 * new one is written in.
 *
 *   pnpm blog:export <default-locale-slug>                  # → output/blog-drafts/<slug>/
 *   pnpm blog:export <default-locale-slug> --out=<folder> [--force]
 *
 * Read-only. Inline images are downloaded into assets/ under their media
 * filename, so publishing reuses the same media documents. The cover is not
 * exported: leaving `cover` out of the default-locale draft keeps it.
 *
 * Every locale is converted back to Lexical and compared with the stored tree.
 * If anything would change (an unsupported node, a line break in a callout…),
 * the script exits 1 and the draft must not be used to republish the body.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { getPayload } from 'payload'
import config from '@payload-config'
import { stringify } from 'yaml'
import { blogConfig, fromLocaleData, sharedFieldNames, type BlogLocale } from './config'
import { resolveDatabase } from './database'
import { fromLexical, parseDraft, semanticLexical, toLexical } from './markdown'

const LOCALES = blogConfig.locales as readonly BlogLocale[]
const DEFAULT: BlogLocale = blogConfig.defaultLocale
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const slug = args.find((arg) => !arg.startsWith('--')) ?? fail('Usage: pnpm blog:export <slug> [--out=<folder>] [--force]')
  const out = path.resolve(args.find((arg) => arg.startsWith('--out='))?.split('=')[1] ?? path.join(blogConfig.draftsDir, slug))
  const force = args.includes('--force')

  const existingFiles = await fs.readdir(out).catch(() => [])
  if (existingFiles.length && !force) fail(`${out} is not empty; pass --force to overwrite the drafts in it (other files are kept).`)

  resolveDatabase()
  const payload = await getPayload({ config })
  const articles = blogConfig.collection as 'articles'
  const media = blogConfig.mediaCollection as 'media'

  const found = await payload.find({ collection: articles, where: { slug: { equals: slug } }, locale: DEFAULT, limit: 2, depth: 0 })
  if (found.docs.length !== 1) fail(`Expected one article with the ${DEFAULT} slug "${slug}", found ${found.docs.length}.`)
  const id = found.docs[0].id

  await fs.mkdir(path.join(out, 'assets'), { recursive: true })
  const report: Record<string, unknown> = {}
  let lossless = true
  const mediaCache = new Map<string, { filename: string; url: string; alt: Partial<Record<BlogLocale, string>> }>()

  const mediaDoc = async (mediaId: number | string) => {
    const key = String(mediaId)
    if (!mediaCache.has(key)) {
      const alt: Partial<Record<BlogLocale, string>> = {}
      let filename = ''
      let url = ''
      for (const locale of LOCALES) {
        const doc = (await payload.findByID({ collection: media, id: mediaId, locale, fallbackLocale: false, depth: 0 })) as AnyDoc
        filename = doc.filename ?? ''
        url = doc.url ?? ''
        if (doc.alt) alt[locale] = doc.alt
      }
      mediaCache.set(key, { filename, url, alt })
    }
    return mediaCache.get(key)!
  }

  for (const locale of LOCALES) {
    const doc = (await payload.findByID({ collection: articles, id, locale, fallbackLocale: false, depth: 0 })) as AnyDoc
    const fields = fromLocaleData(doc)
    if (!fields.title || !fields.slug) {
      report[locale] = 'no content in this locale — not exported'
      continue
    }

    // Resolve every image first so fromLexical can stay synchronous.
    const imageIds = ((fields.content as { root?: { children?: AnyDoc[] } } | null)?.root?.children ?? [])
      .filter((node) => node.type === 'block' && node.fields?.blockType === blogConfig.blocks.image)
      .map((node) => (typeof node.fields.image === 'object' ? node.fields.image.id : node.fields.image) as number | string)
    const warnings: string[] = []
    const images = new Map<string, { src: string; alt: string }>()
    for (const imageId of imageIds) {
      const file = await mediaDoc(imageId)
      const alt = file.alt[locale] ?? file.alt[DEFAULT] ?? ''
      if (!file.alt[locale]) warnings.push(`${file.filename}: no ${locale} alt text — the draft uses the ${DEFAULT} alt; translate it before publishing`)
      images.set(String(imageId), { src: `./assets/${file.filename}`, alt })
    }

    const { body, problems } = fromLexical(fields.content, (imageId) => images.get(String(imageId)) ?? { src: '', alt: '' })
    const frontMatter: Record<string, unknown> = {
      title: fields.title,
      slug: fields.slug,
      excerpt: fields.excerpt,
      takeaways: fields.takeaways,
      metaTitle: fields.metaTitle,
      metaDescription: fields.metaDescription,
      ...(locale === DEFAULT ? { category: doc[sharedFieldNames.category], publishedAt: doc[sharedFieldNames.publishedAt] } : {}),
    }
    const markdown = `---\n${stringify(frontMatter, { lineWidth: 0 })}---\n\n${body}`
    await fs.writeFile(path.join(out, `${locale}.md`), markdown)

    // Round trip: the draft must publish exactly the stored tree.
    const reparsed = parseDraft(markdown, locale)
    const mediaIds = Object.fromEntries([...images].map(([imageId, image]) => [image.src, imageId]))
    let equal = false
    try {
      equal = isDeepStrictEqual(semanticLexical(toLexical(reparsed.nodes, mediaIds)), semanticLexical(fields.content))
    } catch (error) {
      problems.push((error as Error).message)
    }
    const errors = [...problems, ...reparsed.errors.map((error) => `re-parse: ${error}`), ...(equal ? [] : ['round trip changes the content'])]
    if (errors.length) lossless = false
    report[locale] = { file: path.join(out, `${locale}.md`), lossless: errors.length === 0, ...(errors.length ? { errors } : {}), ...(warnings.length ? { warnings } : {}) }
  }

  // Download inline images so publish finds them locally (and reuses the media by filename).
  for (const file of mediaCache.values()) {
    const response = await fetch(file.url.startsWith('http') ? file.url : new URL(file.url, blogConfig.publicOrigin))
    if (!response.ok) {
      lossless = false
      report[`asset ${file.filename}`] = `download failed: HTTP ${response.status}`
      continue
    }
    await fs.writeFile(path.join(out, 'assets', file.filename), Buffer.from(await response.arrayBuffer()))
  }

  console.log(JSON.stringify({ ok: lossless, article: id, folder: out, images: mediaCache.size, cover: 'kept (not exported)', locales: report }, null, 2))
  process.exit(lossless ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
