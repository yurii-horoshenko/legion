"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

module.exports = function createProjectRoutes(ctx) {
  const { io, http, agentFs, exec } = ctx;
  const { agentsDir } = io;

  return async function handle(urlPath, method, req, res, body) {
    // Landing page
    if (urlPath === "/home" && method === "GET") {
      const f = path.join(ctx.webRoot, "landing.html");
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        res.end(data);
      });
      return true;
    }

    // Folder picker (native OS dialog)
    if (urlPath === "/api/pick-folder" && method === "GET") {
      const cmds = {
        darwin: `osascript -e 'POSIX path of (choose folder with prompt "Select project folder")'`,
        linux:  `zenity --file-selection --directory --title="Select project folder" 2>/dev/null`,
        win32:  `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.ShowDialog()|Out-Null; $d.SelectedPath"`,
      };
      const cmd = cmds[process.platform];
      if (!cmd) { http.json(res, 400, { error: "Unsupported platform" }); return true; }
      try {
        const folderPath = await new Promise((resolve, reject) => {
          exec(cmd, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim().replace(/\/$/, ""));
          });
        });
        http.json(res, 200, { path: folderPath });
      } catch {
        http.json(res, 200, { path: null });
      }
      return true;
    }

    // GET /api/projects
    if (urlPath === "/api/projects" && method === "GET") {
      http.json(res, 200, io.readProjects());
      return true;
    }

    // POST /api/projects
    if (urlPath === "/api/projects" && method === "POST") {
      const projects = io.readProjects();
      const project  = { ...body, id: body.id || crypto.randomUUID() };
      const exists   = projects.findIndex(p => p.id === project.id);
      if (exists >= 0) projects[exists] = project; else projects.push(project);
      io.writeProjects(projects);
      if (project.path) agentFs.initLegionFolder(project);
      http.json(res, 200, project);
      return true;
    }

    // PATCH /api/projects/:id
    if (urlPath.match(/^\/api\/projects\/[^/]+$/) && method === "PATCH") {
      const id       = urlPath.slice("/api/projects/".length);
      const projects = io.readProjects();
      const idx      = projects.findIndex(p => p.id === id);
      if (idx < 0) { http.json(res, 404, { error: "Not found" }); return true; }
      projects[idx]  = { ...projects[idx], ...body, id };
      io.writeProjects(projects);
      if (projects[idx].path) agentFs.initLegionFolder(projects[idx]);
      http.json(res, 200, projects[idx]);
      return true;
    }

    // DELETE /api/projects/:id/legion
    if (urlPath.startsWith("/api/projects/") && urlPath.endsWith("/legion") && method === "DELETE") {
      const id      = urlPath.slice("/api/projects/".length, -"/legion".length);
      const project = io.readProjects().find(p => p.id === id);
      if (project?.path) {
        const legionDir = path.join(project.path, ".legion");
        try { fs.rmSync(legionDir, { recursive: true, force: true }); } catch {}
      }
      http.json(res, 200, { ok: true });
      return true;
    }

    // DELETE /api/projects/:id  (must be after /legion)
    if (urlPath.startsWith("/api/projects/") && method === "DELETE" &&
        !urlPath.includes("/agents") && !urlPath.endsWith("/legion")) {
      const id       = urlPath.slice("/api/projects/".length);
      const projects = io.readProjects();
      const project  = projects.find(p => p.id === id);
      io.writeProjects(projects.filter(p => p.id !== id));
      // Remove project agent config
      try { fs.rmSync(path.join(agentsDir, `${id}.json`), { force: true }); } catch {}
      if (project?.path) {
        const legionDir = path.join(project.path, ".legion");
        try { fs.rmSync(legionDir, { recursive: true, force: true }); } catch {}
      }
      http.json(res, 200, { ok: true });
      return true;
    }

    return false;
  };
};
