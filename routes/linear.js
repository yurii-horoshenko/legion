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

    // GET /api/projects/:pid/linear/states?teamId= — workflow states for a team
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/states$/) && method === "GET") {
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
          ? `{ team(id:"${teamId}") { states { nodes { id name color type } } } }`
          : `{ teams { nodes { states { nodes { id name color type } } } } }`;
        const result = await io.linearQuery(apiKey, q);
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message }); return true; }
        const states = teamId
          ? (result.data?.team?.states?.nodes || [])
          : (result.data?.teams?.nodes?.flatMap(t => t.states?.nodes || []) || []);
        http.json(res, 200, states);
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // PATCH /api/projects/:pid/linear/issues/:iid — update status (and optionally title/description)
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/issues\/[^/]+$/) && method === "PATCH") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);
      if (!project?.path) { http.json(res, 404, { error: "Project not found" }); return true; }
      const integ  = io.readIntegrations(project);
      const apiKey = integ.linear?.apiKey;
      if (!apiKey) { http.json(res, 400, { error: "Linear API key not configured" }); return true; }
      const issueId = parts[6];
      const { stateId, stateName, title, description } = body;

      try {
        let resolvedStateId = stateId;

        // Resolve state by name if stateId not given directly
        if (!resolvedStateId && stateName) {
          const teamId = integ.linear?.defaultTeamId;
          const sq = teamId
            ? `{ team(id:"${teamId}") { states { nodes { id name } } } }`
            : `{ teams { nodes { states { nodes { id name } } } } }`;
          const sr = await io.linearQuery(apiKey, sq);
          const states = teamId
            ? (sr.data?.team?.states?.nodes || [])
            : (sr.data?.teams?.nodes?.flatMap(t => t.states?.nodes || []) || []);
          const match = states.find(s => s.name.toLowerCase() === stateName.toLowerCase());
          if (!match) { http.json(res, 400, { error: `State "${stateName}" not found` }); return true; }
          resolvedStateId = match.id;
        }

        const input = {};
        if (resolvedStateId) input.stateId = resolvedStateId;
        if (title !== undefined) input.title = title;
        if (description !== undefined) input.description = description;
        if (!Object.keys(input).length) { http.json(res, 400, { error: "Nothing to update" }); return true; }

        const q = `mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{id identifier state{id name}}}}`;
        const result = await io.linearQuery(apiKey, q, { id: issueId, input });
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message || JSON.stringify(result.errors) }); return true; }
        if (!result.data?.issueUpdate?.success) { http.json(res, 400, { error: "issueUpdate returned success:false" }); return true; }
        http.json(res, 200, { ok: true, issue: result.data.issueUpdate.issue });
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
      const issueId = parts[6];
      const { labelIds } = body;
      if (!Array.isArray(labelIds)) { http.json(res, 400, { error: "labelIds array required" }); return true; }
      try {
        const q = `mutation($id:String!,$labelIds:[String!]!){issueUpdate(id:$id,input:{labelIds:$labelIds}){success issue{id identifier}}}`;
        const result = await io.linearQuery(apiKey, q, { id: issueId, labelIds });
        console.log("[linear patch]", issueId, JSON.stringify(result).slice(0, 300));
        if (result.errors) { http.json(res, 400, { error: result.errors[0]?.message || JSON.stringify(result.errors) }); return true; }
        const success = !!result.data?.issueUpdate?.success;
        if (!success) { http.json(res, 400, { error: `Linear returned success:false for issue ${issueId}` }); return true; }
        http.json(res, 200, { ok: true });
      } catch (e) { http.json(res, 500, { error: e.message }); }
      return true;
    }

    // POST /api/projects/:pid/linear/auto-assign (SSE) — AI bulk assignment suggestions
    if (urlPath.match(/^\/api\/projects\/[^/]+\/linear\/auto-assign$/) && method === "POST") {
      const parts   = urlPath.split("/");
      const project = io.readProjects().find(p => p.id === parts[3]);

      const { send, progress: prog, done, fail } = http.createSSEHandler(res, req, "auto-assign");

      try {
        if (!project?.path) return fail("Project not found");
        const cfg = io.readConfig();
        if (!cfg.defaultModelId) return fail("No default model configured in Settings → General");
        const resolved = http.resolveModel(io.readModels(), io.readProviders(), cfg.defaultModelId);
        if (!resolved) return fail("Default model not found or provider not configured");
        const { model, provider } = resolved;

        const issues = (body.issues || []).slice(0, 100);
        const agents = (io.readPAgents()[parts[3]] || [])
          .map(a => ({ id: a.id, name: a.name, labelName: a.linearLabelName || a.name, role: a.role || a.description || a.group || "" }));

        if (!issues.length) return fail("No issues provided");
        if (!agents.length) return fail("No agents in this project");

        const agentList = agents.map(a =>
          `- id:"${a.id}" | name:${a.name} | role:${a.role || "—"}`
        ).join("\n");

        const sysPrompt = [
          `You are assigning Linear issues to the most appropriate agents based on their roles.`,
          ``,
          `# Agents`,
          agentList,
          ``,
          `Return ONLY a valid JSON array (no markdown, no explanation):`,
          `[{"issueId":"...","agentId":"...","agentName":"...","reason":"one sentence"},...]`,
          `Include every issue in the batch. If no agent fits well, pick the closest match.`,
        ].join("\n");

        const BATCH_SIZE = 10;
        const batches = [];
        for (let i = 0; i < issues.length; i += BATCH_SIZE) batches.push(issues.slice(i, i + BATCH_SIZE));

        prog(`Starting — ${issues.length} issues, ${batches.length} batches of ${BATCH_SIZE}`);

        let assigned = 0;
        const assignedIds = new Set();

        for (let bIdx = 0; bIdx < batches.length; bIdx++) {
          const batch = batches[bIdx];
          prog(`Batch ${bIdx + 1} / ${batches.length} — processing ${batch.length} issues…`);

          const issueList = batch.map((iss, i) =>
            `${i + 1}. id:"${iss.id}" | ${iss.identifier || ""}: ${iss.title || "Untitled"} — ${(iss.description || "").slice(0, 150)}`
          ).join("\n");

          try {
            const raw  = await ai.callAIMessages(model, provider, sysPrompt, [{ role: "user", content: issueList }]);
            const list = (() => { const r = http.parseAIJson(raw); return Array.isArray(r) ? r : (r.assignments || []); })();

            for (const item of list) {
              if (!item.issueId || !item.agentId) continue;
              send("assignment", { issueId: item.issueId, agentId: item.agentId, agentName: item.agentName || "", reason: item.reason || "" });
              assignedIds.add(item.issueId);
              assigned++;
            }
            prog(`Batch ${bIdx + 1} / ${batches.length} done — ${assigned} assigned so far`);
          } catch (e) {
            prog(`Batch ${bIdx + 1} failed: ${e.message}`);
            for (const iss of batch) send("assignment-error", { issueId: iss.id, message: "Batch failed" });
          }
        }

        for (const iss of issues) {
          if (!assignedIds.has(iss.id)) send("assignment-error", { issueId: iss.id, message: "Not assigned" });
        }

        prog(`Done — ${assigned}/${issues.length} assigned`);
        done({ assigned, total: issues.length });
      } catch (e) {
        console.error("[auto-assign]", e.message);
        fail("Auto-assign failed: " + e.message);
      }
      return true;
    }

    return false;
  };
};
