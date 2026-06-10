import { Plugin } from 'obsidian'
import { createBridgeServer } from './bridgeServer'

export default class ObsidianOnG2BridgePlugin extends Plugin {
  private server: ReturnType<typeof createBridgeServer> | null = null

  async onload(): Promise<void> {
    this.server = createBridgeServer(this.app, this)
    try {
      await this.server.start()
      console.log('[evenrealities-glasses-bridge] listening on http://127.0.0.1:27124')
    } catch (error) {
      console.error('[evenrealities-glasses-bridge] failed to start localhost server:', error)
    }
  }

  async onunload(): Promise<void> {
    await this.server?.stop()
    this.server = null
  }
}
