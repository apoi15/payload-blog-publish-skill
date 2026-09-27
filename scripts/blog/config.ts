/**
 * Everything the blog scripts need to know about your project.
 *
 * Edit this file after copying `scripts/blog/` into a Next.js + Payload 3
 * project. It must not import Payload or Next.js: the Markdown converter and
 * its tests load it without a database.
 */

export const blogConfig = {
  /** Payload localization codes, default locale first. One article = one document with every locale. */
  locales: ['en', 'es', 'fr'] as const,
  defaultLocale: 'en' as const,

  /** Collection slugs. */
  collection: 'articles',
  mediaCollection: 'media',

  /** Values of the article's `category` select field. */
  categories: ['guides', 'how-to', 'comparisons', 'news'] as const,

  /** Slugs of the Payload blocks the body may contain (see examples/payload/article-blocks.ts). */
  blocks: {
    image: 'articleImage',
    table: 'articleTable',
    callout: 'articleCallout',
    quote: 'articleQuote',
    cta: 'articleCta',
    video: 'articleVideo',
  },
  calloutTones: ['note', 'takeaway', 'warning'] as const,

  /** Page limits that the publish script enforces before anything is written. */
  seo: {
    metaTitleMax: 60,
    metaDescriptionMax: 160,
    /** Below this the dry run warns (not an error). */
    metaDescriptionMin: 120,
    /** Words that must not appear in a meta title, e.g. a brand the layout already appends. Case-insensitive. */
    forbiddenInMetaTitle: [] as string[],
  },
  maxTakeaways: 4,

  /** Where drafts live (keep it git-ignored). */
  draftsDir: 'output/blog-drafts',

  /**
   * Public site used for link checks, cache purges and image downloads.
   * Local `.env` files usually point NEXT_PUBLIC_SERVER_URL at localhost, so an
   * https value wins and BLOG_PUBLIC_ORIGIN is the explicit fallback.
   */
  publicOrigin: /^https:\/\//.test(process.env.NEXT_PUBLIC_SERVER_URL ?? '')
    ? process.env.NEXT_PUBLIC_SERVER_URL!
    : (process.env.BLOG_PUBLIC_ORIGIN ?? 'https://www.example.com'),

  /**
   * Production database guard. The scripts read the host of `databaseUrlEnv`;
   * if it is listed in PRODUCTION_DB_HOSTS (comma-separated), they refuse to
   * connect unless ALLOW_PRODUCTION_DB=true is set for that one command.
   */
  databaseUrlEnv: 'DATABASE_URL',
  productionDbHosts: (process.env.PRODUCTION_DB_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),

  /** POST endpoint that purges the ISR cache after a CLI write (examples/next/revalidate-route.ts). */
  revalidate: { path: '/api/revalidate', scope: 'articles', secretEnv: 'REVALIDATE_SECRET' },
}

export type BlogLocale = (typeof blogConfig.locales)[number]
export type BlogCategory = (typeof blogConfig.categories)[number]
export type CalloutTone = (typeof blogConfig.calloutTones)[number]

/** Default locale has no prefix (`/blog/x`); others do (`/es/blog/x`). Change it if your routing differs. */
export function localizedPath(locale: BlogLocale, path: string): string {
  if (locale === blogConfig.defaultLocale) return path
  return `/${locale}${path === '/' ? '' : path}`
}

export const articlePath = (locale: BlogLocale, slug: string) => localizedPath(locale, `/blog/${slug}`)

// ---------------------------------------------------------------------------
// Field mapping: the only place that knows your Articles collection's field names.
// ---------------------------------------------------------------------------

export type LocaleFields = {
  title: string
  slug: string
  excerpt: string
  takeaways: string[]
  metaTitle: string
  metaDescription: string
}

/** Draft front matter + Lexical body → the localized fields of one `payload.update({ locale })`. */
export function toLocaleData(fields: LocaleFields, content: unknown) {
  return {
    title: fields.title,
    slug: fields.slug,
    excerpt: fields.excerpt,
    keyTakeaways: fields.takeaways.join('\n'),
    content,
    seo: { metaTitle: fields.metaTitle, metaDescription: fields.metaDescription },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>

/** A document read with `locale` and `fallbackLocale: false` → the same shape, for export and read-back. */
export function fromLocaleData(doc: Doc): LocaleFields & { content: unknown } {
  return {
    title: doc.title ?? '',
    slug: doc.slug ?? '',
    excerpt: doc.excerpt ?? '',
    takeaways: String(doc.keyTakeaways ?? '')
      .split('\n')
      .map((line) => line.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean),
    metaTitle: doc.seo?.metaTitle ?? '',
    metaDescription: doc.seo?.metaDescription ?? '',
    content: doc.content,
  }
}

/** Non-localized fields, written once from the default-locale draft. */
export const sharedFieldNames = { category: 'category', publishedAt: 'publishedAt', cover: 'cover' } as const

/** Checks shared by the publish script and your Payload field validators, so both agree. */
export function validateMetaTitle(value: string): true | string {
  if (value.length > blogConfig.seo.metaTitleMax) return `${value.length} characters (max ${blogConfig.seo.metaTitleMax})`
  const word = blogConfig.seo.forbiddenInMetaTitle.find((forbidden) => value.toLowerCase().includes(forbidden.toLowerCase()))
  if (word) return `contains "${word}" (the layout appends it)`
  return true
}

export function validateMetaDescription(value: string): true | string {
  if (value.length > blogConfig.seo.metaDescriptionMax) return `${value.length} characters (max ${blogConfig.seo.metaDescriptionMax})`
  return true
}
