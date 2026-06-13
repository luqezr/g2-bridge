import { App, PluginSettingTab, Setting } from 'obsidian'
import type ObsidianOnG2BridgePlugin from './main'
import { DEFAULT_PLUGIN_PORT, formatClientStatus, PLUGIN_HOST } from './bridgeServer'
import { getBridgeUnsupportedMessage, isBridgeSupportedPlatform } from './platformSupport'

export interface BridgeSettings {
  port: number
  password: string
}

export const DEFAULT_SETTINGS: BridgeSettings = {
  port: DEFAULT_PLUGIN_PORT,
  password: '',
}

export class BridgeSettingTab extends PluginSettingTab {
  private statusBlockEl: HTMLElement | null = null

  constructor(app: App, private readonly plugin: ObsidianOnG2BridgePlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    this.statusBlockEl = null

    containerEl.createEl('h2', { text: 'Obsidian on G2 Bridge' })

    this.statusBlockEl = containerEl.createDiv({ cls: 'obsidian-on-g2-bridge-status' })

    const unsupported = getBridgeUnsupportedMessage()
    if (unsupported) {
      this.renderStatus()
    } else {
      void this.plugin.ensureServerRunning().finally(() => this.renderStatus())
    }

    new Setting(containerEl)
      .setName('Bridge password')
      .setDesc(
        'Required. The G2 app must use the same password to connect. Protects the localhost bridge from unauthorized access.',
      )
      .addText(text => {
        text.inputEl.type = 'password'
        text.setPlaceholder('Enter a password')
        text.setValue(this.plugin.settings.password)
        text.onChange(value => {
          this.plugin.settings.password = value
          void this.plugin.saveSettings().then(() => {
            this.renderStatus()
            this.plugin.updateStatusBar()
          })
        })
      })

    new Setting(containerEl)
      .setName('Port')
      .setDesc(
        'Localhost port the G2 app connects to. Default is 27124. The same port must be set in the G2 app settings.',
      )
      .addText(text => {
        text.inputEl.type = 'number'
        text.inputEl.min = '1'
        text.inputEl.max = '65535'
        text.setPlaceholder(String(DEFAULT_PLUGIN_PORT))
        text.setValue(String(this.plugin.settings.port))
        text.onChange(value => {
          const port = Number(value)
          if (!Number.isInteger(port) || port < 1 || port > 65535) return
          this.plugin.settings.port = port
          void this.plugin
            .saveSettings()
            .then(async () => {
              if (isBridgeSupportedPlatform()) {
                await this.plugin.restartServer()
              }
            })
            .then(() => {
              this.renderStatus()
              this.plugin.updateStatusBar()
            })
            .catch(error => {
              console.error('[evenrealities-glasses-bridge] failed to restart after port change:', error)
              this.renderStatus()
            })
        })
      })

    if (unsupported) {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Password and port settings are saved for use on supported devices (desktop or Android). They have no effect on iPhone until Obsidian adds HTTP server support.',
      })
    } else {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Keep Obsidian open on this device while using the G2 app. Enter the same password in the G2 app settings.',
      })

      new Setting(containerEl)
        .setName('Start server')
        .setDesc('Start or restart the localhost bridge if it is not running.')
        .addButton(button => {
          button.setButtonText('Start server')
          button.onClick(() => {
            button.setDisabled(true)
            void this.plugin
              .ensureServerRunning()
              .then(() => {
                this.renderStatus()
                this.plugin.updateStatusBar()
              })
              .finally(() => {
                button.setDisabled(false)
              })
          })
        })

      new Setting(containerEl)
        .setName('Refresh status')
        .setDesc('Update the connection status shown above.')
        .addButton(button => {
          button.setButtonText('Refresh')
          button.onClick(() => {
            void this.plugin.ensureServerRunning().finally(() => {
              this.plugin.updateStatusBar()
              this.renderStatus()
            })
          })
        })
    }
  }

  private renderStatus(): void {
    if (!this.statusBlockEl) return

    this.statusBlockEl.empty()
    const status = this.plugin.getServerStatus()
    const unsupported = getBridgeUnsupportedMessage()

    if (unsupported) {
      this.statusBlockEl.createEl('p', {
        text: 'Bridge not available on this device',
        cls: 'mod-warning',
      })
      this.statusBlockEl.createEl('p', { text: unsupported })
      return
    }

    if (status.running) {
      this.statusBlockEl.createEl('p', {
        text: `Server running at http://${PLUGIN_HOST}:${status.port}`,
      })
      if (!this.plugin.settings.password) {
        this.statusBlockEl.createEl('p', {
          text: 'Set a bridge password below — connections are rejected until a password is configured.',
          cls: 'mod-warning',
        })
      }
      this.statusBlockEl.createEl('p', { text: formatClientStatus(status) })
    } else if (status.error) {
      this.statusBlockEl.createEl('p', {
        text: `Server failed to start: ${status.error}`,
        cls: 'mod-warning',
      })
      if (status.error.includes('Cannot find module') || status.error.toLowerCase().includes('require')) {
        this.statusBlockEl.createEl('p', {
          text: 'Obsidian on this device may not support the Node HTTP server used by this plugin. Try Obsidian on Android, or use the folder picker vault source in the G2 app instead.',
          cls: 'setting-item-description',
        })
      }
    } else {
      this.statusBlockEl.createEl('p', {
        text: 'Server is not running. Tap Start server below, or disable and re-enable the plugin.',
        cls: 'mod-warning',
      })
    }
  }
}
