---
name: payload-blog-publish
description: Research, write, publish or update multilingual blog articles on a Next.js + Payload CMS 3 site. Use when the user asks to create, draft, rewrite, update, translate, republish or fix a blog article; covers the site's editorial files, Google top-three and People Also Ask research, Pexels images with credits, one Markdown draft per locale, `pnpm blog:publish` (dry run, development database, then production behind ALLOW_PRODUCTION_DB), cache revalidation, live QA and Search Console follow-up.
---

# Blog research, writing and publishing (Next.js + Payload)

Fixed pipeline:

```text
editorial files → Google top 3 + People Also Ask → Pexels images → one Markdown draft per locale
→ pnpm blog:publish (dry run → development --apply → production --apply) → /api/revalidate
→ live QA → Search Console / lead review after ~28 days
```

Payload is the only source of truth for article content. The draft format and
write rules are defined by `scripts/blog/markdown.ts` and
`scripts/blog/publish.ts` in the project; never guess the structure from how a
page looks. Project specifics (locales, collection, block slugs, SEO limits,
public origin, production hosts) live in `scripts/blog/config.ts`.

## Always

- Read the project's `AGENTS.md` / `CLAUDE.md`, then every file listed in
  `references/README.md` of this skill before a new article or a substantial
  rewrite.
- One article = one Payload document with every configured locale. Write all
  locale drafts together; hreflang depends on the shared document id. Numbers
  are identical in every language; each non-default locale is written for its
  own readers, not translated word for word.
- Write articles only with `pnpm blog:publish`, and read existing ones only
  with `pnpm blog:export`. No ad-hoc scripts, REST calls, admin form filling or
  direct SQL unless the user explicitly asks.
- Order is fixed: dry run → development `--apply` → local QA → production dry
  run → production `--apply`. **Writing production requires the user's explicit
  request in the current task.** Otherwise stop after development QA and report
  the exact command.
- Competitor pages set intent, format, coverage and length only. Never copy
  their sentences, tables, images or near-identical outline.
- Stock photos illustrate context only; never present them as the company's
  own premises, staff, products or customers. The cover should be the
  company's own photo when one exists.
- Anything marked `Needs verification` or `Needs input` in the references
  stays out of published copy. The red lines in `references/voice.md` override
  every SERP finding.
- Keep every file for one article in `output/blog-drafts/<default-locale slug>/`
  (git-ignored):

  ```text
  output/blog-drafts/<slug>/
  ├── en.md  es.md  fr.md      one per configured locale; blog:publish reads these
  ├── research.md              SERP / PAA brief and the later performance review
  ├── assets/                  cover and body images, filenames start with <slug>-
  └── pexels/                  contact sheets, candidates, sources.md (blog:pexels)
  ```

- Report content publishing and code deployment separately: a CMS write is not
  a git commit or a deploy.

## 1. Classify the task

Record one class and why:

- `new-or-substantial-rewrite`: a new article, or a rewrite that changes the
  search intent, structure, conclusion or scope. Run steps 2–10.
- `typo-only` / `metadata-only` / `image-only` / `translation-only` /
  `publish-only`: change only what the user named. Skip SERP, PAA, word-count
  and image research; mark them `N/A` with the reason in the report.

Editing an existing article always starts from an export. Development may lag
behind production, so export the production version when editing a live
article (read-only):

```bash
ALLOW_PRODUCTION_DB=true pnpm blog:export <slug>     # → output/blog-drafts/<slug>/
```

Add `--force` to export into an existing folder: only the locale drafts and
`assets/` images are written; other files stay. The export converts each
locale back to Lexical and compares it with the stored tree. `"ok": false`
means the article cannot round-trip losslessly: **do not republish the body
from that draft**; edit in the admin or report to the user. The cover is not
exported; leaving `cover` out of the default-locale draft keeps it. To change
one locale only, publish with `--locales=es`.

## 2. Check existing intent (avoid cannibalization)

Read `references/used-keywords.md` and refresh the article list from the live
sitemap. If the primary keyword's intent already belongs to a URL, update that
page instead of writing a new one. Confirm with real Search Console queries
when you have access.

## 3. Research (new or substantial rewrite only)

Copy [the research template](assets/serp-research-brief-template.md) to
`output/blog-drafts/<slug>/research.md`.

- Search Google live for the primary keyword (record date, language, market
  and query). Read the top three organic results that answer the same intent;
  ads, product cards, PAA boxes and forums do not count. If one will not load,
  take the next and record why.
- Record each page's format, main-body word count (no nav, footer or
  comments), H2/H3s, topics all three share and what each misses.
- Target length: 80–120% of the three-page average. Justify any deviation; do
  not pad.
- Use only People Also Ask questions that actually appear on that result page
  (usually 4–8). If there are none, drop the FAQ and record it. Never invent
  questions.
- Non-default locales need their own SERP check only when that language has a
  distinct local intent.
- The brief must settle: one primary keyword, one reader decision, the shared
  topics, 1–2 gaps the site can fill with verified evidence, one first-hand
  fact or story from `references/facts.md` / `stories.md`, one commercial
  page with descriptive anchor text, format and word target, the PAA FAQ, and
  how success will be measured.

## 4. Images (Pexels)

```bash
pnpm blog:pexels output/blog-drafts/<slug> search <section-key> "<query>"   # writes pexels/<key>-sheet.webp
pnpm blog:pexels output/blog-drafts/<slug> pick <section-key> <number>      # downloads assets/<slug>-<key>.webp
```

- Look at the contact sheet (read the image) before picking. Write queries
  about what the section explains, not the primary keyword again. Avoid
  visible third-party logos.
- `pick` prints the Markdown image line and the credit line and appends the
  source to `pexels/sources.md`; copy the source into the brief too.
- Put the image directly above the related H2, the credit on the next line,
  then the H2. Not every section needs an image.
- Alt text describes what the photo shows, written per locale. The quoted
  caption is optional.

## 5. Write the drafts

Copy [the draft template](assets/draft-template.md) to `<default>.md`, finish
it, then write the other locales.

- Front matter in every locale: `title`, `slug`, `excerpt`, `takeaways` (2–4),
  `metaTitle` and `metaDescription` (limits from `config.ts`; aim for 120–155
  description characters), `coverAlt` when a cover is set. `category`,
  `publishedAt` and `cover` go in the default-locale file only.
- Slugs: the default locale uses the keyword phrase; other locales use a
  native phrase. Lowercase ASCII with hyphens.
- Open with 40–70 words that answer the query. `##` for sections, `###` only
  inside a section or the FAQ.
- Internal links use the real final URL of the same locale (`/es/...` for
  Spanish, no prefix for the default locale). The publish script rejects 404s,
  redirects and cross-locale links.
- Tables, callouts, CTA, pull quote, video and FAQ follow the template. Anything
  else (H1, H4, code fences, HTML, inline images, bare URLs, `•`, nested lists)
  is rejected.
- FAQ: one `##` followed by `###` questions ending in `?`, each answered by a
  paragraph. The page can emit FAQPage JSON-LD from this shape.

## 6. Dry run and development QA

```bash
pnpm blog:publish output/blog-drafts/<slug>              # dry run: validation, link check, create/update plan
pnpm blog:publish output/blog-drafts/<slug> --apply      # writes the development database
```

- The dry run must print `"ok": true`. Read `summary` per locale: words in the
  target range, `faqs` equal to the PAA count, `h2`/`tables`/`images`, link
  counts, meta lengths, and `action` (an update must say `update article #<id>`;
  if it says `create`, stop and check the slug).
- `--apply` must report `"readBack": "all locales match"`. Record the article
  id and the media `uploaded` / `reused` lines.
- Local QA: open every locale on the dev server. Read the DOM of below-the-fold
  content with headless Chrome **without scrolling** (crawlers and answer
  engines index the DOM before any IntersectionObserver fires). Check H1,
  H2/H3, lists, tables, callouts, CTA, FAQ, image alt, credit links and
  internal hrefs; no Markdown source may leak. For a new cover, check desktop
  (1440×1000) and mobile (390×844) screenshots and the blog card crop.

## 7. Production (only when the user asked for it)

```bash
ALLOW_PRODUCTION_DB=true pnpm blog:publish output/blog-drafts/<slug>            # production dry run
ALLOW_PRODUCTION_DB=true pnpm blog:publish output/blog-drafts/<slug> --apply
```

- stderr must start with `[db] PRODUCTION` and the JSON `database` field must
  say PRODUCTION.
- The script then calls `POST /api/revalidate` with `REVALIDATE_SECRET`. If
  `revalidation` is not `ok`, the article is already written: do not publish
  again; retry the purge or save the article once in the admin.
- After a successful production write, add the article (primary intent plus
  every locale slug) to `references/used-keywords.md` and update the refresh
  date. Do not update it after a development-only write.

## 8. Live QA

For every locale URL: HTTP 200; correct `<title>` and meta description;
canonical and hreflang pointing at each other; the same no-scroll DOM check as
step 6; the article on the blog index; the URL in `sitemap.xml`; images load
from the media origin.

## 9. Measure (new or substantial rewrite only)

At the end of the brief, record the canonical URL, publish date, primary
keyword and first review date (about 28 days later; longer for a new site).
At review: Search Console impressions, clicks, CTR and position for the page
and for the queries actually bringing impressions; leads or conversions
attributed to the page. Conclude: keep, expand, retitle, relink or merge.
"Published" or "checks passed" is not evidence that an article works.

## 10. Report (short)

- task class; skipped steps marked `N/A` with the reason;
- brief path, search date, top-three URLs, average words and target range,
  PAA count;
- draft paths, primary keyword, reader decision, first-hand evidence,
  commercial page;
- image count and source file, cover source;
- development / production `created` or `updated`, article id, `readBack`,
  `revalidation`;
- live QA result and screenshot paths;
- which `references/` files changed; git status (drafts are not committed).

## When something goes wrong

- Dry-run errors: fix the draft line by line; never skip validation. A 308 on
  a link means: link the final URL.
- The default-locale slug matches several articles: stop and resolve the
  duplicate first.
- An update shows `create`: stop and confirm the slug (never change the slug
  in an exported draft).
- `readBack` mismatch: do not write again; export, diff and report.
- Production written but the purge failed: fix only the purge.
- Google results or PAA cannot be read reliably: record the blocker; never
  invent ranking pages, word counts or questions.
- `PEXELS_API_KEY` missing or rate-limited: keep the image plan and report it;
  do not scrape other sites and label the result as Pexels.
- Production needed but not authorized in this task: stop at development and
  print the command.
