"use strict";

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = function createConfigRoutes(ctx) {
  const { io, http, ai } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/models
    if (urlPath === "/api/models" && method === "GET") {
      http.json(res, 200, io.readModels());
      return true;
    }

    // POST /api/models
    if (urlPath === "/api/models" && method === "POST") {
      const models = io.readModels();
      const model  = { ...body, id: body.id || crypto.randomUUID() };
      const exists = models.findIndex(m => m.id === model.id);
      if (exists >= 0) models[exists] = model; else models.push(model);
      io.writeModels(models);
      http.json(res, 200, model);
      return true;
    }

    // DELETE /api/models/:id
    if (urlPath.startsWith("/api/models/") && method === "DELETE") {
      const id     = urlPath.slice("/api/models/".length);
      const models = io.readModels().filter(m => m.id !== id);
      io.writeModels(models);
      http.json(res, 200, { ok: true });
      return true;
    }

    // GET /api/providers
    if (urlPath === "/api/providers" && method === "GET") {
      http.json(res, 200, io.readProviders());
      return true;
    }

    // POST /api/providers
    if (urlPath === "/api/providers" && method === "POST") {
      const providers = io.readProviders();
      const provider  = { ...body, id: body.id || crypto.randomUUID() };
      const exists    = providers.findIndex(p => p.id === provider.id);
      if (exists >= 0) providers[exists] = provider; else providers.push(provider);
      io.writeProviders(providers);
      http.json(res, 200, provider);
      return true;
    }

    // DELETE /api/providers/:id
    if (urlPath.startsWith("/api/providers/") && urlPath.endsWith("/models") && method === "GET") {
      const id       = urlPath.slice("/api/providers/".length, -"/models".length);
      const provider = io.readProviders().find(p => p.id === id);
      if (!provider) { http.json(res, 404, { error: "Provider not found" }); return true; }
      const models = await ai.fetchRemoteModels(provider);
      http.json(res, 200, models);
      return true;
    }

    if (urlPath.startsWith("/api/providers/") && method === "DELETE") {
      const id        = urlPath.slice("/api/providers/".length);
      const providers = io.readProviders().filter(p => p.id !== id);
      io.writeProviders(providers);
      http.json(res, 200, { ok: true });
      return true;
    }

    // GET /api/health — provider circuit-breaker states (failover visibility)
    if (urlPath === "/api/health" && method === "GET") {
      const { breakerStates } = require("../lib/breaker");
      http.json(res, 200, { breakers: breakerStates() });
      return true;
    }

    // GET /api/config
    if (urlPath === "/api/config" && method === "GET") {
      http.json(res, 200, io.readConfig());
      return true;
    }

    // PUT /api/config
    if (urlPath === "/api/config" && method === "PUT") {
      const cfg = { ...io.readConfig(), ...body };
      io.writeConfig(cfg);
      http.json(res, 200, cfg);
      return true;
    }

    return false;
  };
};
