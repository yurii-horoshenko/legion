You are selecting the most relevant skills and MCP servers for a specific AI agent from real catalog search results.

## Agent

Name: {{agent_name}}
Role: {{agent_role}}
Group: {{agent_group}}
Capabilities: {{capabilities}}

## Agent identity file (IDENTITY.md)

This is the agent's actual identity document — use it to deeply understand what this agent does in this project:

{{agent_identity}}

## Project context

{{project_context}}

## Already installed

{{installed_skills}}

## Live catalog search results

The following items were retrieved right now from Smithery, Skills.sh (GitHub), and SkillsMP.
Prefer recommending from this list — these are real, currently available tools.
If the list is sparse or missing something obvious, you may add well-known tools not in the list, but mark their source clearly.

{{catalog_results}}

## Your task

Select 5–10 skills or MCP servers that would genuinely help this agent do its job better.

Rules:
- Strict relevance filter — "would this agent use this tool daily or weekly?"
- Prefer items already in the catalog results above (they exist and are installable now)
- Do NOT recommend skills already listed under "Already installed"
- For each item write one specific reason tied to this agent's exact role and project context
- Keep install commands exactly as shown in the catalog results

### Final verification step

Before producing output, cross-check each selected skill against the agent's identity and role:
- Does this skill match the specific technologies mentioned in IDENTITY.md or the agent's role?
- Would this particular agent (not just any agent) realistically use this tool?
- Remove any skill that is generic/universal but not tied to what this agent actually does

---

## Output format

Respond with ONLY valid JSON. No markdown, no explanation outside the JSON.

{
  "summary": "1–2 sentences: what gap exists and why these tools close it",
  "skills": [
    {
      "name": "exact name from catalog or well-known tool name",
      "type": "skill | mcp",
      "source": "skillsh | smithery | skillsmp | github",
      "url": "direct URL to the skill/server page",
      "install": "install command exactly as in catalog, or null if unknown",
      "reason": "one specific reason tied to this agent's role and project"
    }
  ]
}
