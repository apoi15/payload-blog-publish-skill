/**
 * A minimal Articles collection that matches `scripts/blog/config.ts`.
 * If your collection already exists, keep it and edit `toLocaleData()` /
 * `fromLocaleData()` / `sharedFieldNames` in the config instead.
 *
 * Requires `localization` in payload.config.ts with the same locale codes.
 */
import type { CollectionConfig } from 'payload'
import { BlocksFeature, FixedToolbarFeature, lexicalEditor } from '@payloadcms/richtext-lexical'
import { validateMetaDescription, validateMetaTitle } from '../../scripts/blog/config'
import { articleContentBlocks } from './article-blocks'
import { revalidateArticleAfterChange, revalidateArticleAfterDelete } from './revalidate-hooks'

export const Articles: CollectionConfig = {
  slug: 'articles',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'publishedAt'] },
  access: { read: () => true },
  hooks: { afterChange: [revalidateArticleAfterChange], afterDelete: [revalidateArticleAfterDelete] },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
    // Localized slugs: unique per locale, checked by the publish script (no DB-level unique).
    { name: 'slug', type: 'text', required: true, index: true, localized: true },
    { name: 'cover', type: 'upload', relationTo: 'media', required: true },
    { name: 'excerpt', type: 'textarea', required: true, localized: true },
    { name: 'publishedAt', type: 'date', required: true, admin: { position: 'sidebar' } },
    {
      name: 'category',
      type: 'select',
      required: true,
      admin: { position: 'sidebar' },
      options: ['guides', 'how-to', 'comparisons', 'news'],
    },
    { name: 'keyTakeaways', type: 'textarea', localized: true, admin: { description: 'One takeaway per line.' } },
    {
      name: 'content',
      type: 'richText',
      localized: true,
      editor: lexicalEditor({
        features: ({ defaultFeatures }) => [...defaultFeatures, FixedToolbarFeature(), BlocksFeature({ blocks: articleContentBlocks })],
      }),
    },
    {
      name: 'seo',
      type: 'group',
      fields: [
        // Same validators as the publish script, so the admin and the CLI reject the same values.
        { name: 'metaTitle', type: 'text', localized: true, validate: (value: unknown) => validateMetaTitle(String(value ?? '')) },
        { name: 'metaDescription', type: 'textarea', localized: true, validate: (value: unknown) => validateMetaDescription(String(value ?? '')) },
      ],
    },
  ],
}
