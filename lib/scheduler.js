"use strict";

const cron = require("./cron");
const log  = require("./log");

// Cron scheduler: every minute, scan each agent's `cron` store and fire jobs
// whose schedule matches now. Activates the previously inert cron UI. Jobs run
// through the headless runner. Dedup keyed by job + minute so a job fires once
// per matching minute even if the tick is slightly off.

module.exports = function createScheduler({ io, db, runner }) {
  let timer = null;
  const lastRun = new Map(); // jobKey -> minuteKey

  async function runJob(project, agent, job) {
    log.info("scheduler", `cron fire ${agent.name}: "${job.command.slice(0, 60)}" (${job.schedule})`);
    db.log("cron:fire", project.id, agent.id, { jobId: job.id, schedule: job.schedule, command: job.command.slice(0, 120) });
    try {
      const reply = await runner.run(project.id, agent, job.command);
      db.log("cron:done", project.id, agent.id, { jobId: job.id, preview: (reply || "").slice(0, 120) });
    } catch (e) {
      db.log("cron:error", project.id, agent.id, { jobId: job.id, error: e.message });
      log.warn("scheduler", `cron job failed (${agent.name}): ${e.message}`);
    }
  }

  function tick(now = new Date()) {
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    let fired = 0;
    try {
      for (const project of io.readProjects()) {
        const agents = io.readPAgents()[project.id] || [];
        for (const agent of agents) {
          const jobs = db.storeGet(project.id, agent.id, "cron") || [];
          for (const job of jobs) {
            if (!job.enabled || !job.schedule || !job.command) continue;
            if (!cron.isValid(job.schedule) || !cron.matches(job.schedule, now)) continue;
            const jobKey = `${project.id}:${agent.id}:${job.id}`;
            if (lastRun.get(jobKey) === minuteKey) continue;
            lastRun.set(jobKey, minuteKey);
            runJob(project, agent, job).catch(() => {});
            fired++;
          }
        }
      }
    } catch (e) {
      log.warn("scheduler", `tick error — ${e.message}`);
    }
    return fired;
  }

  function start({ intervalMs = 60_000 } = {}) {
    if (timer) return;
    timer = setInterval(() => tick(), intervalMs);
    if (timer.unref) timer.unref();
    log.info("scheduler", "cron scheduler started (60s tick)");
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stop, tick };
};
