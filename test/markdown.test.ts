import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { checkLinkLocale, faqQuestions, fromLexical, parseBody, parseDraft, semanticLexical, summarize, toLexical } from '../scripts/blog/markdown'

const template = fs.readFileSync(path.join(import.meta.dirname, '../skill/payload-blog-publish/assets/draft-template.md'), 'utf8')

const mediaIdsFor = (nodes: ReturnType<typeof parseBody>['nodes']) =>
  Object.fromEntries(nodes.flatMap((node, index) => (node.type === 'image' ? [[node.src, index + 1]] : [])))

describe('draft template', () => {
  const draft = parseDraft(template, 'en')

  it('parses without errors', () => {
    expect(draft.errors).toEqual([])
    expect(draft.shared.category).toBe('how-to')
    expect(draft.meta.takeaways).toHaveLength(2)
  })

  it('counts the structure the dry run reports', () => {
    const summary = summarize(draft.nodes)
    expect(summary).toMatchObject({ h2: 3, h3: 3, tables: 1, images: 1, callouts: 1, pullQuotes: 1, ctas: 1, videos: 1, faqs: 2, internalLinks: 1 })
    expect(faqQuestions(draft.nodes)).toEqual(['A real People Also Ask question, ending with a question mark?', 'Another observed question?'])
  })

  it('round-trips Markdown → Lexical → Markdown → Lexical without changing the page', () => {
    const mediaIds = mediaIdsFor(draft.nodes)
    const lexical = toLexical(draft.nodes, mediaIds)
    const srcById = new Map(draft.nodes.flatMap((node, index) => (node.type === 'image' ? [[index + 1, node]] : [])))
    const { body, problems } = fromLexical(lexical, (id) => {
      const image = srcById.get(Number(id))!
      return { src: image.src, alt: image.alt }
    })
    expect(problems).toEqual([])
    const again = parseBody(body)
    expect(again.errors).toEqual([])
    expect(semanticLexical(toLexical(again.nodes, mediaIds))).toEqual(semanticLexical(lexical))
  })
})

describe('strict subset', () => {
  const errorsOf = (body: string) => parseBody(body).errors

  it.each([
    ['# Title', /no H1/],
    ['#### Deep', /only ## and ###/],
    ['```js\ncode\n```', /code blocks/],
    ['Some <b>html</b>', /HTML/],
    ['See https://example.com now', /bare URL/],
    ['Text with ![img](./assets/x.webp) inline', /own line/],
    ['• fake bullet', /real Markdown list/],
    ['- item\n  - nested', /nested lists/],
    [':::callout loud\ntitle: x\n\nbody\n:::', /tone/],
    [':::gallery\n:::', /unknown block/],
    ['| a |\n|---|\n| 1 |', /two columns/],
  ])('rejects %j', (body, message) => {
    expect(errorsOf(body).join('\n')).toMatch(message)
  })
})

describe('locale links', () => {
  it('keeps internal links inside the page locale', () => {
    expect(checkLinkLocale('/services', 'en')).toBeNull()
    expect(checkLinkLocale('/es/servicios', 'en')).toMatch(/points at the es site/)
    expect(checkLinkLocale('/servicios', 'es')).toMatch(/must start with \/es\//)
    expect(checkLinkLocale('/es/servicios', 'es')).toBeNull()
    expect(checkLinkLocale('https://example.org', 'fr')).toBeNull()
  })
})

describe('front matter', () => {
  it('keeps shared fields in the default locale', () => {
    const draft = parseDraft('---\ntitle: T\nslug: t\nexcerpt: E\ncategory: how-to\n---\n\n## A\n\nText\n', 'es')
    expect(draft.errors.join('\n')).toMatch(/set it in en\.md only/)
  })

  it('rejects a non-ASCII slug', () => {
    const draft = parseDraft('---\ntitle: T\nslug: café-guide\nexcerpt: E\n---\n\n## A\n\nText\n', 'fr')
    expect(draft.errors.join('\n')).toMatch(/lowercase ASCII/)
  })
})
