"use strict";

module.exports = function createLinearRoutes(ctx) {
  const { io, http, ai } = ctx;

  return async function handle(urlPath, method, req, res, body) {

    // GET /api/projects/:pid/integrations
    if (urlPath.match(/^\/api\/projects\/[^/]+\/integrations$/) && method === "GET") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      http.json(res, 200, io.readIntegrations(project));
      return true;
    }

    // PUT /api/projects/:pid/integrations
    if (urlPath.match(/^\/api\/projects\/[^/]+\/integrations$/) && method === "PUT") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      io.writeIntegrations(project, body);
      http.json(res, 200, body);
      return true;
    }

    // GET /api/projects/:pid/linear/teams
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/teams$/) && method === "GET") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const integ  = io.readIntegrations(project);
      const apiKey = integ.linear?.apiKey;
      if (!apiKey) { http.json(res, 400, { error: "Linear API key not configured" }); return true; }
      try {
        const result = await io.linearQuery(apiKey, `{ teams { nodes { id name key } } }`);
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message || "Linear error" }); return true; }
        http.json(res, 200, result.data?.teams?.nodes || []);
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // GET /api/projects/:pid/linear/issues?teamId=&limit=&labelName=
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/issues$/) && method === "GET") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const integ     = io.readIntegrations(project);
      const apiKey    = integ.linear?.apiKey;
      if (!apiKey) { http.json(res, 400, { error: "Linear API key not configured" }); return true; }
      const qs        = Object.fromEntries(new URL("http://l" + req.url).searchParams);
      const teamId    = qs.teamId    || integ.linear?.defaultTeamId || null;
      const labelName = qs.labelName || null;
      const first     = Math.min(parseInt(qs.limit || "50"), 250);
      try {
        // Build dynamic filter
        const filterParts = [];
        const vars = { first };
        if (teamId)    { filterParts.push("team:{id:{eq:$teamId}}");              vars.teamId    = teamId; }
        if (labelName) { filterParts.push("labels:{some:{name:{eq:$labelName}}}"); vars.labelName = labelName; }
        const filterStr = filterParts.length ? `filter:{${filterParts.join(",")}}` : "";
        const typeDef   = [teamId ? "$teamId:ID" : "", labelName ? "$labelName:String" : "", "$first:Int"].filter(Boolean).join(",");
        const q = `query(${typeDef}){issues(${filterStr},first:$first,orderBy:updatedAt){nodes{id identifier title description state{id name color type}priority priorityLabel assignee{id name}labels{nodes{id name color}}team{id name key}url createdAt updatedAt}}}`;
        const result = await io.linearQuery(apiKey, q, vars);
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message || "Linear error" }); return true; }
        http.json(res, 200, result.data?.issues?.nodes || []);
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // GET /api/projects/:pid/linear/labels?teamId=
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/labels$/) && method === "GET") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const integ  = io.readIntegrations(project);
      const apiKey = integ.linear?.apiKey;
      if (!apiKey) { http.json(res, 400, { error: "Linear API key not configured" }); return true; }
      const qs     = Object.fromEntries(new URL("http://l" + req.url).searchParams);
      const teamId = qs.teamId || integ.linear?.defaultTeamId;
      try {
        const q = teamId
          ? `{ team(id:"${teamId}") { labels { nodes { id name color } } } }`
          : `{ teams { nodes { labels { nodes { id name color } } } } }`;
        const result = await io.linearQuery(apiKey, q);
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message }); return true; }
        const labels = teamId
          ? (result.data?.team?.labels?.nodes || [])
          : (result.data?.teams?.nodes?.flatMap(t => t.labels?.nodes || []) || []);
        http.json(res, 200, labels);
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // POST /api/projects/:pid/linear/labels — create a label in Linear
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/labels$/) && method === "POST") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const integ  = io.readIntegrations(project);
      const apiKey = integ.linear?.apiKey;
      if (!apiKey) { http.json(res, 400, { error: "Linear API key not configured" }); return true; }
      const { name, color, teamId } = body;
      if (!name || !teamId) { http.json(res, 400, { error: "name and teamId required" }); return true; }
      try {
        const q = `mutation($name:String!,$color:String!,$teamId:String!){issueLabelCreate(input:{name:$name,color:$color,teamId:$teamId}){issueLabel{id name color}success}}`;
        const result = await io.linearQuery(apiKey, q, { name, color: color || "#94A3B8", teamId });
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message }); return true; }
        if (!result.data?.issueLabelCreate?.success) { http.json(res, 400, { error: "Label creation failed" }); return true; }
        const label = result.data.issueLabelCreate.issueLabel;
        // Persist agentLabels mapping in integrations.json
        const newInteg = { ...integ };
        if (!newInteg.agentLabels) newInteg.agentLabels = [];
        if (body.agentId) {
          newInteg.agentLabels = newInteg.agentLabels.filter(x => x.agentId !== body.agentId);
          newInteg.agentLabels.push({ agentId: body.agentId, labelId: label.id, labelName: label.name });
          io.writeIntegrations(project, newInteg);
        }
        http.json(res, 200, label);
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // PATCH /api/projects/:pid/linear/issues/:iid/labels — set labels on an issue
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/issues\/[^/]+\/labels$/) && method === "PATCH") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const integ  = io.readIntegrations(project);
      const apiKey = integ.linear?.apiKey;
      if (!apiKey) { http.json(res, 400, { error: "Linear API key not configured" }); return true; }
      const issueId = parts[7];
      const { labelIds } = body;
      if (!Array.isArray(labelIds)) { http.json(res, 400, { error: "labelIds array required" }); return true; }
      try {
        const q = `mutation($id:String!,$labelIds:[String!]!){issueUpdate(id:$id,input:{labelIds:$labelIds}){success}}`;
        const result = await io.linearQuery(apiKey, q, { id: issueId, labelIds });
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message }); return true; }
        http.json(res, 200, { ok: !!result.data?.issueUpdate?.success });
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // POST /api/projects/:pid/linear/auto-assign (SSE) — AI bulk assignment suggestions
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/auto-assign$/) && method === "POST") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      let aborted = false;
      req.on("close", () => { aborted = true; });
      const send  = (type, payload) => { if (!aborted) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); };
      const prog  = (msg)    => { send("progress", { message: msg }); };
      const done  = (result) => { send("done", { result }); res.end(); };
      const fail  = (err)    => { send("error", { message: err }); res.end(); };

      try {
        if (!project?.path) return fail("Project not found");
        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");
        const models    = io.readModels();
        const providers = io.readProviders();
        const model     = models.find(m => m.id === cfg.defaultModelId);
        if (!model)    return fail("Default model not found");
        const provider  = providers.find(p => p.id === model.providerId);
        if (!provider) return fail("Provider not found");

        const issues = body.issues || [];
        const agents = (io.readPAgents()[parts[3]] || [])
          .map(a => ({ id: a.id, name: a.name, labelName: a.linearLabelName || a.name, role: a.role || a.description || a.group || "" }));

        if (!issues.length) return fail("No issues provided");
        if (!agents.length) return fail("No agents in this project");

        prog(`Analyzing ${issues.length} issues across ${agents.length} agents…`);

        const issueList = issues.slice(0, 100).map((i, idx) =>
          `${idx + 1}. id:"${i.id}" | ${i.identifier || ""} | ${i.title || "Untitled"} | ${(i.description || "").slice(0, 120)}`
        ).join("\n");
        const agentList = agents.map(a =>
          `- id:"${a.id}" | name:${a.name} | label:"${a.labelName}" | role:${a.role || "—"}`
        ).join("\n");

        const prompt = [
          `You are assigning Linear project issues to AI agents based on their roles and issue content.`,
          ``,
          `# Agents`,
          agentList,
          ``,
          `# Issues to assign`,
          issueList,
          ``,
          `# Instructions`,
          `Assign each issue to the most appropriate agent based on the issue content and agent roles.`,
          `Return ONLY valid JSON:`,
          `{`,
          `  "assignments": [`,
          `    { "issueId": "issue-id", "agentId": "agent-id", "agentName": "name", "reason": "one sentence" }`,
          `  ]`,
          `}`,
        ].join("\n");

        if (aborted) return;
        prog("Calling AI…");
        const raw = await ai.callAI(model, provider, prompt);
        if (aborted) return;

        prog("Parsing assignments…");
        const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
        const jsonStr  = stripped.startsWith("{") ? stripped : (stripped.match(/\{[\s\S]*\}/)?.[0] || "");
        if (!jsonStr) return fail("AI returned invalid response");
        const plan = JSON.parse(jsonStr);

        prog(`Done — ${(plan.assignments || []).length} assignments suggested`);
        done(plan);
      } catch (e) {
        console.error("[auto-assign]", e.message);
        fail("Auto-assign failed: " + e.message);
      }
      return true;
    }

    return false;
  };
};
