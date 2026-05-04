You are analyzing a software project to extract its requirements before selecting AI agents.

## Project

Name: {{project_name}}
Description: {{project_description}}

## Documentation

{{project_docs}}

## Currently active agents in Legion

IMPORTANT: The list below is the ONLY source of truth for what is currently active in this project. Agents mentioned anywhere in the project documentation (docs/AGENTS.md, aifactory/, .claude/agents/, or any agent list in markdown files) are NOT active — they may be planned, historical, or installed in a different system. Do not treat them as coverage.

{{existing_agents}}

---

## Your task

Extract the following from the project context above:

1. **domain** — one of: `game`, `web`, `mobile`, `backend`, `marketing`, `assistant`, `general`
2. **tech_stack** — list the key technologies, frameworks, engines, languages, and platforms explicitly mentioned in the documentation
3. **functional_areas** — list every concrete functional role this project needs covered, based on the tech stack and stated goals. Think in terms of work that needs doing, not job titles. Be specific and thorough. Examples: "Unreal Engine C++ gameplay systems", "PostgreSQL schema design at scale", "CI/CD for multi-platform builds", "UMG/HUD UI design", "AWS GameLift server management". For a complex project aim for 10–16 areas.
4. **covered_by_existing** — what functional areas the currently active Legion agents (listed above) already handle. If the list says "None yet", this must be an empty array.

Respond with ONLY a valid JSON object. No markdown, no explanation, no code fences — raw JSON only.

{
  "domain": "game|web|mobile|backend|marketing|assistant|general",
  "tech_stack": ["technology1", "technology2"],
  "functional_areas": ["specific area 1", "specific area 2"],
  "covered_by_existing": []
}
