/**
 * The six Lexical blocks the Markdown subset maps onto. Slugs and field names
 * must match `blogConfig.blocks` and `toLexical()` in scripts/blog/markdown.ts.
 * Rename freely, but rename in both places.
 */
import type { Block } from 'payload'

export const ArticleImageBlock: Block = {
  slug: 'articleImage',
  interfaceName: 'ArticleImageBlock',
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true },
    { name: 'caption', type: 'text' },
  ],
}

export const ArticleTableBlock: Block = {
  slug: 'articleTable',
  interfaceName: 'ArticleTableBlock',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'columns', type: 'array', minRows: 2, required: true, fields: [{ name: 'label', type: 'text', required: true }] },
    {
      name: 'rows',
      type: 'array',
      minRows: 1,
      required: true,
      fields: [{ name: 'cells', type: 'array', minRows: 1, required: true, fields: [{ name: 'value', type: 'text', required: true }] }],
    },
  ],
}

export const ArticleCalloutBlock: Block = {
  slug: 'articleCallout',
  interfaceName: 'ArticleCalloutBlock',
  fields: [
    {
      name: 'tone',
      type: 'select',
      defaultValue: 'note',
      options: [
        { label: 'Note', value: 'note' },
        { label: 'Key takeaway', value: 'takeaway' },
        { label: 'Warning', value: 'warning' },
      ],
    },
    { name: 'title', type: 'text', required: true },
    { name: 'body', type: 'textarea', required: true },
  ],
}

export const ArticleQuoteBlock: Block = {
  slug: 'articleQuote',
  interfaceName: 'ArticleQuoteBlock',
  fields: [
    { name: 'quote', type: 'textarea', required: true },
    { name: 'attribution', type: 'text' },
  ],
}

export const ArticleCtaBlock: Block = {
  slug: 'articleCta',
  interfaceName: 'ArticleCtaBlock',
  fields: [
    { name: 'eyebrow', type: 'text' },
    { name: 'title', type: 'text', required: true },
    { name: 'body', type: 'textarea', required: true },
    { name: 'buttonLabel', type: 'text' },
  ],
}

export const ArticleVideoBlock: Block = {
  slug: 'articleVideo',
  interfaceName: 'ArticleVideoBlock',
  fields: [
    { name: 'youtubeId', type: 'text', required: true },
    { name: 'title', type: 'text', required: true },
    { name: 'caption', type: 'text' },
    // Google lists a video in search only when it knows the upload date; render both in VideoObject JSON-LD.
    { name: 'uploadDate', type: 'date' },
    { name: 'durationSeconds', type: 'number', min: 1 },
  ],
}

export const articleContentBlocks = [
  ArticleImageBlock,
  ArticleTableBlock,
  ArticleCalloutBlock,
  ArticleQuoteBlock,
  ArticleCtaBlock,
  ArticleVideoBlock,
]
