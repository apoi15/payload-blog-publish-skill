/**
 * Pexels images for one article draft folder (output/blog-drafts/<slug>).
 *
 * Pexels photos are free to use; crediting the photographer is requested, and
 * this script always prints the credit line for you.
 *
 *   pnpm blog:pexels <folder> search <key> "<query>"   # contact sheet + candidates in <folder>/pexels/
 *   pnpm blog:pexels <folder> pick <key> <number>       # download candidate <number> to assets/<slug>-<key>.webp
 *
 * Look at <folder>/pexels/<key>-sheet.webp before picking. `pick` prints the
 * Markdown image line and the photographer credit to paste above the section's
 * H2, and appends the source to <folder>/pexels/sources.md.
 *
 * The key is read from PEXELS_API_KEY and never printed. Downloads are
 * restricted to images.pexels.com and 15 MB.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const [folderArg, mode, key, value] = process.argv.slice(2)
const usage = 'Usage: pnpm blog:pexels <folder> search <key> "<query>" | pnpm blog:pexels <folder> pick <key> <number>'
if (!folderArg || !['search', 'pick'].includes(mode) || !key || !value) throw new Error(usage)
if (!/^[a-z0-9-]+$/.test(key)) throw new Error('The key names the section and the file: lowercase letters, digits and hyphens only')

const folder = path.resolve(folderArg)
const slug = path.basename(folder)
const pexelsDir = path.join(folder, 'pexels')
const candidatesFile = path.join(pexelsDir, `${key}-candidates.json`)

async function getBuffer(url) {
  const parsed = new URL(url)
  if (parsed.hostname !== 'images.pexels.com') throw new Error(`Unexpected image host: ${parsed.hostname}`)
  const response = await fetch(parsed)
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`)
  const type = response.headers.get('content-type') || ''
  if (!type.startsWith('image/')) throw new Error(`Unexpected content type: ${type}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 15 * 1024 * 1024) throw new Error('Image exceeds 15 MB')
  return buffer
}

const escapeXml = (text) => text.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char])

async function search(query) {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) throw new Error('PEXELS_API_KEY is not configured')
  const url = new URL('https://api.pexels.com/v1/search')
  url.searchParams.set('query', query)
  url.searchParams.set('orientation', 'landscape')
  url.searchParams.set('size', 'large')
  url.searchParams.set('per_page', '6')
  const response = await fetch(url, { headers: { Authorization: apiKey } })
  if (!response.ok) throw new Error(`Pexels search failed (HTTP ${response.status})`)
  const photos = (await response.json()).photos ?? []
  if (!photos.length) throw new Error(`No Pexels results for "${query}"`)

  await fs.mkdir(pexelsDir, { recursive: true })
  const tiles = []
  for (const [index, photo] of photos.entries()) {
    const image = await sharp(await getBuffer(photo.src.medium)).resize(480, 270, { fit: 'cover', position: 'attention' }).toBuffer()
    const label = Buffer.from(
      `<svg width="480" height="42"><rect width="480" height="42" fill="#111827"/><text x="14" y="27" fill="white" font-size="17" font-family="Arial">${escapeXml(`${index + 1} · ${photo.photographer}`)}</text></svg>`,
    )
    tiles.push({
      input: await sharp({ create: { width: 480, height: 312, channels: 3, background: '#111827' } })
        .composite([{ input: image, top: 0, left: 0 }, { input: label, top: 270, left: 0 }])
        .png()
        .toBuffer(),
      left: (index % 3) * 480,
      top: Math.floor(index / 3) * 312,
    })
  }
  const sheet = path.join(pexelsDir, `${key}-sheet.webp`)
  await sharp({ create: { width: 1440, height: Math.ceil(photos.length / 3) * 312, channels: 3, background: '#f3f4f6' } })
    .composite(tiles)
    .webp({ quality: 82 })
    .toFile(sheet)
  const candidates = photos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    alt: photo.alt,
    src: photo.src.large2x || photo.src.large,
  }))
  await fs.writeFile(candidatesFile, `${JSON.stringify({ query, candidates }, null, 2)}\n`)
  console.log(JSON.stringify({ query, sheet, candidates: candidates.map((c, i) => `${i + 1}: ${c.alt || '(no alt)'} — ${c.photographer}`) }, null, 2))
}

async function pick(number) {
  const { query, candidates } = JSON.parse(await fs.readFile(candidatesFile, 'utf8'))
  const photo = candidates[Number(number) - 1]
  if (!photo) throw new Error(`Candidate ${number} does not exist (1–${candidates.length})`)
  const assets = path.join(folder, 'assets')
  await fs.mkdir(assets, { recursive: true })
  const file = path.join(assets, `${slug}-${key}.webp`)
  await sharp(await getBuffer(photo.src))
    .rotate()
    .resize(1200, 675, { fit: 'cover', position: 'attention' })
    .webp({ quality: 76, effort: 5 })
    .toFile(file)
  const { size } = await fs.stat(file)
  const credit = `*Photo by [${photo.photographer}](${photo.photographerUrl}) on [Pexels](${photo.url}).*`
  await fs.appendFile(
    path.join(pexelsDir, 'sources.md'),
    [`## ${key}`, '', `- Query: ${query}`, `- Photo: [${photo.id}](${photo.url})`, `- Photographer: [${photo.photographer}](${photo.photographerUrl})`, `- File: assets/${path.basename(file)} (${Math.round(size / 1024)} KB)`, '', ''].join('\n'),
  )
  console.log(JSON.stringify({ file, kb: Math.round(size / 1024), markdown: [`![DESCRIBE WHAT THE PHOTO SHOWS](./assets/${path.basename(file)})`, '', credit] }, null, 2))
}

if (mode === 'search') await search(value)
else await pick(value)
