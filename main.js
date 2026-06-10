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
var import_obsidian = require("obsidian");

// bridgeServer.ts
var PLUGIN_PORT = 27124;
var PLUGIN_HOST = "127.0.0.1";
var CLIENT_HEADER = "X-Obsidian-On-G2-Client";
var CLIENT_ID = "com.luqezr.obsidianong2";
var PLUGIN_VERSION = "0.1.0";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Obsidian-On-G2-Client"
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
    const token = readBearerToken(request);
    if (token && token !== ctx.getToken()) {
      return unauthorized();
    }
    return jsonResponse(200, {
      ok: true,
      vaultName: ctx.getVaultName(),
      pluginVersion: PLUGIN_VERSION
    });
  }
  if (pathname === "/v1/handshake") {
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
function createBridgeContext(app, plugin) {
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
      var _a;
      const data = plugin.loadData();
      return (_a = data == null ? void 0 : data.token) != null ? _a : null;
    },
    async setToken(token) {
      var _a;
      const data = (_a = plugin.loadData()) != null ? _a : {};
      data.token = token;
      await plugin.saveData(data);
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
function createBridgeServer(app, plugin) {
  const ctx = createBridgeContext(app, plugin);
  let activeServer = null;
  return {
    async start() {
      if (activeServer) return;
      const http = require("http");
      activeServer = http.createServer(async (req, res) => {
        var _a, _b;
        try {
          const host = (_a = req.headers.host) != null ? _a : `${PLUGIN_HOST}:${PLUGIN_PORT}`;
          const url = `http://${host}${(_b = req.url) != null ? _b : "/"}`;
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
        activeServer.listen(PLUGIN_PORT, PLUGIN_HOST, () => resolve());
        activeServer.on("error", reject);
      });
    },
    async stop() {
      if (!activeServer) return;
      const server = activeServer;
      activeServer = null;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

// main.ts
var ObsidianOnG2BridgePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.server = null;
  }
  async onload() {
    this.server = createBridgeServer(this.app, this);
    try {
      await this.server.start();
      console.log("[evenrealities-glasses-bridge] listening on http://127.0.0.1:27124");
    } catch (error) {
      console.error("[evenrealities-glasses-bridge] failed to start localhost server:", error);
    }
  }
  async onunload() {
    var _a;
    await ((_a = this.server) == null ? void 0 : _a.stop());
    this.server = null;
  }
};
