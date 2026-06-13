"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianOnG2BridgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// bridgeServer.ts
var DEFAULT_PLUGIN_PORT = 27124;
var PLUGIN_HOST = "127.0.0.1";
var CLIENT_HEADER = "X-Obsidian-On-G2-Client";
var CLIENT_ID = "com.luqezr.obsidianong2";
var PASSWORD_HEADER = "X-Obsidian-On-G2-Password";
var PLUGIN_VERSION = "0.1.0";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Obsidian-On-G2-Client, X-Obsidian-On-G2-Password"
};
function titleFromPath(path) {
  var _a;
  const base = (_a = path.split("/").pop()) != null ? _a : path;
  return base.replace(/\.md$/i, "");
}
function shouldSkipPath(path) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(".obsidian/") || normalized.startsWith(".git/") || normalized.startsWith(".trash/") || normalized.includes("/.obsidian/") || normalized.includes("/.git/") || normalized.includes("/.trash/");
}
function buildSearchText(title, path, frontmatter, body) {
  const parts = [title, path];
  const aliases = frontmatter == null ? void 0 : frontmatter.aliases;
  if (Array.isArray(aliases)) {
    parts.push(...aliases.filter((v) => typeof v === "string"));
  } else if (typeof aliases === "string") {
    parts.push(aliases);
  }
  const tags = frontmatter == null ? void 0 : frontmatter.tags;
  if (Array.isArray(tags)) {
    parts.push(...tags.filter((v) => typeof v === "string"));
  } else if (typeof tags === "string") {
    parts.push(tags);
  }
  const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 2e3);
  if (excerpt) parts.push(excerpt);
  return parts.join(" ");
}
function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, body: raw };
  }
  const yamlBlock = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const data = {};
  for (const line of yamlBlock.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else if (typeof value === "string") {
      value = value.replace(/^['"]|['"]$/g, "");
    }
    data[key] = value;
  }
  return { data, body };
}
function normalizeLinkTarget(target) {
  return target.replace(/\.md$/i, "").trim();
}
function pathsEqual(a, b) {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}
function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
function textResponse(status, body, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders
    }
  });
}
function emptyResponse(status) {
  return new Response(null, { status, headers: { ...CORS_HEADERS } });
}
function unauthorized() {
  return jsonResponse(401, { error: "Unauthorized" });
}
function badClient() {
  return jsonResponse(403, { error: "Missing or invalid client header" });
}
function readBearerToken(request) {
  const header = request.headers.get("Authorization");
  if (!(header == null ? void 0 : header.startsWith("Bearer "))) return null;
  return header.slice("Bearer ".length).trim() || null;
}
function readPassword(request) {
  var _a, _b;
  return (_b = (_a = request.headers.get(PASSWORD_HEADER)) == null ? void 0 : _a.trim()) != null ? _b : "";
}
function secureEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
function passwordNotConfigured() {
  return jsonResponse(503, {
    error: "Bridge password not configured. Set a password in Obsidian plugin settings."
  });
}
function createTokenStore(plugin, getPassword) {
  var _a, _b;
  let sessionToken = (_b = (_a = plugin.loadData()) == null ? void 0 : _a.token) != null ? _b : null;
  return {
    get() {
      return sessionToken;
    },
    async set(token) {
      var _a2;
      sessionToken = token;
      const data = (_a2 = plugin.loadData()) != null ? _a2 : {};
      data.token = token;
      data.password = getPassword();
      await plugin.saveData(data);
    },
    clear() {
      sessionToken = null;
    }
  };
}
async function handleBridgeRequest(request, ctx) {
  var _a, _b;
  if (request.method === "OPTIONS") {
    return emptyResponse(204);
  }
  if (request.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  if (request.headers.get(CLIENT_HEADER) !== CLIENT_ID) {
    return badClient();
  }
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/v1/health") {
    if (!ctx.isPasswordConfigured()) {
      return passwordNotConfigured();
    }
    const bearer2 = readBearerToken(request);
    const password = readPassword(request);
    if (bearer2) {
      if (bearer2 !== ctx.getToken()) {
        return unauthorized();
      }
      return jsonResponse(200, {
        ok: true,
        vaultName: ctx.getVaultName(),
        pluginVersion: PLUGIN_VERSION
      });
    }
    if (password && ctx.verifyPassword(password)) {
      return jsonResponse(200, {
        ok: true,
        vaultName: ctx.getVaultName(),
        pluginVersion: PLUGIN_VERSION
      });
    }
    return unauthorized();
  }
  if (pathname === "/v1/handshake") {
    if (!ctx.isPasswordConfigured()) {
      return passwordNotConfigured();
    }
    const password = readPassword(request);
    if (!ctx.verifyPassword(password)) {
      return unauthorized();
    }
    let token = ctx.getToken();
    if (!token) {
      token = randomToken();
      await ctx.setToken(token);
    }
    return jsonResponse(200, { token, vaultName: ctx.getVaultName() });
  }
  const bearer = readBearerToken(request);
  if (!bearer || bearer !== ctx.getToken()) {
    return unauthorized();
  }
  if (pathname === "/v1/notes") {
    const notes = await ctx.listNotes();
    return jsonResponse(200, { notes });
  }
  if (pathname.startsWith("/v1/notes/")) {
    const encoded = pathname.slice("/v1/notes/".length);
    const notePath = decodeURIComponent(encoded);
    try {
      const body = await ctx.readNote(notePath);
      return textResponse(200, body);
    } catch (e) {
      return jsonResponse(404, { error: "Note not found" });
    }
  }
  if (pathname === "/v1/resolve") {
    const target = (_a = url.searchParams.get("target")) != null ? _a : "";
    const from = (_b = url.searchParams.get("from")) != null ? _b : "";
    const resolved = await ctx.resolveLink(target, from);
    return jsonResponse(200, { path: resolved });
  }
  return jsonResponse(404, { error: "Not found" });
}
function createBridgeContext(app, plugin, getPassword, tokenStore) {
  let cachedIndex = null;
  async function buildIndex() {
    var _a;
    const notes = [];
    for (const file of app.vault.getMarkdownFiles()) {
      const path = file.path;
      if (shouldSkipPath(path)) continue;
      const title = titleFromPath(path);
      let searchText = `${title} ${path}`;
      try {
        const raw = await app.vault.read(file);
        const parsed = splitFrontmatter(raw);
        const cache = app.metadataCache.getFileCache(file);
        const frontmatter = (_a = cache == null ? void 0 : cache.frontmatter) != null ? _a : parsed.data;
        searchText = buildSearchText(title, path, frontmatter != null ? frontmatter : null, parsed.body);
      } catch (e) {
      }
      notes.push({
        path,
        title,
        modifiedMs: file.stat.mtime,
        searchText
      });
    }
    notes.sort((a, b) => a.path.localeCompare(b.path));
    cachedIndex = notes;
    return notes;
  }
  return {
    getToken() {
      return tokenStore.get();
    },
    async setToken(token) {
      await tokenStore.set(token);
    },
    clearToken() {
      tokenStore.clear();
    },
    isPasswordConfigured() {
      return Boolean(getPassword().length);
    },
    verifyPassword(password) {
      const expected = getPassword();
      if (!expected) return false;
      return secureEqual(password, expected);
    },
    getVaultName() {
      return app.vault.getName();
    },
    async listNotes() {
      return buildIndex();
    },
    async readNote(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file || !("extension" in file) || file.extension !== "md") {
        throw new Error("Note not found");
      }
      return app.vault.read(file);
    },
    async resolveLink(target, fromPath) {
      var _a, _b;
      if (!cachedIndex) await buildIndex();
      const index = cachedIndex != null ? cachedIndex : [];
      const normalized = normalizeLinkTarget(target);
      const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
      const candidates = [
        normalized,
        `${normalized}.md`,
        fromDir ? `${fromDir}/${normalized}` : normalized,
        fromDir ? `${fromDir}/${normalized}.md` : `${normalized}.md`
      ];
      for (const candidate of candidates) {
        const match = index.find((note) => pathsEqual(note.path, candidate));
        if (match) return match.path;
      }
      const basename = (_a = normalized.split("/").pop()) != null ? _a : normalized;
      const loose = index.find(
        (note) => note.title.toLowerCase() === basename.toLowerCase() || note.path.toLowerCase().endsWith(`/${basename.toLowerCase()}.md`)
      );
      return (_b = loose == null ? void 0 : loose.path) != null ? _b : null;
    }
  };
}
function formatClientStatus(status) {
  if (!status.lastClientAt) {
    return "No G2 app connected yet. Open the Obsidian on G2 app and tap Test connection or Connect.";
  }
  const agoSec = Math.floor((Date.now() - status.lastClientAt) / 1e3);
  const requests = `${status.clientRequestCount} request${status.clientRequestCount === 1 ? "" : "s"} total`;
  if (agoSec < 60) {
    return `G2 app active ${agoSec === 0 ? "just now" : `${agoSec}s ago`} (${requests})`;
  }
  if (agoSec < 3600) {
    return `Last G2 app request ${Math.floor(agoSec / 60)}m ago (${requests})`;
  }
  return `Last G2 app request ${Math.floor(agoSec / 3600)}h ago (${requests})`;
}
function isClientRecentlyActive(status, withinMs = 5 * 60 * 1e3) {
  return status.lastClientAt !== null && Date.now() - status.lastClientAt < withinMs;
}
function createBridgeServer(app, plugin, options = {}) {
  var _a, _b;
  const getPassword = (_a = options.getPassword) != null ? _a : () => "";
  const tokenStore = createTokenStore(plugin, getPassword);
  const ctx = createBridgeContext(app, plugin, getPassword, tokenStore);
  const port = (_b = options.port) != null ? _b : DEFAULT_PLUGIN_PORT;
  const host = PLUGIN_HOST;
  let activeServer = null;
  const status = {
    running: false,
    port,
    host,
    lastClientAt: null,
    clientRequestCount: 0,
    error: null
  };
  function recordClientActivity() {
    var _a2;
    status.lastClientAt = Date.now();
    status.clientRequestCount++;
    (_a2 = options.onClientActivity) == null ? void 0 : _a2.call(options);
  }
  return {
    getStatus() {
      return { ...status };
    },
    clearSessionToken() {
      tokenStore.clear();
    },
    async start() {
      if (activeServer) return;
      status.port = port;
      status.error = null;
      status.running = false;
      try {
        const http = require("http");
        if (!(http == null ? void 0 : http.createServer)) {
          throw new Error("Node.js HTTP is not available on this device (http.createServer missing).");
        }
        activeServer = http.createServer(async (req, res) => {
          var _a2, _b2;
          try {
            const clientHeader = req.headers[CLIENT_HEADER.toLowerCase()];
            if (clientHeader === CLIENT_ID) {
              recordClientActivity();
            }
            const hostHeader = (_a2 = req.headers.host) != null ? _a2 : `${host}:${port}`;
            const url = `http://${hostHeader}${(_b2 = req.url) != null ? _b2 : "/"}`;
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === "string") headers.set(key, value);
              else if (Array.isArray(value)) headers.set(key, value.join(", "));
            }
            const request = new Request(url, { method: req.method, headers });
            const response = await handleBridgeRequest(request, ctx);
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              res.setHeader(key, value);
            });
            const body = await response.text();
            res.end(body);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            for (const [key, value] of Object.entries(CORS_HEADERS)) {
              res.setHeader(key, value);
            }
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }));
          }
        });
        await new Promise((resolve, reject) => {
          activeServer.listen(port, host, () => resolve());
          activeServer.on("error", reject);
        });
        status.running = true;
      } catch (error) {
        status.running = false;
        status.error = error instanceof Error ? error.message : String(error);
        activeServer = null;
        throw error;
      }
    },
    async stop() {
      if (!activeServer) return;
      const server = activeServer;
      activeServer = null;
      status.running = false;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

// platformSupport.ts
var import_obsidian = require("obsidian");
var IOS_BRIDGE_UNSUPPORTED_MESSAGE = "Obsidian on iPhone/iPad cannot run the localhost bridge. The iOS app does not include Node.js HTTP support (http.createServer). The G2 app connects to 127.0.0.1 on the same phone as Obsidian, so this plugin only works where a local HTTP server can run \u2014 currently desktop and some Android builds, not iOS. Try Obsidian on Android with the G2 app on that phone, or use a desktop Obsidian + simulator setup for development.";
function getBridgeUnsupportedMessage() {
  if (import_obsidian.Platform.isIosApp) {
    return IOS_BRIDGE_UNSUPPORTED_MESSAGE;
  }
  return null;
}
function isBridgeSupportedPlatform() {
  return getBridgeUnsupportedMessage() === null;
}
function isHttpModuleUnavailable(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("createserver") || normalized.includes("cannot find module") || normalized.includes("node.js http") || normalized.includes("http is not available");
}
function formatHttpStartError(error) {
  const unsupported = getBridgeUnsupportedMessage();
  if (unsupported) return unsupported;
  if (error instanceof Error && error.message.trim()) {
    if (isHttpModuleUnavailable(error)) {
      return "Node.js HTTP is not available in Obsidian on this device, so the localhost bridge cannot start. Try Obsidian on desktop or Android, or use the folder-picker vault source in the G2 app where supported.";
    }
    return error.message;
  }
  return String(error);
}

// settingsTab.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  port: DEFAULT_PLUGIN_PORT,
  password: ""
};
var BridgeSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.statusBlockEl = null;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    this.statusBlockEl = null;
    containerEl.createEl("h2", { text: "Obsidian on G2 Bridge" });
    this.statusBlockEl = containerEl.createDiv({ cls: "obsidian-on-g2-bridge-status" });
    const unsupported = getBridgeUnsupportedMessage();
    if (unsupported) {
      this.renderStatus();
    } else {
      void this.plugin.ensureServerRunning().finally(() => this.renderStatus());
    }
    new import_obsidian2.Setting(containerEl).setName("Bridge password").setDesc(
      "Required. The G2 app must use the same password to connect. Protects the localhost bridge from unauthorized access."
    ).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("Enter a password");
      text.setValue(this.plugin.settings.password);
      text.onChange((value) => {
        this.plugin.settings.password = value;
        void this.plugin.saveSettings().then(() => {
          this.renderStatus();
          this.plugin.updateStatusBar();
        });
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Port").setDesc(
      "Localhost port the G2 app connects to. Default is 27124. The same port must be set in the G2 app settings."
    ).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.max = "65535";
      text.setPlaceholder(String(DEFAULT_PLUGIN_PORT));
      text.setValue(String(this.plugin.settings.port));
      text.onChange((value) => {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return;
        this.plugin.settings.port = port;
        void this.plugin.saveSettings().then(async () => {
          if (isBridgeSupportedPlatform()) {
            await this.plugin.restartServer();
          }
        }).then(() => {
          this.renderStatus();
          this.plugin.updateStatusBar();
        }).catch((error) => {
          console.error("[evenrealities-glasses-bridge] failed to restart after port change:", error);
          this.renderStatus();
        });
      });
    });
    if (unsupported) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "Password and port settings are saved for use on supported devices (desktop or Android). They have no effect on iPhone until Obsidian adds HTTP server support."
      });
    } else {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "Keep Obsidian open on this device while using the G2 app. Enter the same password in the G2 app settings."
      });
      new import_obsidian2.Setting(containerEl).setName("Start server").setDesc("Start or restart the localhost bridge if it is not running.").addButton((button) => {
        button.setButtonText("Start server");
        button.onClick(() => {
          button.setDisabled(true);
          void this.plugin.ensureServerRunning().then(() => {
            this.renderStatus();
            this.plugin.updateStatusBar();
          }).finally(() => {
            button.setDisabled(false);
          });
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Refresh status").setDesc("Update the connection status shown above.").addButton((button) => {
        button.setButtonText("Refresh");
        button.onClick(() => {
          void this.plugin.ensureServerRunning().finally(() => {
            this.plugin.updateStatusBar();
            this.renderStatus();
          });
        });
      });
    }
  }
  renderStatus() {
    if (!this.statusBlockEl) return;
    this.statusBlockEl.empty();
    const status = this.plugin.getServerStatus();
    const unsupported = getBridgeUnsupportedMessage();
    if (unsupported) {
      this.statusBlockEl.createEl("p", {
        text: "Bridge not available on this device",
        cls: "mod-warning"
      });
      this.statusBlockEl.createEl("p", { text: unsupported });
      return;
    }
    if (status.running) {
      this.statusBlockEl.createEl("p", {
        text: `Server running at http://${PLUGIN_HOST}:${status.port}`
      });
      if (!this.plugin.settings.password) {
        this.statusBlockEl.createEl("p", {
          text: "Set a bridge password below \u2014 connections are rejected until a password is configured.",
          cls: "mod-warning"
        });
      }
      this.statusBlockEl.createEl("p", { text: formatClientStatus(status) });
    } else if (status.error) {
      this.statusBlockEl.createEl("p", {
        text: `Server failed to start: ${status.error}`,
        cls: "mod-warning"
      });
      if (status.error.includes("Cannot find module") || status.error.toLowerCase().includes("require")) {
        this.statusBlockEl.createEl("p", {
          text: "Obsidian on this device may not support the Node HTTP server used by this plugin. Try Obsidian on Android, or use the folder picker vault source in the G2 app instead.",
          cls: "setting-item-description"
        });
      }
    } else {
      this.statusBlockEl.createEl("p", {
        text: "Server is not running. Tap Start server below, or disable and re-enable the plugin.",
        cls: "mod-warning"
      });
    }
  }
};

// main.ts
var ObsidianOnG2BridgePlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.server = null;
    this.statusBarItem = null;
    this.statusInterval = null;
    this.lastStartError = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BridgeSettingTab(this.app, this));
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass("mod-clickable");
    this.statusBarItem.onClickEvent(() => {
      this.app.setting.open();
    });
    try {
      const unsupported = getBridgeUnsupportedMessage();
      if (unsupported) {
        this.lastStartError = unsupported;
      } else {
        await this.startServer();
        this.lastStartError = null;
      }
    } catch (error) {
      this.lastStartError = formatHttpStartError(error);
      console.error("[evenrealities-glasses-bridge] failed to start localhost server:", error);
    }
    this.updateStatusBar();
    this.statusInterval = window.setInterval(() => this.updateStatusBar(), 1e4);
  }
  async onunload() {
    if (this.statusInterval !== null) {
      window.clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    await this.stopServer();
    this.statusBarItem = null;
  }
  async loadSettings() {
    var _a;
    const data = await this.loadData();
    const port = (_a = data == null ? void 0 : data.port) != null ? _a : DEFAULT_PLUGIN_PORT;
    this.settings = {
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PLUGIN_PORT,
      password: typeof (data == null ? void 0 : data.password) === "string" ? data.password : ""
    };
  }
  async saveSettings() {
    var _a, _b;
    const data = (_a = await this.loadData()) != null ? _a : {};
    const previousPassword = typeof data.password === "string" ? data.password : "";
    const passwordChanged = previousPassword !== this.settings.password;
    const next = {
      ...data,
      port: this.settings.port,
      password: this.settings.password
    };
    if (passwordChanged) {
      delete next.token;
      (_b = this.server) == null ? void 0 : _b.clearSessionToken();
    }
    await this.saveData(next);
  }
  getServerStatus() {
    if (!this.server) {
      return {
        running: false,
        port: this.settings.port,
        host: "127.0.0.1",
        lastClientAt: null,
        clientRequestCount: 0,
        error: this.lastStartError
      };
    }
    const status = this.server.getStatus();
    if (!status.running && !status.error && this.lastStartError) {
      return { ...status, error: this.lastStartError };
    }
    return status;
  }
  async ensureServerRunning() {
    if (!isBridgeSupportedPlatform()) {
      this.lastStartError = getBridgeUnsupportedMessage();
      this.updateStatusBar();
      return false;
    }
    if (this.getServerStatus().running) {
      return true;
    }
    try {
      await this.stopServer();
      await this.startServer();
      this.lastStartError = null;
      return true;
    } catch (error) {
      this.lastStartError = formatHttpStartError(error);
      console.error("[evenrealities-glasses-bridge] failed to start localhost server:", error);
      this.updateStatusBar();
      return false;
    }
  }
  async startServer() {
    const unsupported = getBridgeUnsupportedMessage();
    if (unsupported) {
      throw new Error(unsupported);
    }
    await this.stopServer();
    this.server = createBridgeServer(this.app, this, {
      port: this.settings.port,
      getPassword: () => this.settings.password,
      onClientActivity: () => this.updateStatusBar()
    });
    await this.server.start();
    this.lastStartError = null;
    console.log(
      `[evenrealities-glasses-bridge] listening on http://127.0.0.1:${this.settings.port}`
    );
    this.updateStatusBar();
  }
  async stopServer() {
    var _a;
    await ((_a = this.server) == null ? void 0 : _a.stop());
    this.server = null;
  }
  async restartServer() {
    try {
      await this.startServer();
    } catch (error) {
      this.lastStartError = formatHttpStartError(error);
      console.error("[evenrealities-glasses-bridge] failed to restart localhost server:", error);
      this.updateStatusBar();
      throw error;
    }
  }
  updateStatusBar() {
    if (!this.statusBarItem) return;
    const status = this.getServerStatus();
    if (!status.running) {
      if (!isBridgeSupportedPlatform()) {
        this.statusBarItem.setText("G2 Bridge: not supported on iOS");
        return;
      }
      const suffix = status.error ? `: ${status.error}` : "";
      this.statusBarItem.setText(`G2 Bridge: stopped${suffix}`);
      return;
    }
    if (!this.settings.password) {
      this.statusBarItem.setText(`G2 Bridge: :${status.port} \xB7 set password`);
      return;
    }
    const clientLabel = isClientRecentlyActive(status) ? "client connected" : "waiting for client";
    this.statusBarItem.setText(`G2 Bridge: :${status.port} \xB7 ${clientLabel}`);
    this.statusBarItem.setAttr("aria-label", formatClientStatus(status));
  }
};
