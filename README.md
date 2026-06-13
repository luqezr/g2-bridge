# Obsidian on G2 Bridge

Companion plugin for the [Obsidian on G2](https://github.com/luqezr/obsidian-on-g2) Even Hub app. Exposes a **read-only** HTTP API on `http://127.0.0.1:27124` so the phone app can read your vault while Obsidian is open.

## Install

1. Open Obsidian → **Settings → Community plugins**.
2. Enable community plugins if needed.
3. Browse → search **Even G2 Bridge** → Install → Enable.

Or install manually: copy `main.js`, `manifest.json`, `styles.css`, and `versions.json` into `.obsidian/plugins/evenrealities-glasses-bridge/`.

## One-time setup on phone

1. Install and enable this plugin in Obsidian on your phone.
2. Keep Obsidian open (plugin starts the localhost server on load).
3. Open **Obsidian on G2** on the Even app → tap **Connect to Obsidian**.

The app stores a device-local token after the first handshake. Later launches reconnect automatically while Obsidian is running.

## Security

- Server binds to **127.0.0.1 only** (not reachable from Wi‑Fi/LAN).
- Requests must include `X-Obsidian-On-G2-Client: com.luqezr.obsidianong2`.
- Read-only endpoints; no write or delete.

See [docs/obsidian-plugin-api.md](../docs/obsidian-plugin-api.md) for the full API.

## Build

```bash
cd obsidian-plugin
npm install
npm run build
```

Produces `main.js` for Community Plugins submission.

## Mobile note

The plugin uses Node's `http` module to listen on `127.0.0.1`. **Obsidian on iPhone/iPad does not provide Node.js**, so the bridge cannot run there (`http.createServer` is unavailable).

| Platform | Plugin bridge |
|----------|----------------|
| Desktop (Windows/macOS/Linux) | Supported |
| Obsidian Android | May work (device-dependent) |
| Obsidian iOS | **Not supported** |

The G2 app connects to `http://127.0.0.1:27124` on **the same device** as Obsidian. On iPhone, use another vault source in the G2 app if available, or run Obsidian on Android/desktop with the G2 app on that same device.

If the server fails to start on other platforms, check Obsidian's developer console and report an issue.

## Community Plugins submission

- `manifest.json` — id `evenrealities-glasses-bridge`, min Obsidian 1.5.0
- Build artifact: `main.js`
- Listing: describe localhost bridge for Even G2 glasses app
