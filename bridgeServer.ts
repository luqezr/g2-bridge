export const PLUGIN_PORT = 27124
export const PLUGIN_HOST = '127.0.0.1'
export const CLIENT_HEADER = 'X-Obsidian-On-G2-Client'
export const CLIENT_ID = 'com.luqezr.obsidianong2'
export const PLUGIN_VERSION = '0.1.0'

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Obsidian-On-G2-Client',
}

export interface PluginData {
  token?: string
}

export interface NoteRef {
  path: string
  title: string
  modifiedMs: number
  searchText: string
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/i, '')
}

function shouldSkipPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return (
    normalized.startsWith('.obsidian/') ||
    normalized.startsWith('.git/') ||
    normalized.startsWith('.trash/') ||
    normalized.includes('/.obsidian/') ||
    normalized.includes('/.git/') ||
    normalized.includes('/.trash/')
  )
}

function buildSearchText(title: string, path: string, frontmatter: Record<string, unknown> | null, body: string): string {
  const parts = [title, path]
  const aliases = frontmatter?.aliases
  if (Array.isArray(aliases)) {
    parts.push(...aliases.filter((v): v is string => typeof v === 'string'))
  } else if (typeof aliases === 'string') {
    parts.push(aliases)
  }
  const tags = frontmatter?.tags
  if (Array.isArray(tags)) {
    parts.push(...tags.filter((v): v is string => typeof v === 'string'))
  } else if (typeof tags === 'string') {
    parts.push(tags)
  }
  const excerpt = body.replace(/\s+/g, ' ').trim().slice(0, 2000)
  if (excerpt) parts.push(excerpt)
  return parts.join(' ')
}

function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---\n')) {
    return { data: {}, body: raw }
  }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) {
    return { data: {}, body: raw }
  }
  const yamlBlock = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const data: Record<string, unknown> = {}
  for (const line of yamlBlock.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/)
    if (!match) continue
    const key = match[1]
    let value: unknown = match[2].trim()
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    } else if (typeof value === 'string') {
      value = value.replace(/^['"]|['"]$/g, '')
    }
    data[key] = value
  }
  return { data, body }
}

function normalizeLinkTarget(target: string): string {
  return target.replace(/\.md$/i, '').trim()
}

function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function jsonResponse(status: number, payload: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function textResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { ...CORS_HEADERS } })
}

function unauthorized(): Response {
  return jsonResponse(401, { error: 'Unauthorized' })
}

function badClient(): Response {
  return jsonResponse(403, { error: 'Missing or invalid client header' })
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

export interface BridgeServerContext {
  getToken(): string | null
  setToken(token: string): Promise<void>
  getVaultName(): string
  listNotes(): Promise<NoteRef[]>
  readNote(path: string): Promise<string>
  resolveLink(target: string, fromPath: string): Promise<string | null>
}

export async function handleBridgeRequest(
  request: Request,
  ctx: BridgeServerContext,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse(204)
  }

  if (request.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  if (request.headers.get(CLIENT_HEADER) !== CLIENT_ID) {
    return badClient()
  }

  const url = new URL(request.url)
  const pathname = url.pathname

  if (pathname === '/v1/health') {
    const token = readBearerToken(request)
    if (token && token !== ctx.getToken()) {
      return unauthorized()
    }
    return jsonResponse(200, {
      ok: true,
      vaultName: ctx.getVaultName(),
      pluginVersion: PLUGIN_VERSION,
    })
  }

  if (pathname === '/v1/handshake') {
    let token = ctx.getToken()
    if (!token) {
      token = randomToken()
      await ctx.setToken(token)
    }
    return jsonResponse(200, { token, vaultName: ctx.getVaultName() })
  }

  const bearer = readBearerToken(request)
  if (!bearer || bearer !== ctx.getToken()) {
    return unauthorized()
  }

  if (pathname === '/v1/notes') {
    const notes = await ctx.listNotes()
    return jsonResponse(200, { notes })
  }

  if (pathname.startsWith('/v1/notes/')) {
    const encoded = pathname.slice('/v1/notes/'.length)
    const notePath = decodeURIComponent(encoded)
    try {
      const body = await ctx.readNote(notePath)
      return textResponse(200, body)
    } catch {
      return jsonResponse(404, { error: 'Note not found' })
    }
  }

  if (pathname === '/v1/resolve') {
    const target = url.searchParams.get('target') ?? ''
    const from = url.searchParams.get('from') ?? ''
    const resolved = await ctx.resolveLink(target, from)
    return jsonResponse(200, { path: resolved })
  }

  return jsonResponse(404, { error: 'Not found' })
}

export function createBridgeContext(app: import('obsidian').App, plugin: import('obsidian').Plugin): BridgeServerContext {
  let cachedIndex: NoteRef[] | null = null

  async function buildIndex(): Promise<NoteRef[]> {
    const notes: NoteRef[] = []
    for (const file of app.vault.getMarkdownFiles()) {
      const path = file.path
      if (shouldSkipPath(path)) continue
      const title = titleFromPath(path)
      let searchText = `${title} ${path}`
      try {
        const raw = await app.vault.read(file)
        const parsed = splitFrontmatter(raw)
        const cache = app.metadataCache.getFileCache(file)
        const frontmatter = (cache?.frontmatter as Record<string, unknown> | undefined) ?? parsed.data
        searchText = buildSearchText(title, path, frontmatter ?? null, parsed.body)
      } catch {
        /* keep minimal searchText */
      }
      notes.push({
        path,
        title,
        modifiedMs: file.stat.mtime,
        searchText,
      })
    }
    notes.sort((a, b) => a.path.localeCompare(b.path))
    cachedIndex = notes
    return notes
  }

  return {
    getToken() {
      const data = plugin.loadData() as PluginData | null
      return data?.token ?? null
    },
    async setToken(token: string) {
      const data = ((plugin.loadData() as PluginData | null) ?? {}) as PluginData
      data.token = token
      await plugin.saveData(data)
    },
    getVaultName() {
      return app.vault.getName()
    },
    async listNotes() {
      return buildIndex()
    },
    async readNote(path: string) {
      const file = app.vault.getAbstractFileByPath(path)
      if (!file || !('extension' in file) || file.extension !== 'md') {
        throw new Error('Note not found')
      }
      return app.vault.read(file)
    },
    async resolveLink(target: string, fromPath: string) {
      if (!cachedIndex) await buildIndex()
      const index = cachedIndex ?? []

      const normalized = normalizeLinkTarget(target)
      const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
      const candidates = [
        normalized,
        `${normalized}.md`,
        fromDir ? `${fromDir}/${normalized}` : normalized,
        fromDir ? `${fromDir}/${normalized}.md` : `${normalized}.md`,
      ]

      for (const candidate of candidates) {
        const match = index.find(note => pathsEqual(note.path, candidate))
        if (match) return match.path
      }

      const basename = normalized.split('/').pop() ?? normalized
      const loose = index.find(
        note =>
          note.title.toLowerCase() === basename.toLowerCase() ||
          note.path.toLowerCase().endsWith(`/${basename.toLowerCase()}.md`),
      )
      return loose?.path ?? null
    },
  }
}

export interface BridgeServer {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createBridgeServer(
  app: import('obsidian').App,
  plugin: import('obsidian').Plugin,
): BridgeServer {
  const ctx = createBridgeContext(app, plugin)
  let activeServer: import('http').Server | null = null

  return {
    async start() {
      if (activeServer) return

      const http = require('http') as typeof import('http')
      activeServer = http.createServer(async (req, res) => {
        try {
          const host = req.headers.host ?? `${PLUGIN_HOST}:${PLUGIN_PORT}`
          const url = `http://${host}${req.url ?? '/'}`
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value)
            else if (Array.isArray(value)) headers.set(key, value.join(', '))
          }

          const request = new Request(url, { method: req.method, headers })
          const response = await handleBridgeRequest(request, ctx)

          res.statusCode = response.status
          response.headers.forEach((value, key) => {
            res.setHeader(key, value)
          })
          const body = await response.text()
          res.end(body)
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          for (const [key, value] of Object.entries(CORS_HEADERS)) {
            res.setHeader(key, value)
          }
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }))
        }
      })

      await new Promise<void>((resolve, reject) => {
        activeServer!.listen(PLUGIN_PORT, PLUGIN_HOST, () => resolve())
        activeServer!.on('error', reject)
      })
    },
    async stop() {
      if (!activeServer) return
      const server = activeServer
      activeServer = null
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    },
  }
}
