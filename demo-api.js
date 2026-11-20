// Demo backend for GitHub Pages.
// Pages can only host static files, so this file stands in for server.js:
// it answers the app's /api requests in the browser and saves data to
// localStorage. Each visitor gets their own copy of the demo data.
// For real multi-user use, run the Node server version instead.
(function () {
  const KEY = 'team-tracker-demo-v1';
  const DAY = 86400000;
  const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
  const PRIORITIES = ['Low', 'Medium', 'High'];
  const nowIso = () => new Date().toISOString();
  const today = () => nowIso().slice(0, 10);
  const daysAgoIso = (n) => new Date(Date.now() - n * DAY).toISOString();

  function seed() {
    const now = Date.now();
    const iso = (d) => new Date(now + d * DAY).toISOString();
    const date = (d) => iso(d).slice(0, 10);
    const pw = 'demo1234';
    const users = [
      { id: 1, name: 'Alex Rivera', email: 'director@example.com', title: 'Director', manager_id: null, password: pw },
      { id: 2, name: 'Morgan Lee', email: 'manager@example.com', title: 'Associate Director', manager_id: 1, password: pw },
      { id: 3, name: 'Sam Patel', email: 'sam@example.com', title: 'Coordinator', manager_id: 2, password: pw },
      { id: 4, name: 'Jordan Kim', email: 'jordan@example.com', title: 'Assistant', manager_id: 2, password: pw },
      { id: 5, name: 'Taylor Brooks', email: 'taylor@example.com', title: 'Assistant', manager_id: 1, password: pw },
    ];
    const projects = [
      { id: 1, name: 'Year-End Campaign', description: 'December giving push across all channels', owner_id: 2, due_date: date(40), status: 'Active', created_at: iso(-45) },
      { id: 2, name: 'Donor Event Series', description: 'Spring hospitality and stewardship events', owner_id: 1, due_date: date(90), status: 'Active', created_at: iso(-30) },
      { id: 3, name: 'Database Cleanup', description: 'Fix duplicate and outdated contact records', owner_id: 2, due_date: date(20), status: 'Active', created_at: iso(-20) },
    ];
    const rows = [
      ['Draft campaign email #1', 1, 3, 2, 'High', 'Done', -20, 4, -30, -22, -22],
      ['Build donor segment lists', 1, 3, 2, 'High', 'Done', -12, 6, -25, -13, -13],
      ['Write social posts for Giving Tuesday', 1, 3, 2, 'Medium', 'In progress', 5, 3, -6, -1, null],
      ['Proof campaign mailer', 1, 3, 2, 'Medium', 'To do', 9, 2, -2, -2, null],
      ['Merge duplicate records (A-M)', 3, 4, 2, 'Medium', 'Done', -8, 5, -18, -5, -5],
      ['Merge duplicate records (N-Z)', 3, 4, 2, 'Medium', 'In progress', -3, 5, -10, -9, null],
      ['Update address change requests', 3, 4, 2, 'Low', 'To do', -1, 2, -12, -12, null],
      ['Pull lapsed donor report', 1, 4, 2, 'High', 'Done', -15, 3, -22, -14, -14],
      ['Venue quotes for spring event', 2, 5, 1, 'High', 'Done', -10, 4, -20, -11, -11],
      ['Draft event invite list', 2, 5, 1, 'Medium', 'In progress', 7, 6, -8, -2, null],
      ['Catering vendor comparison', 2, 5, 1, 'Low', 'To do', 14, 3, -3, -3, null],
      ['Approve campaign calendar', 1, 2, 1, 'High', 'Done', -28, 2, -40, -29, -29],
      ['Review cleanup progress', 3, 2, 1, 'Medium', 'To do', 3, 1, -4, -4, null],
      ['Thank-you call list', 1, 3, 2, 'Low', 'Done', -40, 2, -50, -38, -38],
    ];
    const tasks = rows.map((r, i) => ({
      id: i + 1, title: r[0], notes: null, project_id: r[1], assignee_id: r[2], assigned_by: r[3],
      priority: r[4], status: r[5], due_date: date(r[6]), est_hours: r[7],
      created_at: iso(r[8]), updated_at: iso(r[9]), completed_at: r[10] === null ? null : iso(r[10]),
    }));
    return { users, projects, tasks, nextId: { users: 6, projects: 4, tasks: tasks.length + 1 }, session: null };
  }

  let store;
  try { store = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { store = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
  save();

  // ---------- helpers mirroring server.js ----------
  const userById = (id) => store.users.find((u) => u.id === Number(id));
  const publicUser = (u) => {
    if (!u) return null;
    const m = u.manager_id ? userById(u.manager_id) : null;
    return { id: u.id, name: u.name, email: u.email, title: u.title, manager_id: u.manager_id, manager_name: m ? m.name : null };
  };
  function teamIds(id) {
    const out = [], q = [Number(id)], seen = new Set(q);
    while (q.length) {
      const cur = q.shift();
      for (const u of store.users) if (u.manager_id === cur && !seen.has(u.id)) { seen.add(u.id); out.push(u.id); q.push(u.id); }
    }
    return out;
  }
  const manages = (a, b) => teamIds(a).includes(Number(b));
  const canSee = (a, b) => Number(a) === Number(b) || manages(a, b);

  function statsFor(id) {
    const ts = store.tasks.filter((t) => t.assignee_id === id);
    const t0 = today(), s7 = daysAgoIso(7), s90 = daysAgoIso(90);
    const open = ts.filter((t) => t.status !== 'Done');
    const done90 = ts.filter((t) => t.status === 'Done' && t.completed_at >= s90);
    const dated = done90.filter((t) => t.due_date);
    const onTime = dated.filter((t) => t.completed_at.slice(0, 10) <= t.due_date).length;
    const s = {
      open_tasks: open.length,
      open_hours: Math.round(open.reduce((a, t) => a + (Number(t.est_hours) || 0), 0) * 10) / 10,
      overdue: open.filter((t) => t.due_date && t.due_date < t0).length,
      blocked: open.filter((t) => t.status === 'Blocked').length,
      done_7: ts.filter((t) => t.status === 'Done' && t.completed_at >= s7).length,
      done_90: done90.length,
      on_time_pct: dated.length ? Math.round((onTime / dated.length) * 100) : null,
      avg_days: done90.length ? Math.round((done90.reduce((a, t) => a + (Date.parse(t.completed_at) - Date.parse(t.created_at)) / DAY, 0) / done90.length) * 10) / 10 : null,
      last_activity: ts.reduce((a, t) => (t.updated_at > (a || '') ? t.updated_at : a), null),
    };
    s.flags = [];
    if (s.overdue >= 2) s.flags.push('Overdue work');
    if (s.blocked > 0) s.flags.push('Blocked');
    if (s.on_time_pct !== null && s.on_time_pct < 70) s.flags.push('Missing deadlines');
    if (s.open_hours > 40) s.flags.push('Heavy load');
    if (s.open_tasks > 0 && (!s.last_activity || s.last_activity < s7)) s.flags.push('No recent activity');
    s.health = s.flags.length ? 'Needs attention' : 'On track';
    return s;
  }

  function taskOut(t) {
    const a = userById(t.assignee_id), b = userById(t.assigned_by);
    const p = store.projects.find((x) => x.id === t.project_id);
    return { ...t, assignee_name: a ? a.name : '', assigned_by_name: b ? b.name : null, project_name: p ? p.name : null };
  }
  const sortTasks = (list) => list.sort((a, b) =>
    (a.status === 'Done') - (b.status === 'Done') || (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1) ||
    String(a.due_date).localeCompare(String(b.due_date)) || b.id - a.id);
  function projectOut(p) {
    const ts = store.tasks.filter((t) => t.project_id === p.id), o = userById(p.owner_id);
    return { ...p, owner_name: o ? o.name : null, task_count: ts.length,
      done_count: ts.filter((t) => t.status === 'Done').length,
      overdue_count: ts.filter((t) => t.status !== 'Done' && t.due_date && t.due_date < today()).length };
  }
  const validDate = (d) => d == null || d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d);

  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const fail = (status, msg) => { throw new HttpError(status, msg); };

  // ---------- routes ----------
  function handle(method, path, body) {
    const [route, query] = path.split('?');
    const parts = route.split('/').filter(Boolean); // e.g. ['users','3']
    const b = body || {};

    if (method === 'POST' && route === '/login') {
      const u = store.users.find((x) => x.email.toLowerCase() === String(b.email || '').trim().toLowerCase());
      if (!u || u.password !== String(b.password || '')) fail(401, 'Wrong email or password');
      store.session = u.id; save();
      return publicUser(u);
    }
    if (method === 'POST' && route === '/logout') { store.session = null; save(); return null; }

    const me = userById(store.session);
    if (!me) fail(401, 'Not signed in');
    const meId = me.id;

    if (method === 'GET' && route === '/me') return { ...publicUser(me), has_team: teamIds(meId).length > 0 };

    if (method === 'GET' && route === '/team') {
      return teamIds(meId).map((id) => ({ ...publicUser(userById(id)), stats: statsFor(id) }))
        .sort((x, y) => y.stats.flags.length - x.stats.flags.length || x.name.localeCompare(y.name));
    }
    if (method === 'GET' && route === '/assignable') return [meId, ...teamIds(meId)].map((id) => publicUser(userById(id)));

    if (parts[0] === 'users' && parts[1] && method === 'GET') {
      const id = Number(parts[1]);
      if (!canSee(meId, id)) fail(403, 'Not on your team');
      const u = userById(id); if (!u) fail(404, 'Not found');
      return { ...publicUser(u), stats: statsFor(id),
        tasks: sortTasks(store.tasks.filter((t) => t.assignee_id === id)).map(taskOut),
        reports: store.users.filter((x) => x.manager_id === id).map((x) => ({ id: x.id, name: x.name, title: x.title })) };
    }
    if (method === 'POST' && route === '/users') {
      const managerId = Number(b.manager_id || meId);
      if (!b.name || !b.email) fail(400, 'Name and email are required');
      if (!b.password || String(b.password).length < 8) fail(400, 'Temporary password must be at least 8 characters');
      if (!canSee(meId, managerId)) fail(403, 'You can only add people under yourself or your team');
      if (store.users.some((x) => x.email.toLowerCase() === String(b.email).trim().toLowerCase())) fail(400, 'That email is already in use');
      const u = { id: store.nextId.users++, name: String(b.name).trim(), email: String(b.email).trim(), title: b.title || null, manager_id: managerId, password: String(b.password) };
      store.users.push(u); save();
      return publicUser(u);
    }

    if (method === 'GET' && route === '/projects') {
      return store.projects.map(projectOut).sort((x, y) => (x.status === 'Complete') - (y.status === 'Complete') || String(x.due_date || '9').localeCompare(String(y.due_date || '9')));
    }
    if (method === 'POST' && route === '/projects') {
      if (!b.name) fail(400, 'Project name is required');
      if (!validDate(b.due_date)) fail(400, 'Bad date');
      const owner = Number(b.owner_id || meId);
      if (!canSee(meId, owner)) fail(403, 'Owner must be you or on your team');
      const p = { id: store.nextId.projects++, name: String(b.name).trim(), description: b.description || null, owner_id: owner, due_date: b.due_date || null, status: 'Active', created_at: nowIso() };
      store.projects.push(p); save();
      return projectOut(p);
    }
    if (parts[0] === 'projects' && parts[1]) {
      const p = store.projects.find((x) => x.id === Number(parts[1]));
      if (!p) fail(404, 'Not found');
      if (method === 'GET') return { ...projectOut(p), tasks: sortTasks(store.tasks.filter((t) => t.project_id === p.id)).map(taskOut) };
      if (method === 'PATCH') {
        if (!canSee(meId, p.owner_id)) fail(403, 'Only the owner or their managers can edit this project');
        if (b.status) p.status = b.status;
        if (b.name) p.name = b.name;
        if (b.description != null) p.description = b.description;
        if (b.due_date) { if (!validDate(b.due_date)) fail(400, 'Bad date'); p.due_date = b.due_date; }
        save(); return projectOut(p);
      }
    }

    if (method === 'GET' && route === '/tasks') {
      const assigned = /scope=assigned/.test(query || '');
      return sortTasks(store.tasks.filter((t) => assigned ? t.assigned_by === meId && t.assignee_id !== meId : t.assignee_id === meId)).map(taskOut);
    }
    if (method === 'POST' && route === '/tasks') {
      const assignee = Number(b.assignee_id || meId);
      if (!b.title) fail(400, 'Task title is required');
      if (!canSee(meId, assignee)) fail(403, 'You can only assign to yourself or your team');
      if (!validDate(b.due_date)) fail(400, 'Bad date');
      const ts = nowIso();
      const t = { id: store.nextId.tasks++, title: String(b.title).trim(), notes: b.notes || null,
        project_id: b.project_id ? Number(b.project_id) : null, assignee_id: assignee, assigned_by: meId,
        priority: PRIORITIES.includes(b.priority) ? b.priority : 'Medium', status: 'To do', due_date: b.due_date || null,
        est_hours: Math.max(0, Number(b.est_hours) || 0), created_at: ts, updated_at: ts, completed_at: null };
      store.tasks.push(t); save();
      return taskOut(t);
    }
    if (parts[0] === 'tasks' && parts[1]) {
      const t = store.tasks.find((x) => x.id === Number(parts[1]));
      if (!t) fail(404, 'Not found');
      const isAssignee = t.assignee_id === meId;
      const isManager = manages(meId, t.assignee_id) || t.assigned_by === meId;
      if (method === 'DELETE') {
        if (!isManager) fail(403, 'Only the person who assigned it (or their manager) can delete it');
        store.tasks = store.tasks.filter((x) => x !== t); save(); return null;
      }
      if (method === 'PATCH') {
        if (!isAssignee && !isManager) fail(403, 'Not your task');
        if (b.status !== undefined) {
          if (!STATUSES.includes(b.status)) fail(400, 'Bad status');
          t.completed_at = b.status === 'Done' ? (t.status === 'Done' ? t.completed_at : nowIso()) : null;
          t.status = b.status;
        }
        if (b.notes !== undefined) t.notes = b.notes || null;
        if (isManager) {
          if (b.title) t.title = String(b.title).trim();
          if (b.priority && PRIORITIES.includes(b.priority)) t.priority = b.priority;
          if (b.due_date !== undefined) { if (!validDate(b.due_date)) fail(400, 'Bad date'); t.due_date = b.due_date || null; }
          if (b.est_hours !== undefined) t.est_hours = Math.max(0, Number(b.est_hours) || 0);
          if (b.project_id !== undefined) t.project_id = b.project_id ? Number(b.project_id) : null;
          if (b.assignee_id !== undefined) {
            if (!canSee(meId, Number(b.assignee_id))) fail(403, 'Can only reassign within your team');
            t.assignee_id = Number(b.assignee_id);
          }
        }
        t.updated_at = nowIso(); save();
        return taskOut(t);
      }
    }
    fail(404, 'Not found');
  }

  // Route the app's fetch('/api/...') calls to the handler above.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    if (typeof url !== 'string' || !url.startsWith('/api')) return realFetch(url, opts);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    try {
      const out = handle(method, url.slice(4), body);
      return out === null
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return new Response(JSON.stringify({ error: e.message || 'Something went wrong' }), { status, headers: { 'Content-Type': 'application/json' } });
    }
  };

  // Let visitors start over.
  window.resetDemo = () => { localStorage.removeItem(KEY); location.reload(); };
})();
