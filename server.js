const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, hashPassword, verifyPassword, seedIfEmpty } = require('./db');

if (process.env.SEED_DEMO !== 'false') seedIfEmpty();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 14;
const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
const PRIORITIES = ['Low', 'Medium', 'High'];

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const daysAgoIso = (n) => new Date(Date.now() - n * 86400000).toISOString();

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

// Everyone who reports to userId, directly or indirectly.
const teamStmt = db.prepare(`
  WITH RECURSIVE team(id) AS (
    SELECT id FROM users WHERE manager_id = ?
    UNION
    SELECT u.id FROM users u JOIN team t ON u.manager_id = t.id
  ) SELECT id FROM team`);
const teamIds = (userId) => teamStmt.all(userId).map((r) => r.id);
const manages = (viewerId, targetId) => teamIds(viewerId).includes(Number(targetId));
const canSee = (viewerId, targetId) => Number(targetId) === viewerId || manages(viewerId, targetId);

const statsStmt = db.prepare(`
  SELECT
    COALESCE(SUM(status != 'Done'), 0) AS open_tasks,
    COALESCE(SUM(CASE WHEN status != 'Done' THEN est_hours END), 0) AS open_hours,
    COALESCE(SUM(status != 'Done' AND due_date IS NOT NULL AND due_date < @today), 0) AS overdue,
    COALESCE(SUM(status = 'Blocked'), 0) AS blocked,
    COALESCE(SUM(status = 'Done' AND completed_at >= @since7), 0) AS done_7,
    COALESCE(SUM(status = 'Done' AND completed_at >= @since90), 0) AS done_90,
    COALESCE(SUM(status = 'Done' AND completed_at >= @since90 AND due_date IS NOT NULL), 0) AS done_90_dated,
    COALESCE(SUM(status = 'Done' AND completed_at >= @since90 AND due_date IS NOT NULL
                 AND substr(completed_at, 1, 10) <= due_date), 0) AS on_time_90,
    AVG(CASE WHEN status = 'Done' AND completed_at >= @since90
             THEN julianday(completed_at) - julianday(created_at) END) AS avg_days,
    MAX(updated_at) AS last_activity
  FROM tasks WHERE assignee_id = @id`);

function statsFor(userId) {
  const s = statsStmt.get({ id: userId, today: today(), since7: daysAgoIso(7), since90: daysAgoIso(90) });
  const onTimePct = s.done_90_dated ? Math.round((s.on_time_90 / s.done_90_dated) * 100) : null;
  const flags = [];
  if (s.overdue >= 2) flags.push('Overdue work');
  if (s.blocked > 0) flags.push('Blocked');
  if (onTimePct !== null && onTimePct < 70) flags.push('Missing deadlines');
  if (s.open_hours > 40) flags.push('Heavy load');
  if (s.open_tasks > 0 && (!s.last_activity || s.last_activity < daysAgoIso(7))) flags.push('No recent activity');
  return {
    open_tasks: s.open_tasks,
    open_hours: Math.round(s.open_hours * 10) / 10,
    overdue: s.overdue,
    blocked: s.blocked,
    done_7: s.done_7,
    done_90: s.done_90,
    on_time_pct: onTimePct,
    avg_days: s.avg_days === null ? null : Math.round(s.avg_days * 10) / 10,
    last_activity: s.last_activity,
    flags,
    health: flags.length ? 'Needs attention' : 'On track',
  };
}

const userCols = 'u.id, u.name, u.email, u.title, u.manager_id, m.name AS manager_name';
const getUser = db.prepare(`SELECT ${userCols} FROM users u LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = ?`);

const taskSelect = `
  SELECT t.*, a.name AS assignee_name, b.name AS assigned_by_name, p.name AS project_name
  FROM tasks t
  JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users b ON b.id = t.assigned_by
  LEFT JOIN projects p ON p.id = t.project_id`;
const taskOrder = `ORDER BY (t.status = 'Done'), t.due_date IS NULL, t.due_date, t.id DESC`;

function validDate(d) {
  return d === null || d === undefined || d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// ---------- auth ----------
function auth(req, res, next) {
  const token = parseCookies(req).sid;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const row = db
    .prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?')
    .get(token, nowIso());
  if (!row) return res.status(401).json({ error: 'Session expired' });
  req.user = getUser.get(row.user_id);
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(String(email || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);
  setSessionCookie(res, token, SESSION_DAYS * 86400);
  res.json(getUser.get(user.id));
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(res, '', 0);
  res.status(204).end();
});

app.use('/api', auth);

app.get('/api/me', (req, res) => {
  res.json({ ...req.user, has_team: teamIds(req.user.id).length > 0 });
});

app.post('/api/me/password', (req, res) => {
  const { current, next: nextPw } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(current || ''), row.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!nextPw || String(nextPw).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(nextPw)), req.user.id);
  res.status(204).end();
});

// ---------- people ----------
app.get('/api/team', (req, res) => {
  const ids = teamIds(req.user.id);
  const people = ids.map((id) => ({ ...getUser.get(id), stats: statsFor(id) }));
  people.sort((a, b) => (b.stats.flags.length - a.stats.flags.length) || a.name.localeCompare(b.name));
  res.json(people);
});

app.get('/api/assignable', (req, res) => {
  const ids = [req.user.id, ...teamIds(req.user.id)];
  res.json(ids.map((id) => getUser.get(id)));
});

app.get('/api/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!canSee(req.user.id, id)) return res.status(403).json({ error: 'Not on your team' });
  const user = getUser.get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const tasks = db.prepare(`${taskSelect} WHERE t.assignee_id = ? ${taskOrder}`).all(id);
  const reports = db.prepare('SELECT id, name, title FROM users WHERE manager_id = ? ORDER BY name').all(id);
  res.json({ ...user, stats: statsFor(id), tasks, reports });
});

app.post('/api/users', (req, res) => {
  const { name, email, title, password, manager_id } = req.body || {};
  const managerId = Number(manager_id || req.user.id);
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Temporary password must be at least 8 characters' });
  if (!canSee(req.user.id, managerId)) return res.status(403).json({ error: 'You can only add people under yourself or your team' });
  try {
    const info = db
      .prepare('INSERT INTO users (name, email, title, manager_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(String(name).trim(), String(email).trim(), title || null, managerId, hashPassword(String(password)), nowIso());
    res.status(201).json(getUser.get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'That email is already in use' });
    throw e;
  }
});

// Move someone to a different manager (both must be inside your team).
app.patch('/api/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!manages(req.user.id, id)) return res.status(403).json({ error: 'Not on your team' });
  const { title, manager_id } = req.body || {};
  if (manager_id !== undefined) {
    const m = Number(manager_id);
    if (!canSee(req.user.id, m)) return res.status(403).json({ error: 'New manager must be you or on your team' });
    if (m === id || manages(id, m)) return res.status(400).json({ error: 'That would create a reporting loop' });
    db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(m, id);
  }
  if (title !== undefined) db.prepare('UPDATE users SET title = ? WHERE id = ?').run(title || null, id);
  res.json(getUser.get(id));
});

// ---------- projects ----------
const projectSelect = `
  SELECT p.*, o.name AS owner_name,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'Done') AS done_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'Done'
       AND t.due_date IS NOT NULL AND t.due_date < @today) AS overdue_count
  FROM projects p LEFT JOIN users o ON o.id = p.owner_id`;

app.get('/api/projects', (req, res) => {
  res.json(db.prepare(`${projectSelect} ORDER BY p.status = 'Complete', p.due_date IS NULL, p.due_date`).all({ today: today() }));
});

app.post('/api/projects', (req, res) => {
  const { name, description, owner_id, due_date } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  if (!validDate(due_date)) return res.status(400).json({ error: 'Bad date' });
  const owner = Number(owner_id || req.user.id);
  if (!canSee(req.user.id, owner)) return res.status(403).json({ error: 'Owner must be you or on your team' });
  const info = db
    .prepare('INSERT INTO projects (name, description, owner_id, due_date, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).trim(), description || null, owner, due_date || null, nowIso());
  res.status(201).json(db.prepare(`${projectSelect} WHERE p.id = @id`).get({ today: today(), id: info.lastInsertRowid }));
});

app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare(`${projectSelect} WHERE p.id = @id`).get({ today: today(), id: Number(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Not found' });
  const tasks = db.prepare(`${taskSelect} WHERE t.project_id = ? ${taskOrder}`).all(project.id);
  res.json({ ...project, tasks });
});

app.patch('/api/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!canSee(req.user.id, p.owner_id)) {
    return res.status(403).json({ error: 'Only the owner or their managers can edit this project' });
  }
  const { status, due_date, description, name } = req.body || {};
  if (!validDate(due_date)) return res.status(400).json({ error: 'Bad date' });
  db.prepare(`UPDATE projects SET
      name = COALESCE(?, name), description = COALESCE(?, description),
      status = COALESCE(?, status), due_date = COALESCE(?, due_date) WHERE id = ?`)
    .run(name || null, description ?? null, status || null, due_date || null, p.id);
  res.json(db.prepare(`${projectSelect} WHERE p.id = @id`).get({ today: today(), id: p.id }));
});

// ---------- tasks ----------
app.get('/api/tasks', (req, res) => {
  const scope = req.query.scope === 'assigned' ? 'assigned' : 'mine';
  const where = scope === 'assigned' ? 't.assigned_by = ? AND t.assignee_id != t.assigned_by' : 't.assignee_id = ?';
  res.json(db.prepare(`${taskSelect} WHERE ${where} ${taskOrder}`).all(req.user.id));
});

app.post('/api/tasks', (req, res) => {
  const { title, notes, project_id, assignee_id, priority, due_date, est_hours } = req.body || {};
  const assignee = Number(assignee_id || req.user.id);
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  if (!canSee(req.user.id, assignee)) return res.status(403).json({ error: 'You can only assign to yourself or your team' });
  if (!validDate(due_date)) return res.status(400).json({ error: 'Bad date' });
  const pr = PRIORITIES.includes(priority) ? priority : 'Medium';
  const ts = nowIso();
  const info = db.prepare(`INSERT INTO tasks
      (title, notes, project_id, assignee_id, assigned_by, priority, due_date, est_hours, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(title).trim(), notes || null, project_id ? Number(project_id) : null, assignee, req.user.id,
      pr, due_date || null, Math.max(0, Number(est_hours) || 0), ts, ts);
  res.status(201).json(db.prepare(`${taskSelect} WHERE t.id = ?`).get(info.lastInsertRowid));
});

function taskAccess(user, task) {
  const isAssignee = task.assignee_id === user.id;
  const isManager = manages(user.id, task.assignee_id) || task.assigned_by === user.id;
  return { isAssignee, isManager, any: isAssignee || isManager };
}

app.patch('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  const access = taskAccess(req.user, task);
  if (!access.any) return res.status(403).json({ error: 'Not your task' });

  const b = req.body || {};
  const updates = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Bad status' });
    updates.status = b.status;
    updates.completed_at = b.status === 'Done' ? (task.status === 'Done' ? task.completed_at : nowIso()) : null;
  }
  if (b.notes !== undefined) updates.notes = b.notes || null;
  // Only managers / the assigner can change the assignment details.
  if (access.isManager) {
    if (b.title) updates.title = String(b.title).trim();
    if (b.priority && PRIORITIES.includes(b.priority)) updates.priority = b.priority;
    if (b.due_date !== undefined) {
      if (!validDate(b.due_date)) return res.status(400).json({ error: 'Bad date' });
      updates.due_date = b.due_date || null;
    }
    if (b.est_hours !== undefined) updates.est_hours = Math.max(0, Number(b.est_hours) || 0);
    if (b.project_id !== undefined) updates.project_id = b.project_id ? Number(b.project_id) : null;
    if (b.assignee_id !== undefined) {
      if (!canSee(req.user.id, Number(b.assignee_id))) return res.status(403).json({ error: 'Can only reassign within your team' });
      updates.assignee_id = Number(b.assignee_id);
    }
  }
  updates.updated_at = nowIso();
  const keys = Object.keys(updates);
  db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...updates, id: task.id });
  res.json(db.prepare(`${taskSelect} WHERE t.id = ?`).get(task.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (!taskAccess(req.user, task).isManager) return res.status(403).json({ error: 'Only the person who assigned it (or their manager) can delete it' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.status(204).end();
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => console.log(`Team Tracker running at http://localhost:${PORT}`));
