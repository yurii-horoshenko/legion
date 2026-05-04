You are analyzing a software project to extract its requirements before selecting AI agents.

## Project

Name: {{project_name}}
Description: {{project_description}}

## Documentation

{{project_docs}}

## Existing agents

{{existing_agents}}

---

## Your task

Extract the following from the project context above:

1. **domain** — one of: `game`, `web`, `mobile`, `backend`, `marketing`, `assistant`, `general`
2. **tech_stack** — list the key technologies, frameworks, engines, languages, and platforms explicitly mentioned
3. **functional_areas** — list the concrete functional roles this project needs covered. Think in terms of work that needs doing, not job titles. Be specific to this project. Examples: "Unreal Engine C++ gameplay systems", "PostgreSQL schema design at scale", "CI/CD for multi-platform builds", "UMG/HUD UI design", "AWS GameLift server management". Aim for 6–12 areas.
4. **covered_by_existing** — what functional areas the existing agents already handle (based on their names/roles). Empty array if no existing agents.

Respond with ONLY a valid JSON object. No markdown, no explanation, no code fences — raw JSON only.

{
  "domain": "game|web|mobile|backend|marketing|assistant|general",
  "tech_stack": ["technology1", "technology2"],
  "functional_areas": ["specific area 1", "specific area 2"],
  "covered_by_existing": ["what is already covered"]
}
