"use strict";

const fs   = require("fs");
const path = require("path");

const GROUP_COLORS = {
  academic: "#8B5CF6", design: "#EC4899", engineering: "#0EA5E9",
  finance: "#10B981", "game-development": "#F97316", marketing: "#EF4444",
  "paid-media": "#F59E0B", product: "#6366F1", "project-management": "#14B8A6",
  sales: "#84CC16", "spatial-computing": "#A78BFA", specialized: "#64748B",
  strategy: "#F43F5E", support: "#22D3EE", testing: "#FB923C",
};

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return fm;
}

function extractCapabilities(text, description) {
  const missionMatch = text.match(/##[^#].*?Mission[\s\S]*?\n([\s\S]*?)(?=\n##[^#]|$)/i);
  if (missionMatch) {
    const caps = [...missionMatch[1].matchAll(/^###\s+(.+)/gm)]
      .map(m => m[1].trim()).filter(c => c.length < 60).slice(0, 5);
    if (caps.length) return caps;
  }
  return description ? description.split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 5) : [];
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readLocale(groupDir, file, lang) {
  const p = path.join(groupDir, lang, file);
  if (!fs.existsSync(p)) return null;
  return parseFrontmatter(fs.readFileSync(p, "utf8"));
}

function buildCatalog(webRoot) {
  // Look for catalog next to the package, then fall back to cwd
  let catalogDir = path.resolve(webRoot, "../../core/agents/catalog");
  if (!fs.existsSync(catalogDir)) {
    catalogDir = path.resolve(process.cwd(), "core/agents/catalog");
  }
  const outFile = path.join(webRoot, "data", "agents-catalog.json");
  if (!fs.existsSync(catalogDir)) {
    console.log("  Catalog: core/agents/catalog not found — skipping");
    return;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const agents = [];
  for (const group of fs.readdirSync(catalogDir).sort()) {
    const groupDir = path.join(catalogDir, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;
    const color = GROUP_COLORS[group] || "#94A3B8";
    for (const file of fs.readdirSync(groupDir).filter(f => f.endsWith(".md")).sort()) {
      const text = fs.readFileSync(path.join(groupDir, file), "utf8");
      const fm   = parseFrontmatter(text);
      if (!fm.name) continue;

      const en = readLocale(groupDir, file, "en") || fm;
      const ru = readLocale(groupDir, file, "ru");

      agents.push({
        id:          slugify(fm.name),
        group,
        color:       fm.color || color,
        emoji:       fm.emoji || "🤖",
        capabilities: extractCapabilities(text, fm.description || ""),
        prompt_file: `catalog/${group}/${file}`,
        source:      "agency-agents",
        status:      "idle",
        // locale map: each lang has name/description/vibe/emoji/color
        locales: {
          en: {
            name:        en.name        || fm.name,
            description: en.description || fm.description || "",
            vibe:        en.vibe        || fm.vibe || "",
            emoji:       en.emoji       || fm.emoji || "🤖",
            color:       en.color       || fm.color || color,
          },
          ru: ru ? {
            name:        ru.name        || fm.name,
            description: ru.description || fm.description || "",
            vibe:        ru.vibe        || fm.vibe || "",
            emoji:       ru.emoji       || fm.emoji || "🤖",
            color:       ru.color       || fm.color || color,
          } : null,
        },
        // convenience flat fields for en (default)
        name:        en.name        || fm.name,
        description: en.description || fm.description || "",
        vibe:        en.vibe        || fm.vibe || "",
      });
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(agents, null, 2));
  console.log(`  Catalog: ${agents.length} agents loaded from core/agents/catalog/`);
}

module.exports = { buildCatalog };
