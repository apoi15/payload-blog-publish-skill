/**
 * Publishes one article (every configured locale) from Markdown drafts.
 *
 *   pnpm blog:publish output/blog-drafts/<slug>            # dry run: validate, check links, show create/update
 *   pnpm blog:publish output/blog-drafts/<slug> --apply    # write the database this process points at
 *   ALLOW_PRODUCTION_DB=true pnpm blog:publish output/blog-drafts/<slug> --apply
 *
 * Options: --locales=en,es   update only these locales of an existing article
 *          --skip-link-check skip the HTTP check of internal/external links
 *
 * The folder holds <locale>.md per locale and assets/ (format: ./markdown.ts).
 * The article is matched by its default-locale slug; the other locales are
 * written to the same document so the hreflang set stays intact. Media are
 * reused by filename, so re-running is safe. After a production write the
 * script calls the revalidate endpoint, because Payload's revalidate hooks
 * cannot purge the Next.js cache from a CLI process.
 *
 * stdout is a single JSON object; logs go to stderr.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import {
  articlePath,
  blogConfig,
  fromLocaleData,
  sharedFieldNames,
  toLocaleData,
  validateMetaDescription,
  validateMetaTitle,
  type BlogLocale,
} from './config'
import { resolveDatabase } from './database'
import { checkLinkLocale, extractLinks, parseDraft, semanticLexical, summarize, toLexical, type ParsedDraft } from './markdown'

const LOCALES = blogConfig.locales as readonly BlogLocale[]
const DEFAULT: BlogLocale = blogConfig.defaultLocale
const IMAGE_TYPES = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif'])
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

type Image = { src: string; file: string; alt: Partial<Record<BlogLocale, string>> }
// Payload's generated types differ per project; the script only relies on the fields in config.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const folder = args.find((arg) => !arg.startsWith('--')) ?? fail('Usage: pnpm blog:publish <article folder> [--apply] [--locales=en,es] [--skip-link-check]')
  const localesArg = args.find((arg) => arg.startsWith('--locales='))?.split('=')[1]
  const locales = localesArg ? (localesArg.split(',') as BlogLocale[]) : [...LOCALES]
  for (const locale of locales) if (!LOCALES.includes(locale)) fail(`Unknown locale "${locale}"`)
  return { folder: path.resolve(folder), apply: args.includes('--apply'), locales, skipLinkCheck: args.includes('--skip-link-check') }
}

async function readDrafts(folder: string, locales: BlogLocale[]) {
  const drafts = {} as Record<BlogLocale, ParsedDraft>
  // The default-locale file is always read: it carries the shared fields and the slug that identifies the article.
  for (const locale of new Set<BlogLocale>([DEFAULT, ...locales])) {
    const file = path.join(folder, `${locale}.md`)
    const source = await fs.readFile(file, 'utf8').catch(() => fail(`Missing ${file}`))
    drafts[locale] = parseDraft(source, locale)
  }
  return drafts
}

/** Every image the drafts reference, keyed by resolved file, with its alt text per locale. */
async function collectImages(folder: string, drafts: Record<BlogLocale, ParsedDraft>, locales: BlogLocale[], errors: string[]) {
  const images = new Map<string, Image>()
  const assets = path.join(folder, 'assets') + path.sep
  const add = (locale: BlogLocale, src: string, alt: string | undefined) => {
    const file = path.resolve(folder, src)
    if (!file.startsWith(assets)) {
      errors.push(`${locale}: image ${src} must live in the assets/ folder`)
      return
    }
    const image = images.get(file) ?? { src, file, alt: {} }
    if (alt) image.alt[locale] = alt
    images.set(file, image)
  }

  const cover = drafts[DEFAULT].shared.cover
  if (cover) {
    for (const locale of locales) {
      if (!drafts[locale].meta.coverAlt) errors.push(`${locale}: coverAlt is required when ${DEFAULT}.md sets a cover`)
      add(locale, cover, drafts[locale].meta.coverAlt)
    }
  }
  for (const locale of locales) {
    for (const node of drafts[locale].nodes) if (node.type === 'image') add(locale, node.src, node.alt)
  }

  for (const image of images.values()) {
    const name = path.basename(image.file)
    if (!IMAGE_TYPES.has(path.extname(name).toLowerCase())) errors.push(`${name}: use WebP, AVIF, JPEG or PNG`)
    const stat = await fs.stat(image.file).catch(() => null)
    if (!stat) errors.push(`${name}: file not found`)
    else if (stat.size > MAX_IMAGE_BYTES) errors.push(`${name}: larger than 15 MB`)
    for (const locale of locales) if (!image.alt[locale]) errors.push(`${name}: no ${locale} alt text (reference it in ${locale}.md, or set coverAlt)`)
  }
  return images
}

/** Internal links must answer 200 on the live site (redirects are errors: link the final URL). */
async function checkLinks(urls: string[]): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = []
  const warnings: string[] = []
  const unique = [...new Set(urls.filter((url) => url.startsWith('/') || /^https?:\/\//.test(url)))]
  await Promise.all(
    unique.map(async (url) => {
      const internal = url.startsWith('/')
      const target = internal ? new URL(url.split('#')[0], blogConfig.publicOrigin).toString() : url
      try {
        const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'payload-blog-publish/1.0' } })
        const status = response.status
        if (internal && status !== 200) {
          const location = response.headers.get('location')
          errors.push(`${url} → ${status}${location ? ` (redirects to ${location}; link the final URL)` : ''}`)
        } else if (!internal && status >= 400 && status !== 403 && status !== 429) {
          // Many sites block bots with 403/429; those are not reported.
          warnings.push(`${url} → ${status}`)
        }
      } catch (error) {
        ;(internal ? errors : warnings).push(`${url} → ${(error as Error).message}`)
      }
    }),
  )
  return { errors, warnings }
}

async function uploadImages(payload: Payload, images: Map<string, Image>, locales: BlogLocale[]) {
  const ids: Record<string, number | string> = {}
  const report: Record<string, string> = {}
  const media = blogConfig.mediaCollection as 'media'
  for (const image of images.values()) {
    const filename = path.basename(image.file)
    const found = await payload.find({ collection: media, where: { filename: { equals: filename } }, limit: 1, depth: 0 })
    let id: number | string
    if (found.docs[0]) {
      id = found.docs[0].id
      report[filename] = `reused #${id}`
    } else {
      const created = await payload.create({ collection: media, locale: DEFAULT, data: { alt: image.alt[DEFAULT] ?? image.alt[locales[0]]! } as AnyDoc, filePath: image.file })
      id = created.id
      report[filename] = `uploaded #${id}`
    }
    // Alt text is usually localized. Write every locale explicitly: a locale left empty would
    // either fall back to the default language or stay empty, depending on the page's query.
    for (const locale of locales) {
      const alt = image.alt[locale]
      if (!alt) continue
      const saved = (await payload.findByID({ collection: media, id, locale, fallbackLocale: false, depth: 0 })) as AnyDoc
      if (saved.alt !== alt) await payload.update({ collection: media, id, locale, data: { alt } as AnyDoc })
    }
    ids[image.file] = id
  }
  return { ids, report }
}

async function revalidate() {
  const { path: endpoint, scope, secretEnv } = blogConfig.revalidate
  const secret = process.env[secretEnv]
  if (!secret) return `skipped: ${secretEnv} is not set — save the article once in /admin to purge the cache`
  try {
    const response = await fetch(new URL(endpoint, blogConfig.publicOrigin), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope }),
      signal: AbortSignal.timeout(20000),
    })
    return response.ok ? 'ok' : `failed: HTTP ${response.status} — the article is written; retry the call or save it once in /admin`
  } catch (error) {
    return `failed: ${(error as Error).message} — the article is written; retry the call or save it once in /admin`
  }
}

async function main() {
  const { folder, apply, locales, skipLinkCheck } = parseArgs()
  const drafts = await readDrafts(folder, locales)
  const primary = drafts[DEFAULT]
  const errors: string[] = []
  const warnings: string[] = []

  for (const locale of Object.keys(drafts) as BlogLocale[]) {
    const { meta } = drafts[locale]
    errors.push(...drafts[locale].errors.map((message) => `${locale}.md: ${message}`))
    const title = validateMetaTitle(meta.metaTitle ?? '')
    if (title !== true) errors.push(`${locale}.md: metaTitle — ${title}`)
    const description = validateMetaDescription(meta.metaDescription ?? '')
    if (description !== true) errors.push(`${locale}.md: metaDescription — ${description}`)
    if (meta.metaDescription && meta.metaDescription.length < blogConfig.seo.metaDescriptionMin) {
      warnings.push(`${locale}.md: metaDescription is ${meta.metaDescription.length} characters (aim for ${blogConfig.seo.metaDescriptionMin}–${blogConfig.seo.metaDescriptionMax - 5})`)
    }
    for (const url of extractLinks(drafts[locale].nodes)) {
      const problem = checkLinkLocale(url, locale)
      if (problem) errors.push(`${locale}.md: ${problem}`)
    }
  }
  const slugs = locales.map((locale) => drafts[locale].meta.slug)
  if (new Set(slugs).size !== slugs.length) warnings.push('two locales share a slug — fine only if the phrase is identical in both languages')

  const images = await collectImages(folder, drafts, locales, errors)

  if (!skipLinkCheck) {
    const links = await checkLinks(locales.flatMap((locale) => extractLinks(drafts[locale].nodes)))
    errors.push(...links.errors.map((message) => `link: ${message}`))
    warnings.push(...links.warnings.map((message) => `external link: ${message}`))
  }

  const summary = Object.fromEntries(
    locales.map((locale) => {
      const { meta, nodes } = drafts[locale]
      return [
        locale,
        {
          url: articlePath(locale, meta.slug),
          title: meta.title,
          metaTitle: `${meta.metaTitle.length} chars`,
          metaDescription: `${meta.metaDescription.length} chars`,
          ...summarize(nodes),
        },
      ]
    }),
  )

  const database = resolveDatabase()
  const payload = await getPayload({ config })
  const articles = blogConfig.collection as 'articles'

  const existing = await payload.find({ collection: articles, where: { slug: { equals: primary.meta.slug } }, locale: DEFAULT, limit: 2, depth: 0 })
  if (existing.docs.length > 1) errors.push(`more than one article has the ${DEFAULT} slug ${primary.meta.slug}; resolve the duplicate first`)
  const current = existing.docs[0] as AnyDoc | undefined

  if (!current) {
    const missing = LOCALES.filter((locale) => !locales.includes(locale))
    if (missing.length) errors.push(`creating a new article needs every locale; missing ${missing.join(', ')}`)
    for (const key of ['cover', 'category', 'publishedAt'] as const) if (!primary.shared[key]) errors.push(`creating a new article needs "${key}" in ${DEFAULT}.md`)
    for (const locale of locales) {
      const { meta } = drafts[locale]
      if (meta.takeaways.length < 2) errors.push(`${locale}.md: a new article needs 2–${blogConfig.maxTakeaways} takeaways`)
      if (!meta.metaTitle || !meta.metaDescription) errors.push(`${locale}.md: a new article needs metaTitle and metaDescription`)
    }
  }
  for (const locale of locales) {
    const clash = await payload.find({
      collection: articles,
      where: { and: [{ slug: { equals: drafts[locale].meta.slug } }, ...(current ? [{ id: { not_equals: current.id } }] : [])] },
      locale,
      fallbackLocale: false,
      limit: 1,
      depth: 0,
    })
    if (clash.docs[0]) errors.push(`${locale} slug "${drafts[locale].meta.slug}" is already used by article #${clash.docs[0].id}`)
  }
  // Media are matched by filename across the whole library, so a new upload must carry a name unique to this article.
  for (const image of images.values()) {
    const name = path.basename(image.file)
    if (name.startsWith(`${primary.meta.slug}-`)) continue
    const known = await payload.find({ collection: blogConfig.mediaCollection as 'media', where: { filename: { equals: name } }, limit: 1, depth: 0 })
    if (!known.docs[0]) errors.push(`${name}: new asset filenames must start with "${primary.meta.slug}-" (media are reused by filename)`)
  }

  if (errors.length) {
    console.log(JSON.stringify({ ok: false, errors, warnings }, null, 2))
    process.exit(1)
  }

  const plan = {
    database: `${database.production ? 'PRODUCTION' : 'development'} (${database.host})`,
    action: current ? `update article #${current.id}` : 'create',
    locales,
    cover: primary.shared.cover ? path.basename(primary.shared.cover) : 'unchanged',
    images: images.size,
  }

  if (!apply) {
    console.log(JSON.stringify({ ok: true, mode: 'dry-run', ...plan, warnings, summary }, null, 2))
    process.exit(0)
  }

  const { ids, report } = await uploadImages(payload, images, locales)
  const mediaFor = (locale: BlogLocale) =>
    Object.fromEntries(drafts[locale].nodes.flatMap((node) => (node.type === 'image' ? [[node.src, ids[path.resolve(folder, node.src)]]] : [])))
  const localeData = (locale: BlogLocale) => toLocaleData(drafts[locale].meta, toLexical(drafts[locale].nodes, mediaFor(locale)))
  const shared = {
    ...(primary.shared.category ? { [sharedFieldNames.category]: primary.shared.category } : {}),
    ...(primary.shared.publishedAt ? { [sharedFieldNames.publishedAt]: primary.shared.publishedAt } : {}),
    ...(primary.shared.cover ? { [sharedFieldNames.cover]: ids[path.resolve(folder, primary.shared.cover)] } : {}),
  }

  // Create (or update) in one locale, then add every other locale to the same document.
  const first: BlogLocale = locales.includes(DEFAULT) ? DEFAULT : locales[0]
  const doc = (
    current
      ? await payload.update({ collection: articles, id: current.id, locale: first, data: { ...localeData(first), ...shared } as AnyDoc })
      : await payload.create({ collection: articles, locale: DEFAULT, data: { ...localeData(DEFAULT), ...shared } as AnyDoc })
  ) as AnyDoc
  for (const locale of locales.filter((locale) => locale !== first)) {
    await payload.update({ collection: articles, id: doc.id, locale, data: localeData(locale) as AnyDoc })
  }

  // Read every locale back without fallback and compare with what was sent.
  const mismatches: string[] = []
  for (const locale of locales) {
    const saved = fromLocaleData((await payload.findByID({ collection: articles, id: doc.id, locale, fallbackLocale: false, depth: 0 })) as AnyDoc)
    const expected = fromLocaleData(localeData(locale))
    for (const key of ['title', 'slug', 'excerpt', 'metaTitle', 'metaDescription'] as const) {
      if (saved[key] !== expected[key]) mismatches.push(`${locale}.${key}`)
    }
    if (!isDeepStrictEqual(saved.takeaways, expected.takeaways)) mismatches.push(`${locale}.takeaways`)
    if (!isDeepStrictEqual(semanticLexical(saved.content), semanticLexical(expected.content))) mismatches.push(`${locale}.content`)
  }

  const revalidation = database.production ? await revalidate() : 'skipped: development database (next dev does not cache)'

  console.log(
    JSON.stringify(
      {
        ok: mismatches.length === 0,
        mode: 'apply',
        ...plan,
        action: current ? `updated article #${doc.id}` : `created article #${doc.id}`,
        media: report,
        readBack: mismatches.length ? { mismatches } : 'all locales match',
        revalidation,
        warnings,
        summary,
      },
      null,
      2,
    ),
  )
  process.exit(mismatches.length ? 1 : 0)
}

main().catch((error) => {
  const details = (error as { data?: { errors?: unknown } })?.data?.errors
  if (details) console.error(JSON.stringify(details, null, 2))
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
