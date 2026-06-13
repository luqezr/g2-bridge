import { Platform } from 'obsidian'

export const IOS_BRIDGE_UNSUPPORTED_MESSAGE =
  'Obsidian on iPhone/iPad cannot run the localhost bridge. The iOS app does not include Node.js HTTP support (http.createServer). ' +
  'The G2 app connects to 127.0.0.1 on the same phone as Obsidian, so this plugin only works where a local HTTP server can run — currently desktop and some Android builds, not iOS. ' +
  'Try Obsidian on Android with the G2 app on that phone, or use a desktop Obsidian + simulator setup for development.'

export function getBridgeUnsupportedMessage(): string | null {
  if (Platform.isIosApp) {
    return IOS_BRIDGE_UNSUPPORTED_MESSAGE
  }
  return null
}

export function isBridgeSupportedPlatform(): boolean {
  return getBridgeUnsupportedMessage() === null
}

export function isHttpModuleUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('createserver') ||
    normalized.includes('cannot find module') ||
    normalized.includes('node.js http') ||
    normalized.includes('http is not available')
  )
}

export function formatHttpStartError(error: unknown): string {
  const unsupported = getBridgeUnsupportedMessage()
  if (unsupported) return unsupported

  if (error instanceof Error && error.message.trim()) {
    if (isHttpModuleUnavailable(error)) {
      return (
        'Node.js HTTP is not available in Obsidian on this device, so the localhost bridge cannot start. ' +
        'Try Obsidian on desktop or Android, or use the folder-picker vault source in the G2 app where supported.'
      )
    }
    return error.message
  }

  return String(error)
}
