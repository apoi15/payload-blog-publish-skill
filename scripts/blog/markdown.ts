/**
 * Markdown ⇄ Payload Lexical, for `blog:publish` and `blog:export`.
 *
 * One article is one folder with `<locale>.md` per locale and `assets/`.
 * Each file carries YAML front matter for its locale and a body in a strict
 * Markdown subset that maps one-to-one onto what the article template renders:
 *
 *   ## / ###                  → heading (the page owns the H1)
 *   paragraphs, - / 1. lists  → paragraph / list, with **bold**, *italic*, `code`, [links](/path)
 *   ![alt](./assets/x.webp "caption")  on its own line → image block
 *   Table: Title  + GFM table → table block (the title line is optional)
 *   > quote                   → quote (Lexical's native block quote)
 *   :::quote   attribution: …   text   :::  → pull-quote block
 *   :::callout note|takeaway|warning   title: …   body   :::  → callout block
 *   :::cta   eyebrow: …  title: …  buttonLabel: …   body   :::  → call-to-action block
 *   :::video   youtube: …  title: …  uploadDate: YYYY-MM-DD  duration: seconds   caption   :::  → video block
 *
 * Anything outside the subset (H1, H4+, code fences, HTML, inline images,
 * bare URLs, "•" bullets, nested lists) is rejected rather than approximated,
 * so a draft never publishes differently from how it reads.
 */
import { randomBytes } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { blogConfig, type BlogCategory, type BlogLocale, type CalloutTone, type LocaleFields } from './config'

const { blocks: BLOCK, calloutTones: CALLOUT_TONES, categories: CATEGORIES, locales: LOCALES, defaultLocale: DEFAULT_LOCALE } = blogConfig

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

export type LocaleFrontMatter = LocaleFields & {
  /** Alt text of the cover in this locale (required whenever the default locale sets `cover`). */
  coverAlt?: string
}

/** Fields shared by all locales; only allowed in the default-locale file. */
export type SharedFrontMatter = {
  category?: BlogCategory
  publishedAt?: string
  /** Path relative to the article folder; omit on an update to keep the current cover. */
  cover?: string
}

const LOCALE_KEYS = ['title', 'slug', 'excerpt', 'takeaways', 'metaTitle', 'metaDescription', 'coverAlt']
const SHARED_KEYS = ['category', 'publishedAt', 'cover']

export class DraftError extends Error {}

function splitFrontMatter(source: string): { data: Record<string, unknown>; body: string; bodyLine: number } {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!match) throw new DraftError('missing YAML front matter (--- … ---) at the top of the file')
  const data = parseYaml(match[1])
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DraftError('front matter must be a YAML mapping')
  return { data: data as Record<string, unknown>, body: text.slice(match[0].length), bodyLine: match[0].split('\n').length }
}

const str = (data: Record<string, unknown>, key: string, errors: string[], required = true): string | undefined => {
  const value = data[key]
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(`front matter: "${key}" is required`)
    return undefined
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') {
    errors.push(`front matter: "${key}" must be a string`)
    return undefined
  }
  return value.trim()
}

/** youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID or a bare 11-character ID. */
export function parseYouTubeId(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  const match = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(trimmed)
  return match ? match[1] : null
}

// ---------------------------------------------------------------------------
// Body → intermediate nodes
// ---------------------------------------------------------------------------

export type DraftNode =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'image'; src: string; alt: string; caption?: string }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][] }
  | { type: 'callout'; tone: CalloutTone; title: string; body: string }
  | { type: 'blockquote'; text: string }
  | { type: 'quote'; quote: string; attribution?: string }
  | { type: 'cta'; eyebrow?: string; title: string; body: string; buttonLabel?: string }
  | { type: 'video'; youtubeId: string; title: string; caption?: string; uploadDate?: string; durationSeconds?: number }

const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)$/
const TABLE_ROW = /^\|.*\|$/
const TABLE_RULE = /^\|(\s*:?-{3,}:?\s*\|)+$/
const LIST_ITEM = /^(?:([-*+])|(\d+)[.)])\s+(.*)$/

const cells = (row: string) =>
  row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())

/** Inline checks shared by every text that ends up in a rich-text node. */
function checkInline(text: string, where: string, errors: string[]) {
  if (/!\[/.test(text)) errors.push(`${where}: images must stand on their own line`)
  if (/<\/?[a-z][^>]*>/i.test(text)) errors.push(`${where}: HTML is not allowed`)
  if (/•/.test(text)) errors.push(`${where}: use a real Markdown list instead of "•"`)
  const withoutLinks = text.replace(/\[[^\]]*\]\([^)]*\)/g, '')
  if (/https?:\/\//.test(withoutLinks)) errors.push(`${where}: bare URL — write it as a [descriptive link](url)`)
}

export function parseBody(body: string, firstLine = 1): { nodes: DraftNode[]; errors: string[] } {
  const lines = body.split('\n')
  const nodes: DraftNode[] = []
  const errors: string[] = []
  let i = 0
  const at = (index: number) => `line ${index + firstLine}`

  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length
      if (level === 2 || level === 3) {
        checkInline(heading[2], at(i), errors)
        nodes.push({ type: 'heading', level, text: heading[2].trim() })
      } else if (level === 1) {
        errors.push(`${at(i)}: no H1 in the body — the page renders "title" as the H1`)
      } else {
        errors.push(`${at(i)}: only ## and ### headings are supported`)
      }
      i++
      continue
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      errors.push(`${at(i)}: code blocks are not supported in articles`)
      i++
      while (i < lines.length && !/^(```|~~~)/.test(lines[i].trim())) i++
      i++
      continue
    }

    // Directives: :::name [arg]  key: value lines, a blank line, body text, :::
    const directive = /^:::(\w+)(?:\s+(\S+))?\s*$/.exec(trimmed)
    if (directive) {
      const start = i
      const [, name, arg] = directive
      const content: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== ':::') content.push(lines[i++])
      if (i >= lines.length) {
        errors.push(`${at(start)}: ":::${name}" is never closed with ":::"`)
        break
      }
      i++
      const fields: Record<string, string> = {}
      let cursor = 0
      while (cursor < content.length && /^\s*$/.test(content[cursor])) cursor++
      for (; cursor < content.length; cursor++) {
        const field = /^(\w+):\s*(.*)$/.exec(content[cursor].trim())
        if (!field) break
        fields[field[1]] = field[2].trim()
      }
      const text = content.slice(cursor).join('\n').trim().replace(/\s*\n\s*/g, ' ')
      const allow = (keys: string[]) => {
        for (const key of Object.keys(fields)) if (!keys.includes(key)) errors.push(`${at(start)}: unknown ${name} field "${key}"`)
      }
      if (name === 'callout') {
        const tone = (arg ?? CALLOUT_TONES[0]) as CalloutTone
        if (!(CALLOUT_TONES as readonly string[]).includes(tone)) errors.push(`${at(start)}: callout tone must be one of ${CALLOUT_TONES.join(', ')}`)
        if (!fields.title) errors.push(`${at(start)}: callout needs "title: …"`)
        if (!text) errors.push(`${at(start)}: callout needs body text`)
        allow(['title'])
        nodes.push({ type: 'callout', tone, title: fields.title ?? '', body: text })
      } else if (name === 'cta') {
        if (!fields.title) errors.push(`${at(start)}: cta needs "title: …"`)
        if (!text) errors.push(`${at(start)}: cta needs body text`)
        allow(['eyebrow', 'title', 'buttonLabel'])
        nodes.push({ type: 'cta', eyebrow: fields.eyebrow, title: fields.title ?? '', body: text, buttonLabel: fields.buttonLabel })
      } else if (name === 'quote') {
        if (!text) errors.push(`${at(start)}: quote needs text`)
        allow(['attribution'])
        nodes.push({ type: 'quote', quote: text, attribution: fields.attribution })
      } else if (name === 'video') {
        const youtubeId = parseYouTubeId(fields.youtube)
        if (!youtubeId) errors.push(`${at(start)}: video needs "youtube: <link or 11-character ID>"`)
        if (!fields.title) errors.push(`${at(start)}: video needs "title: …"`)
        if (fields.uploadDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.uploadDate)) errors.push(`${at(start)}: video uploadDate must be YYYY-MM-DD`)
        if (fields.duration && !/^[1-9]\d*$/.test(fields.duration)) errors.push(`${at(start)}: video duration must be whole seconds`)
        allow(['youtube', 'title', 'uploadDate', 'duration'])
        if (text) checkInline(text, at(start), errors)
        nodes.push({
          type: 'video',
          youtubeId: youtubeId ?? '',
          title: fields.title ?? '',
          caption: text || undefined,
          uploadDate: fields.uploadDate ? `${fields.uploadDate}T00:00:00.000Z` : undefined,
          durationSeconds: fields.duration ? Number(fields.duration) : undefined,
        })
      } else {
        errors.push(`${at(start)}: unknown block ":::${name}" (use callout, cta, quote or video)`)
      }
      continue
    }

    if (trimmed.startsWith('![')) {
      const image = IMAGE_LINE.exec(trimmed)
      if (!image) {
        errors.push(`${at(i)}: image must be written as ![alt](./assets/file.webp "optional caption") on its own line`)
      } else {
        const [, alt, src, caption] = image
        if (!alt.trim()) errors.push(`${at(i)}: image needs alt text describing what it shows`)
        if (/^[a-z]+:\/\//i.test(src) || src.startsWith('/')) errors.push(`${at(i)}: image must be a relative path inside assets/, not "${src}"`)
        nodes.push({ type: 'image', src, alt: alt.trim(), caption: caption?.trim() || undefined })
      }
      i++
      continue
    }

    const tableTitle = /^Table:\s*(.+)$/.exec(trimmed)
    if (TABLE_ROW.test(trimmed) || (tableTitle && TABLE_ROW.test(lines[i + 1]?.trim() ?? ''))) {
      const start = i
      const title = tableTitle ? tableTitle[1].trim() : undefined
      if (tableTitle) i++
      const rows: string[] = []
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) rows.push(lines[i++].trim())
      if (rows.length < 3 || !TABLE_RULE.test(rows[1].replace(/\s/g, ''))) {
        errors.push(`${at(start)}: a table needs a header row, a |---| rule and at least one data row`)
        continue
      }
      const columns = cells(rows[0])
      const body = rows.slice(2).map(cells)
      if (columns.length < 2) errors.push(`${at(start)}: a table needs at least two columns`)
      body.forEach((row, index) => {
        if (row.length !== columns.length) errors.push(`${at(start)}: table row ${index + 1} has ${row.length} cells, expected ${columns.length}`)
      })
      nodes.push({ type: 'table', title, columns, rows: body })
      continue
    }

    if (trimmed.startsWith('>')) {
      const start = i
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) quoteLines.push(lines[i++].trim().replace(/^>\s?/, ''))
      const text = quoteLines.join(' ').replace(/\s+/g, ' ').trim()
      if (!text) errors.push(`${at(start)}: empty quote`)
      checkInline(text, at(start), errors)
      nodes.push({ type: 'blockquote', text })
      continue
    }

    const item = LIST_ITEM.exec(trimmed)
    if (item) {
      const ordered = Boolean(item[2])
      const items: string[] = []
      while (i < lines.length) {
        const current = LIST_ITEM.exec(lines[i].trim())
        if (current && !/^\s{2,}/.test(lines[i]) && Boolean(current[2]) === ordered) {
          items.push(current[3].trim())
          i++
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          if (LIST_ITEM.test(lines[i].trim())) errors.push(`${at(i)}: nested lists are not supported`)
          items[items.length - 1] += ` ${lines[i].trim()}`
          i++
        } else break
      }
      items.forEach((text) => checkInline(text, at(i - 1), errors))
      nodes.push({ type: 'list', ordered, items })
      continue
    }

    // Paragraph: consecutive plain lines
    const start = i
    const paragraph: string[] = []
    while (i < lines.length) {
      const current = lines[i].trim()
      if (!current || /^(#{1,6}\s|:::|!\[|>|\||```|~~~)/.test(current) || LIST_ITEM.test(current)) break
      paragraph.push(current)
      i++
    }
    const text = paragraph.join(' ')
    checkInline(text, at(start), errors)
    nodes.push({ type: 'paragraph', text })
  }

  return { nodes, errors }
}

// ---------------------------------------------------------------------------
// Whole draft file
// ---------------------------------------------------------------------------

export type ParsedDraft = {
  locale: BlogLocale
  meta: LocaleFrontMatter
  shared: SharedFrontMatter
  nodes: DraftNode[]
  errors: string[]
}

export function parseDraft(source: string, locale: BlogLocale): ParsedDraft {
  const errors: string[] = []
  let data: Record<string, unknown> = {}
  let body = ''
  let bodyLine = 1
  try {
    ;({ data, body, bodyLine } = splitFrontMatter(source))
  } catch (error) {
    return { locale, meta: {} as LocaleFrontMatter, shared: {}, nodes: [], errors: [(error as Error).message] }
  }

  for (const key of Object.keys(data)) {
    if (SHARED_KEYS.includes(key)) {
      if (locale !== DEFAULT_LOCALE) errors.push(`front matter: "${key}" is shared by all locales — set it in ${DEFAULT_LOCALE}.md only`)
    } else if (!LOCALE_KEYS.includes(key)) {
      errors.push(`front matter: unknown key "${key}"`)
    }
  }

  // takeaways / metaTitle / metaDescription may be empty on an exported older article;
  // the publish script requires them for a new one.
  const takeaways = Array.isArray(data.takeaways) ? data.takeaways.map((item) => String(item).trim()).filter(Boolean) : []
  if (data.takeaways != null && !Array.isArray(data.takeaways)) errors.push('front matter: "takeaways" must be a list')
  else if (takeaways.length > blogConfig.maxTakeaways) errors.push(`front matter: "takeaways" has more than ${blogConfig.maxTakeaways} items`)

  const meta: LocaleFrontMatter = {
    title: str(data, 'title', errors) ?? '',
    slug: str(data, 'slug', errors) ?? '',
    excerpt: str(data, 'excerpt', errors) ?? '',
    takeaways,
    metaTitle: str(data, 'metaTitle', errors, false) ?? '',
    metaDescription: str(data, 'metaDescription', errors, false) ?? '',
    coverAlt: str(data, 'coverAlt', errors, false),
  }
  if (meta.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) errors.push(`front matter: slug "${meta.slug}" must be lowercase ASCII words joined by hyphens`)

  const shared: SharedFrontMatter = {}
  if (locale === DEFAULT_LOCALE) {
    const category = str(data, 'category', errors, false)
    if (category !== undefined) {
      if ((CATEGORIES as readonly string[]).includes(category)) shared.category = category as BlogCategory
      else errors.push(`front matter: category must be one of ${CATEGORIES.join(', ')}`)
    }
    const publishedAt = str(data, 'publishedAt', errors, false)
    if (publishedAt !== undefined) {
      if (Number.isNaN(Date.parse(publishedAt))) errors.push(`front matter: publishedAt "${publishedAt}" is not a date`)
      else shared.publishedAt = new Date(publishedAt).toISOString()
    }
    shared.cover = str(data, 'cover', errors, false)
  }

  const parsed = parseBody(body, bodyLine)
  errors.push(...parsed.errors)
  if (!parsed.nodes.some((node) => node.type === 'heading' && node.level === 2)) errors.push('body: needs at least one ## section')

  return { locale, meta, shared, nodes: parsed.nodes, errors }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function extractLinks(nodes: DraftNode[]): string[] {
  const texts = nodes.flatMap((node) => {
    switch (node.type) {
      case 'heading':
      case 'paragraph':
      case 'blockquote':
        return [node.text]
      case 'list':
        return node.items
      default:
        return []
    }
  })
  return texts.flatMap((text) => [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]))
}

/** Internal links must stay inside the page's own locale; default-locale paths carry no prefix. */
export function checkLinkLocale(url: string, locale: BlogLocale): string | null {
  if (!url.startsWith('/')) return null
  const others = LOCALES.filter((code) => code !== DEFAULT_LOCALE)
  const prefix = new RegExp(`^/(${others.join('|')})(?:/|$)`).exec(url)?.[1]
  if (locale === DEFAULT_LOCALE && prefix) return `${DEFAULT_LOCALE} link points at the ${prefix} site: ${url}`
  if (locale !== DEFAULT_LOCALE && prefix !== locale) return `${locale} link must start with /${locale}/: ${url}`
  return null
}

// ---------------------------------------------------------------------------
// Draft metrics
// ---------------------------------------------------------------------------

/** Visible words of the body (link targets and Markdown markers excluded). Space-separated scripts only. */
export function wordCount(nodes: DraftNode[]): number {
  const texts = nodes.flatMap((node): string[] => {
    switch (node.type) {
      case 'heading':
      case 'paragraph':
      case 'blockquote':
        return [node.text]
      case 'list':
        return node.items
      case 'table':
        return [node.title ?? '', ...node.columns, ...node.rows.flat()]
      case 'callout':
        return [node.title, node.body]
      case 'quote':
        return [node.quote]
      case 'cta':
        return [node.title, node.body]
      default:
        return []
    }
  })
  return texts.map(plainText).join(' ').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/**
 * FAQ questions as the page's FAQPage JSON-LD should see them: an H2 section
 * whose H3s all end with "?" (full-width "？" and Spanish "¿…?" included).
 */
export function faqQuestions(nodes: DraftNode[]): string[] {
  const questions: string[] = []
  let section: string[] | null = null
  const flush = () => {
    if (section?.length && section.every((q) => /[?？]$/.test(q))) questions.push(...section)
  }
  for (const node of nodes) {
    if (node.type !== 'heading') continue
    if (node.level === 2) {
      flush()
      section = []
    } else section?.push(plainText(node.text))
  }
  flush()
  return questions
}

export function summarize(nodes: DraftNode[]) {
  const count = (predicate: (node: DraftNode) => boolean) => nodes.filter(predicate).length
  const links = extractLinks(nodes)
  return {
    words: wordCount(nodes),
    faqs: faqQuestions(nodes).length,
    h2: count((node) => node.type === 'heading' && node.level === 2),
    h3: count((node) => node.type === 'heading' && node.level === 3),
    paragraphs: count((node) => node.type === 'paragraph'),
    lists: count((node) => node.type === 'list'),
    tables: count((node) => node.type === 'table'),
    images: count((node) => node.type === 'image'),
    callouts: count((node) => node.type === 'callout'),
    blockquotes: count((node) => node.type === 'blockquote'),
    pullQuotes: count((node) => node.type === 'quote'),
    ctas: count((node) => node.type === 'cta'),
    videos: count((node) => node.type === 'video'),
    internalLinks: links.filter((url) => url.startsWith('/')).length,
    externalLinks: links.filter((url) => /^https?:\/\//.test(url)).length,
  }
}

// ---------------------------------------------------------------------------
// Draft → Lexical
// ---------------------------------------------------------------------------

const base = { direction: 'ltr', format: '', indent: 0, version: 1 }
const FORMAT = { bold: 1, italic: 2, code: 16 } as const
const textNode = (text: string, format = 0) => ({ type: 'text', text, format, detail: 0, mode: 'normal', style: '', version: 1 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LexicalNode = Record<string, any>

/** `[label](url)`, `**bold**`, `*italic*`, `` `code` `` → Lexical inline nodes (nesting inside emphasis allowed). */
export function inlineNodes(markdown: string, format = 0): LexicalNode[] {
  const nodes: LexicalNode[] = []
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g
  let cursor = 0
  for (const match of markdown.matchAll(pattern)) {
    if (match.index > cursor) nodes.push(textNode(markdown.slice(cursor, match.index), format))
    const [, label, url, bold, italic, code] = match
    if (label !== undefined) {
      nodes.push({
        type: 'link',
        children: inlineNodes(label, format),
        ...base,
        version: 3,
        fields: { linkType: 'custom', newTab: /^https?:\/\//.test(url), url },
      })
    } else if (bold !== undefined) nodes.push(...inlineNodes(bold, format | FORMAT.bold))
    else if (italic !== undefined) nodes.push(...inlineNodes(italic, format | FORMAT.italic))
    else nodes.push(textNode(code, format | FORMAT.code))
    cursor = match.index + match[0].length
  }
  if (cursor < markdown.length) nodes.push(textNode(markdown.slice(cursor), format))
  return nodes
}

/** Table cells and block fields are plain text: drop link targets and emphasis markers. */
export const plainText = (markdown: string) =>
  markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')

const objectId = () => randomBytes(12).toString('hex')
const blockNode = (fields: Record<string, unknown>) => ({
  type: 'block',
  version: 2,
  format: '',
  fields: { id: objectId(), blockName: '', ...fields },
})

/** `mediaIds` maps an image `src` (as written in the draft) to its media document id. */
export function toLexical(nodes: DraftNode[], mediaIds: Record<string, number | string>) {
  const children = nodes.map((node): LexicalNode => {
    switch (node.type) {
      case 'heading':
        return { type: 'heading', tag: `h${node.level}`, children: inlineNodes(node.text), ...base }
      case 'paragraph':
        return { type: 'paragraph', children: inlineNodes(node.text), ...base, textFormat: 0, textStyle: '' }
      case 'blockquote':
        return { type: 'quote', children: inlineNodes(node.text), ...base }
      case 'list':
        return {
          type: 'list',
          listType: node.ordered ? 'number' : 'bullet',
          tag: node.ordered ? 'ol' : 'ul',
          start: 1,
          ...base,
          children: node.items.map((item, index) => ({ type: 'listitem', value: index + 1, children: inlineNodes(item), ...base })),
        }
      case 'image': {
        const id = mediaIds[node.src]
        if (id === undefined) throw new DraftError(`no uploaded media for ${node.src}`)
        return blockNode({ blockType: BLOCK.image, image: id, caption: node.caption })
      }
      case 'table':
        return blockNode({
          blockType: BLOCK.table,
          title: node.title ? plainText(node.title) : undefined,
          columns: node.columns.map((label) => ({ label: plainText(label) })),
          rows: node.rows.map((row) => ({ cells: row.map((value) => ({ value: plainText(value) })) })),
        })
      case 'callout':
        return blockNode({ blockType: BLOCK.callout, tone: node.tone, title: plainText(node.title), body: plainText(node.body) })
      case 'quote':
        return blockNode({ blockType: BLOCK.quote, quote: plainText(node.quote), attribution: node.attribution })
      case 'cta':
        return blockNode({ blockType: BLOCK.cta, eyebrow: node.eyebrow, title: plainText(node.title), body: plainText(node.body), buttonLabel: node.buttonLabel })
      case 'video':
        return blockNode({
          blockType: BLOCK.video,
          youtubeId: node.youtubeId,
          title: plainText(node.title),
          caption: node.caption ? plainText(node.caption) : undefined,
          uploadDate: node.uploadDate,
          durationSeconds: node.durationSeconds,
        })
    }
  })
  return { root: { type: 'root', ...base, children } }
}

// ---------------------------------------------------------------------------
// Lexical → Markdown (blog:export), proven lossless by a round trip
// ---------------------------------------------------------------------------

type ExportImage = (id: number | string) => { src: string; alt: string }

function inlineMarkdown(children: LexicalNode[] = [], where: string, problems: string[]): string {
  return children
    .map((child) => {
      if (child.type === 'text') {
        const text = String(child.text ?? '')
        if (text.includes('\n')) problems.push(`${where}: line break inside a text run`)
        if (/[*`]|\[[^\]]*\]\(/.test(text)) problems.push(`${where}: text contains Markdown characters (* \` or [..](..)) that would not survive a round trip`)
        const format = Number(child.format ?? 0)
        if (format & ~(FORMAT.bold | FORMAT.italic | FORMAT.code)) problems.push(`${where}: unsupported text format ${format} (underline/strikethrough/…)`)
        if (!text.trim()) return text
        if (format & FORMAT.code) return `\`${text}\``
        // Keep surrounding spaces outside the markers so **bold** stays valid Markdown.
        const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
        let out = core
        if (format & FORMAT.italic) out = `*${out}*`
        if (format & FORMAT.bold) out = `**${out}**`
        return `${lead}${out}${trail}`
      }
      if (child.type === 'link') {
        const url = child.fields?.url
        if (child.fields?.linkType !== 'custom' || typeof url !== 'string') {
          problems.push(`${where}: internal (document) link — replace it with a URL before exporting`)
          return ''
        }
        return `[${inlineMarkdown(child.children, where, problems)}](${url})`
      }
      if (child.type === 'linebreak') {
        problems.push(`${where}: line break inside a paragraph`)
        return ' '
      }
      problems.push(`${where}: unsupported inline node "${child.type}"`)
      return ''
    })
    .join('')
}

const cellText = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|')

/** Converts stored article content to the draft Markdown body. `problems` lists anything that cannot be represented. */
export function fromLexical(content: unknown, image: ExportImage): { body: string; problems: string[] } {
  const problems: string[] = []
  const children: LexicalNode[] = (content as { root?: { children?: LexicalNode[] } } | null)?.root?.children ?? []
  const parts = children.map((node, index) => {
    const where = `node ${index + 1}`
    switch (node.type) {
      case 'heading':
        if (node.tag !== 'h2' && node.tag !== 'h3') problems.push(`${where}: ${node.tag} heading (only h2/h3 are supported)`)
        return `${node.tag === 'h3' ? '###' : '##'} ${inlineMarkdown(node.children, where, problems)}`
      case 'paragraph': {
        const text = inlineMarkdown(node.children, where, problems)
        if (!text.trim()) problems.push(`${where}: empty paragraph`)
        return text
      }
      case 'quote':
        return `> ${inlineMarkdown(node.children, where, problems)}`
      case 'list': {
        const ordered = node.listType === 'number'
        if (node.listType === 'check') problems.push(`${where}: checklist`)
        return (node.children ?? [])
          .map((item: LexicalNode, itemIndex: number) => {
            if ((item.children ?? []).some((child: LexicalNode) => child.type === 'list')) problems.push(`${where}: nested list`)
            return `${ordered ? `${itemIndex + 1}.` : '-'} ${inlineMarkdown(item.children, where, problems)}`
          })
          .join('\n')
      }
      case 'block': {
        const fields = { ...node.fields }
        // Block text fields render inside a single <p>, so a stored line break shows as a space; write it as one.
        for (const key of Object.keys(fields)) if (typeof fields[key] === 'string') fields[key] = fields[key].replace(/\s*\n\s*/g, ' ')
        switch (fields.blockType) {
          case BLOCK.image: {
            const id = typeof fields.image === 'object' && fields.image ? fields.image.id : fields.image
            const { src, alt } = image(id)
            return `![${alt}](${src}${fields.caption ? ` "${String(fields.caption).replace(/"/g, '”')}"` : ''})`
          }
          case BLOCK.table: {
            const columns = (fields.columns ?? []).map((column: LexicalNode) => cellText(column.label))
            const rows = (fields.rows ?? []).map((row: LexicalNode) => `| ${(row.cells ?? []).map((cell: LexicalNode) => cellText(cell.value)).join(' | ')} |`)
            return [fields.title ? `Table: ${fields.title}` : '', `| ${columns.join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`, ...rows]
              .filter(Boolean)
              .join('\n')
          }
          case BLOCK.callout:
            return [`:::callout ${fields.tone ?? CALLOUT_TONES[0]}`, `title: ${fields.title}`, '', fields.body, ':::'].join('\n')
          case BLOCK.quote:
            return [':::quote', ...(fields.attribution ? [`attribution: ${fields.attribution}`] : []), '', fields.quote, ':::'].join('\n')
          case BLOCK.cta:
            return [
              ':::cta',
              ...(fields.eyebrow ? [`eyebrow: ${fields.eyebrow}`] : []),
              `title: ${fields.title}`,
              ...(fields.buttonLabel ? [`buttonLabel: ${fields.buttonLabel}`] : []),
              '',
              fields.body,
              ':::',
            ].join('\n')
          case BLOCK.video:
            return [
              ':::video',
              `youtube: ${fields.youtubeId}`,
              `title: ${fields.title}`,
              ...(fields.uploadDate ? [`uploadDate: ${String(fields.uploadDate).slice(0, 10)}`] : []),
              ...(fields.durationSeconds ? [`duration: ${fields.durationSeconds}`] : []),
              ...(fields.caption ? ['', fields.caption] : []),
              ':::',
            ].join('\n')
          default:
            problems.push(`${where}: unknown block "${fields.blockType}"`)
            return ''
        }
      }
      default:
        problems.push(`${where}: unsupported node "${node.type}"`)
        return ''
    }
  })
  return { body: parts.filter((part) => part !== '').join('\n\n') + '\n', problems }
}

/**
 * The parts of a Lexical tree that change what the page renders: node types,
 * heading tags, list types, text with its format, link URLs and block fields.
 * Adjacent text runs with the same format are merged, block ids and empty
 * fields dropped, so two trees compare equal when they publish the same page.
 */
export function semanticLexical(content: unknown): unknown {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key, child]) => !['id', 'blockName'].includes(key) && child !== null && child !== undefined && child !== '')
        .map(([key, child]) => [key, key === 'image' && child && typeof child === 'object' ? (child as { id: unknown }).id : clean(child)])
      return Object.fromEntries(entries)
    }
    // Block text fields render in one <p>: whitespace runs, line breaks included, display as one space.
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value
  }
  const visit = (node: LexicalNode): unknown => {
    if (node.type === 'text') return { text: node.text, format: Number(node.format ?? 0) }
    // Formatting on whitespace does not render (an italic space looks like a plain one), and the
    // exporter writes edge spaces outside the ** / * markers. Split them off as plain runs first.
    const runs = (node.children ?? []).flatMap((child: LexicalNode) => {
      const visited = visit(child) as { text?: string; format?: number }
      if (visited.text === undefined || !visited.format) return [visited]
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(visited.text)!
      return [{ text: lead, format: 0 }, { text: core, format: core ? visited.format : 0 }, { text: trail, format: 0 }].filter((run) => run.text !== '')
    })
    const children: unknown[] = []
    for (const child of runs as Array<{ text?: string; format?: number }>) {
      const last = children[children.length - 1] as { text?: string; format?: number } | undefined
      if (child.text !== undefined && last?.text !== undefined && last.format === child.format) last.text += child.text
      else children.push(child)
    }
    // Drafts trim each line, so whitespace at the edges of a block is not content.
    const trimmed = children
      .map((child, index) => {
        const text = (child as { text?: string }).text
        if (text === undefined || node.type === 'link') return child
        let value = text
        if (index === 0) value = value.trimStart()
        if (index === children.length - 1) value = value.trimEnd()
        return { ...(child as object), text: value }
      })
      .filter((child) => (child as { text?: string }).text !== '')
    return {
      type: node.type,
      ...(node.tag ? { tag: node.tag } : {}),
      ...(node.listType ? { listType: node.listType } : {}),
      ...(node.type === 'link' ? { url: node.fields?.url } : {}),
      ...(node.type === 'block' ? { fields: clean(node.fields) } : {}),
      ...(trimmed.length ? { children: trimmed } : {}),
    }
  }
  const root = (content as { root?: LexicalNode } | null)?.root
  return root ? visit(root) : null
}
