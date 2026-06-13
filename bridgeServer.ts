export const DEFAULT_PLUGIN_PORT = 27124
/** @deprecated Use DEFAULT_PLUGIN_PORT */
export const PLUGIN_PORT = DEFAULT_PLUGIN_PORT
export const PLUGIN_HOST = '127.0.0.1'
export const CLIENT_HEADER = 'X-Obsidian-On-G2-Client'
export const CLIENT_ID = 'com.luqezr.obsidianong2'
export const PASSWORD_HEADER = 'X-Obsidian-On-G2-Password'
export const PLUGIN_VERSION = '0.1.0'

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-Obsidian-On-G2-Client, X-Obsidian-On-G2-Password',
}

export interface PluginData {
  token?: string
  port?: number
  password?: string
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

function readPassword(request: Request): string {
  return request.headers.get(PASSWORD_HEADER)?.trim() ?? ''
}

function secureEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

function passwordNotConfigured(): Response {
  return jsonResponse(503, {
    error: 'Bridge password not configured. Set a password in Obsidian plugin settings.',
  })
}

export interface BridgeServerContext {
  getToken(): string | null
  setToken(token: string): Promise<void>
  clearToken(): void
  isPasswordConfigured(): boolean
  verifyPassword(password: string): boolean
  getVaultName(): string
  listNotes(): Promise<NoteRef[]>
  readNote(path: string): Promise<string>
  resolveLink(target: string, fromPath: string): Promise<string | null>
}

interface TokenStore {
  get(): string | null
  set(token: string): Promise<void>
  clear(): void
}

function createTokenStore(
  plugin: import('obsidian').Plugin,
  getPassword: () => string,
): TokenStore {
  let sessionToken: string | null = (plugin.loadData() as PluginData | null)?.token ?? null

  return {
    get() {
      return sessionToken
    },
    async set(token: string) {
      sessionToken = token
      const data = ((plugin.loadData() as PluginData | null) ?? {}) as PluginData
      data.token = token
      data.password = getPassword()
      await plugin.saveData(data)
    },
    clear() {
      sessionToken = null
    },
  }
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
    if (!ctx.isPasswordConfigured()) {
      return passwordNotConfigured()
    }

    const bearer = readBearerToken(request)
    const password = readPassword(request)

    if (bearer) {
      if (bearer !== ctx.getToken()) {
        return unauthorized()
      }
      return jsonResponse(200, {
        ok: true,
        vaultName: ctx.getVaultName(),
        pluginVersion: PLUGIN_VERSION,
      })
    }

    if (password && ctx.verifyPassword(password)) {
      return jsonResponse(200, {
        ok: true,
        vaultName: ctx.getVaultName(),
        pluginVersion: PLUGIN_VERSION,
      })
    }

    return unauthorized()
  }

  if (pathname === '/v1/handshake') {
    if (!ctx.isPasswordConfigured()) {
      return passwordNotConfigured()
    }

    const password = readPassword(request)
    if (!ctx.verifyPassword(password)) {
      return unauthorized()
    }

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

export function createBridgeContext(
  app: import('obsidian').App,
  plugin: import('obsidian').Plugin,
  getPassword: () => string,
  tokenStore: TokenStore,
): BridgeServerContext {
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
      return tokenStore.get()
    },
    async setToken(token: string) {
      await tokenStore.set(token)
    },
    clearToken() {
      tokenStore.clear()
    },
    isPasswordConfigured() {
      return Boolean(getPassword().length)
    },
    verifyPassword(password: string) {
      const expected = getPassword()
      if (!expected) return false
      return secureEqual(password, expected)
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

export interface BridgeServerStatus {
  running: boolean
  port: number
  host: string
  lastClientAt: number | null
  clientRequestCount: number
  error: string | null
}

export function formatClientStatus(status: BridgeServerStatus): string {
  if (!status.lastClientAt) {
    return 'No G2 app connected yet. Open the Obsidian on G2 app and tap Test connection or Connect.'
  }

  const agoSec = Math.floor((Date.now() - status.lastClientAt) / 1000)
  const requests = `${status.clientRequestCount} request${status.clientRequestCount === 1 ? '' : 's'} total`

  if (agoSec < 60) {
    return `G2 app active ${agoSec === 0 ? 'just now' : `${agoSec}s ago`} (${requests})`
  }
  if (agoSec < 3600) {
    return `Last G2 app request ${Math.floor(agoSec / 60)}m ago (${requests})`
  }
  return `Last G2 app request ${Math.floor(agoSec / 3600)}h ago (${requests})`
}

export function isClientRecentlyActive(status: BridgeServerStatus, withinMs = 5 * 60 * 1000): boolean {
  return status.lastClientAt !== null && Date.now() - status.lastClientAt < withinMs
}

export interface BridgeServerOptions {
  port?: number
  onClientActivity?: () => void
  getPassword?: () => string
}

export interface BridgeServer {
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): BridgeServerStatus
  clearSessionToken(): void
}

export function createBridgeServer(
  app: import('obsidian').App,
  plugin: import('obsidian').Plugin,
  options: BridgeServerOptions = {},
): BridgeServer {
  const getPassword = options.getPassword ?? (() => '')
  const tokenStore = createTokenStore(plugin, getPassword)
  const ctx = createBridgeContext(app, plugin, getPassword, tokenStore)
  const port = options.port ?? DEFAULT_PLUGIN_PORT
  const host = PLUGIN_HOST
  let activeServer: import('http').Server | null = null

  const status: BridgeServerStatus = {
    running: false,
    port,
    host,
    lastClientAt: null,
    clientRequestCount: 0,
    error: null,
  }

  function recordClientActivity(): void {
    status.lastClientAt = Date.now()
    status.clientRequestCount++
    options.onClientActivity?.()
  }

  return {
    getStatus() {
      return { ...status }
    },
    clearSessionToken() {
      tokenStore.clear()
    },
    async start() {
      if (activeServer) return

      status.port = port
      status.error = null
      status.running = false

      try {
        const http = require('http') as typeof import('http') | undefined
        if (!http?.createServer) {
          throw new Error('Node.js HTTP is not available on this device (http.createServer missing).')
        }
        activeServer = http.createServer(async (req, res) => {
          try {
            const clientHeader = req.headers[CLIENT_HEADER.toLowerCase()]
            if (clientHeader === CLIENT_ID) {
              recordClientActivity()
            }

            const hostHeader = req.headers.host ?? `${host}:${port}`
            const url = `http://${hostHeader}${req.url ?? '/'}`
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
          activeServer!.listen(port, host, () => resolve())
          activeServer!.on('error', reject)
        })
        status.running = true
      } catch (error) {
        status.running = false
        status.error = error instanceof Error ? error.message : String(error)
        activeServer = null
        throw error
      }
    },
    async stop() {
      if (!activeServer) return
      const server = activeServer
      activeServer = null
      status.running = false
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    },
  }
}
