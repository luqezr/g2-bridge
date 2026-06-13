import { Plugin } from 'obsidian'
import {
  createBridgeServer,
  DEFAULT_PLUGIN_PORT,
  formatClientStatus,
  isClientRecentlyActive,
  type BridgeServerStatus,
} from './bridgeServer'
import { formatHttpStartError, getBridgeUnsupportedMessage, isBridgeSupportedPlatform } from './platformSupport'
import { BridgeSettingTab, DEFAULT_SETTINGS, type BridgeSettings } from './settingsTab'

export default class ObsidianOnG2BridgePlugin extends Plugin {
  settings: BridgeSettings = { ...DEFAULT_SETTINGS }
  private server: ReturnType<typeof createBridgeServer> | null = null
  private statusBarItem: HTMLElement | null = null
  private statusInterval: number | null = null
  private lastStartError: string | null = null

  async onload(): Promise<void> {
    await this.loadSettings()
    this.addSettingTab(new BridgeSettingTab(this.app, this))
    this.statusBarItem = this.addStatusBarItem()
    this.statusBarItem.addClass('mod-clickable')
    this.statusBarItem.onClickEvent(() => {
      this.app.setting.open()
    })

    try {
      const unsupported = getBridgeUnsupportedMessage()
      if (unsupported) {
        this.lastStartError = unsupported
      } else {
        await this.startServer()
        this.lastStartError = null
      }
    } catch (error) {
      this.lastStartError = formatHttpStartError(error)
      console.error('[evenrealities-glasses-bridge] failed to start localhost server:', error)
    }

    this.updateStatusBar()
    this.statusInterval = window.setInterval(() => this.updateStatusBar(), 10000)
  }

  async onunload(): Promise<void> {
    if (this.statusInterval !== null) {
      window.clearInterval(this.statusInterval)
      this.statusInterval = null
    }
    await this.stopServer()
    this.statusBarItem = null
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<BridgeSettings & { token?: string }> | null
    const port = data?.port ?? DEFAULT_PLUGIN_PORT
    this.settings = {
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PLUGIN_PORT,
      password: typeof data?.password === 'string' ? data.password : '',
    }
  }

  async saveSettings(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) ?? {}
    const previousPassword = typeof data.password === 'string' ? data.password : ''
    const passwordChanged = previousPassword !== this.settings.password
    const next = {
      ...data,
      port: this.settings.port,
      password: this.settings.password,
    }
    if (passwordChanged) {
      delete next.token
      this.server?.clearSessionToken()
    }
    await this.saveData(next)
  }

  getServerStatus(): BridgeServerStatus {
    if (!this.server) {
      return {
        running: false,
        port: this.settings.port,
        host: '127.0.0.1',
        lastClientAt: null,
        clientRequestCount: 0,
        error: this.lastStartError,
      }
    }

    const status = this.server.getStatus()
    if (!status.running && !status.error && this.lastStartError) {
      return { ...status, error: this.lastStartError }
    }
    return status
  }

  async ensureServerRunning(): Promise<boolean> {
    if (!isBridgeSupportedPlatform()) {
      this.lastStartError = getBridgeUnsupportedMessage()
      this.updateStatusBar()
      return false
    }

    if (this.getServerStatus().running) {
      return true
    }

    try {
      await this.stopServer()
      await this.startServer()
      this.lastStartError = null
      return true
    } catch (error) {
      this.lastStartError = formatHttpStartError(error)
      console.error('[evenrealities-glasses-bridge] failed to start localhost server:', error)
      this.updateStatusBar()
      return false
    }
  }

  async startServer(): Promise<void> {
    const unsupported = getBridgeUnsupportedMessage()
    if (unsupported) {
      throw new Error(unsupported)
    }

    await this.stopServer()
    this.server = createBridgeServer(this.app, this, {
      port: this.settings.port,
      getPassword: () => this.settings.password,
      onClientActivity: () => this.updateStatusBar(),
    })
    await this.server.start()
    this.lastStartError = null
    console.log(
      `[evenrealities-glasses-bridge] listening on http://127.0.0.1:${this.settings.port}`,
    )
    this.updateStatusBar()
  }

  async stopServer(): Promise<void> {
    await this.server?.stop()
    this.server = null
  }

  async restartServer(): Promise<void> {
    try {
      await this.startServer()
    } catch (error) {
      this.lastStartError = formatHttpStartError(error)
      console.error('[evenrealities-glasses-bridge] failed to restart localhost server:', error)
      this.updateStatusBar()
      throw error
    }
  }

  updateStatusBar(): void {
    if (!this.statusBarItem) return

    const status = this.getServerStatus()
    if (!status.running) {
      if (!isBridgeSupportedPlatform()) {
        this.statusBarItem.setText('G2 Bridge: not supported on iOS')
        return
      }
      const suffix = status.error ? `: ${status.error}` : ''
      this.statusBarItem.setText(`G2 Bridge: stopped${suffix}`)
      return
    }

    if (!this.settings.password) {
      this.statusBarItem.setText(`G2 Bridge: :${status.port} · set password`)
      return
    }

    const clientLabel = isClientRecentlyActive(status) ? 'client connected' : 'waiting for client'
    this.statusBarItem.setText(`G2 Bridge: :${status.port} · ${clientLabel}`)
    this.statusBarItem.setAttr('aria-label', formatClientStatus(status))
  }
}
