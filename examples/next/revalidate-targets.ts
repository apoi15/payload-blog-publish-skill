/**
 * What to purge when an article changes: the blog index, every article page
 * (related-article lists change too) and the sitemap.
 *
 * Gotcha: these are route FILE paths, not URLs. Next.js tags a rendered page
 * with its route pattern including route groups and dynamic segments, e.g.
 * `/(frontend)/[lang]/blog/[slug]`. `revalidatePath('/blog')` does nothing
 * for a page that lives under `app/(frontend)/[lang]/blog/`. Copy the folder
 * names from your `app/` directory exactly.
 */
export type RevalidateTarget = [path: string, type?: 'page' | 'layout']

export const ARTICLE_TARGETS: RevalidateTarget[] = [
  // `layout` purges the blog index and everything below it, in every locale.
  ['/(frontend)/[lang]/blog', 'layout'],
  ['/sitemap.xml'],
]
