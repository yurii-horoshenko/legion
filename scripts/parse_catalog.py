#!/usr/bin/env python3
"""
Parse core/agents/catalog/**/*.md → platforms/web/data/agents-catalog.json
Each agent file has YAML frontmatter: name, description, emoji, color, vibe
"""

import json, re, sys
from pathlib import Path

ROOT      = Path(__file__).parent.parent
CATALOG   = ROOT / "core/agents/catalog"
OUT_JSON  = ROOT / "platforms/web/data/agents-catalog.json"

GROUP_COLORS = {
    "academic":           "#8B5CF6",
    "design":             "#EC4899",
    "engineering":        "#0EA5E9",
    "finance":            "#10B981",
    "game-development":   "#F97316",
    "marketing":          "#EF4444",
    "paid-media":         "#F59E0B",
    "product":            "#6366F1",
    "project-management": "#14B8A6",
    "sales":              "#84CC16",
    "spatial-computing":  "#A78BFA",
    "specialized":        "#64748B",
    "strategy":           "#F43F5E",
    "support":            "#22D3EE",
    "testing":            "#FB923C",
}

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

def parse_frontmatter(text):
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm

def extract_capabilities(text, description):
    """Extract h3 headings from Core Mission section, fallback to description keywords."""
    # Try ### headings inside Core Mission block
    mission = re.search(r"##[^#].*?Mission.*?\n(.*?)(?=\n##[^#]|\Z)", text, re.DOTALL | re.IGNORECASE)
    if mission:
        caps = re.findall(r"^###\s+(.+)", mission.group(1), re.MULTILINE)
        caps = [re.sub(r"[^\w\s,&/\-+]", "", c).strip() for c in caps if len(c) < 60]
        if caps:
            return caps[:5]
    # Fallback: split description by comma/semicolon
    if description:
        parts = [p.strip() for p in re.split(r"[,;]", description) if p.strip()]
        return parts[:5]
    return []

def parse_agents():
    agents = []
    for group_dir in sorted(CATALOG.iterdir()):
        if not group_dir.is_dir():
            continue
        group = group_dir.name
        color = GROUP_COLORS.get(group, "#94A3B8")

        for md_file in sorted(group_dir.glob("*.md")):
            text = md_file.read_text(encoding="utf-8")
            fm   = parse_frontmatter(text)
            name = fm.get("name", "")
            if not name:
                continue

            desc = fm.get("description", fm.get("vibe", ""))
            caps = extract_capabilities(text, desc)
            agents.append({
                "id":           slugify(name),
                "name":         name,
                "emoji":        fm.get("emoji", "🤖"),
                "group":        group,
                "color":        color,
                "vibe":         fm.get("vibe", ""),
                "description":  desc,
                "capabilities": caps,
                "prompt_file":  f"catalog/{group}/{md_file.name}",
                "source":       "agency-agents",
                "status":       "idle",
            })

    return agents

if __name__ == "__main__":
    agents = parse_agents()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(agents, ensure_ascii=False, indent=2))

    from collections import Counter
    groups = Counter(a["group"] for a in agents)
    print(f"\n  Parsed {len(agents)} agents → {OUT_JSON.relative_to(ROOT)}\n")
    for g, n in sorted(groups.items()):
        print(f"    {g:<25} {n}")
