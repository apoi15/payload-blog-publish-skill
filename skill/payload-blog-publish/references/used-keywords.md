# Search intent already owned by a URL

Before writing, check the primary keyword against this map. If an existing URL
already answers the same intent, update that page instead of writing a new
one. The map drifts; refresh the article list from the live sitemap:

```bash
curl -s https://www.example.com/sitemap.xml | grep -o '<loc>[^<]*/blog/[^<]*</loc>'
```

and confirm real queries in Search Console.

## Money pages (never write an article that competes with these)

| Intent | URL |
| --- | --- |
| <!-- head term --> | `/` |
| <!-- product or service --> | `/<slug>` |

Non-default locales may use localized slugs. Link the URL the live page
actually uses; `pnpm blog:publish` fails on redirects and 404s.

## Articles (default-locale slug, then the other locales)

| Primary intent | en | es | fr |
| --- | --- | --- | --- |
| | | | |

Last refreshed from the sitemap on YYYY-MM-DD.
