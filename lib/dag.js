"use strict";

// Subtask DAG validation. Ported in design from Sloppy's SwarmPlanner +
// SwarmCoordinator.hasCycle (3-color DFS) and ruflo task-orchestrator's
// wouldCreateCycle: the LLM proposes subtasks with dependencyIds, and the CODE
// validates the graph (dependency existence, dedup, acyclicity, depth bound)
// and computes parallel execution waves — instead of trusting the model or
// running a blind flat fan-out.
//
// tasks: [{ id, agentId, task, dependencyIds?: string[] }]
// returns: { ok, errors, hasDeps, waves: string[][] }  (waves ordered: deps first)

function validate(tasks, { maxDepth = 6 } = {}) {
  const errors = [];
  const ids = tasks.map(t => t.id);
  const idSet = new Set(ids);

  if (idSet.size !== ids.length) errors.push("duplicate task ids");

  let hasDeps = false;
  const deps = new Map(); // id -> [depId]
  for (const t of tasks) {
    const d = (t.dependencyIds || []).filter(Boolean);
    if (d.length) hasDeps = true;
    for (const dep of d) {
      if (!idSet.has(dep)) errors.push(`task '${t.id}' depends on unknown '${dep}'`);
      if (dep === t.id)    errors.push(`task '${t.id}' depends on itself`);
    }
    deps.set(t.id, d.filter(x => idSet.has(x)));
  }

  // 3-color DFS cycle detection (white=0, gray=1, black=2).
  const color = new Map(ids.map(id => [id, 0]));
  let cyclic = false;
  function dfs(id) {
    color.set(id, 1);
    for (const dep of deps.get(id) || []) {
      const c = color.get(dep);
      if (c === 1) { cyclic = true; return; }
      if (c === 0) { dfs(dep); if (cyclic) return; }
    }
    color.set(id, 2);
  }
  for (const id of ids) { if (color.get(id) === 0) dfs(id); if (cyclic) break; }
  if (cyclic) errors.push("dependency cycle detected");

  if (errors.length) return { ok: false, errors, hasDeps, waves: [] };

  // Layer into waves: level(node) = 0 if no deps, else 1 + max(level(dep)).
  const level = new Map();
  function lvl(id) {
    if (level.has(id)) return level.get(id);
    const ds = deps.get(id) || [];
    const v = ds.length ? 1 + Math.max(...ds.map(lvl)) : 0;
    level.set(id, v);
    return v;
  }
  const waves = [];
  for (const id of ids) {
    const v = lvl(id);
    (waves[v] = waves[v] || []).push(id);
  }
  const compact = waves.filter(Boolean);

  if (compact.length - 1 > maxDepth) {
    return { ok: false, errors: [`dependency depth ${compact.length - 1} exceeds max ${maxDepth}`], hasDeps, waves: [] };
  }
  return { ok: true, errors: [], hasDeps, waves: compact };
}

module.exports = { validate };
