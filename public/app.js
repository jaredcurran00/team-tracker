// Team Tracker front end: plain JS, no build step.
const $ = (s) => document.querySelector(s);
const view = $('#view');
const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
let me = null;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Signed out');
  }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- formatting ----------
const todayStr = () => new Date().toISOString().slice(0, 10);
function fmtDate(d) {
  if (!d) return '<span class="muted">None</span>';
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function ago(iso) {
  if (!iso) return '<span class="muted">Never</span>';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
const isOverdue = (t) => t.status !== 'Done' && t.due_date && t.due_date < todayStr();
const healthPill = (s) => `<span class="pill ${s.flags.length ? 'warn' : 'good'}">${esc(s.health)}</span>`;
const flagPills = (s) => s.flags.map((f) => `<span class="pill bad">${esc(f)}</span>`).join('');
const pct = (v) => (v === null || v === undefined ? '<span class="muted">n/a</span>' : `${v}%`);
const num = (v) => (v === null || v === undefined ? '<span class="muted">n/a</span>' : v);
function priorityPill(p) {
  const cls = p === 'High' ? 'bad' : p === 'Medium' ? 'neutral' : 'grey';
  return `<span class="pill ${cls}">${esc(p)}</span>`;
}
function statusSelect(t) {
  return `<select class="status" data-task="${t.id}">${STATUSES.map(
    (s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`
  ).join('')}</select>`;
}

// ---------- auth ----------
function showLogin() {
  me = null;
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
    $('#login-error').textContent = '';
    e.target.reset();
    await boot();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  location.hash = '';
  showLogin();
});

async function boot() {
  try {
    me = await api('/me');
  } catch {
    return;
  }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#me-name').textContent = me.name;
  $('#me-title').textContent = me.title || '';
  document.querySelectorAll('.team-only').forEach((el) => el.classList.toggle('hidden', !me.has_team));
  if (!location.hash) location.hash = me.has_team ? '#/team' : '#/mine';
  else route();
}

// ---------- router ----------
const routes = {
  team: renderTeam,
  person: renderPerson,
  mine: () => renderTaskList('mine'),
  assigned: () => renderTaskList('assigned'),
  projects: renderProjects,
  project: renderProject,
};

async function route() {
  if (!me) return;
  const [, name = 'mine', id] = location.hash.split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    await (routes[name] || routes.mine)(id);
  } catch (err) {
    if (err.message !== 'Signed out') view.innerHTML = `<div class="empty error">${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

// Status dropdowns anywhere in the view update instantly.
view.addEventListener('change', async (e) => {
  const sel = e.target.closest('select.status');
  if (!sel) return;
  try {
    await api(`/tasks/${sel.dataset.task}`, { method: 'PATCH', body: { status: sel.value } });
    toast(`Marked "${sel.value}"`);
    route();
  } catch (err) {
    toast(err.message);
  }
});
view.addEventListener('click', (e) => {
  if (e.target.closest('select, button, a')) return;
  const row = e.target.closest('[data-href]');
  if (row) location.hash = row.dataset.href;
});

// ---------- views ----------
async function renderTeam() {
  const people = await api('/team');
  const totals = people.reduce(
    (a, p) => {
      a.open += p.stats.open_tasks;
      a.overdue += p.stats.overdue;
      a.done7 += p.stats.done_7;
      if (p.stats.flags.length) a.attention += 1;
      return a;
    },
    { open: 0, overdue: 0, done7: 0, attention: 0 }
  );

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Team dashboard</h1><div class="muted">Everyone who reports to you, directly or through someone else.</div></div>
      <button class="btn" id="add-person">+ Add team member</button>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">People</div><div class="value">${people.length}</div></div>
      <div class="tile"><div class="label">Open tasks</div><div class="value">${totals.open}</div></div>
      <div class="tile ${totals.overdue ? 'bad' : ''}"><div class="label">Overdue</div><div class="value">${totals.overdue}</div></div>
      <div class="tile"><div class="label">Finished this week</div><div class="value">${totals.done7}</div></div>
      <div class="tile ${totals.attention ? 'bad' : ''}"><div class="label">Need attention</div><div class="value">${totals.attention}</div></div>
    </div>
    ${
      people.length
        ? `<div class="table-wrap"><table>
      <thead><tr>
        <th>Person</th><th>Reports to</th><th>Status</th>
        <th class="num">Open</th><th class="num">Open hrs</th><th class="num">Overdue</th>
        <th class="num">On time (90d)</th><th class="num">Avg days to finish</th><th class="num">Done (7d)</th>
        <th>Last activity</th><th>Flags</th>
      </tr></thead>
      <tbody>${people
        .map(
          (p) => `<tr class="click" data-href="#/person/${p.id}">
          <td><strong>${esc(p.name)}</strong><div class="muted small">${esc(p.title || '')}</div></td>
          <td>${esc(p.manager_name || '')}</td>
          <td>${healthPill(p.stats)}</td>
          <td class="num">${p.stats.open_tasks}</td>
          <td class="num">${p.stats.open_hours}</td>
          <td class="num ${p.stats.overdue ? 'bad-text' : ''}">${p.stats.overdue}</td>
          <td class="num">${pct(p.stats.on_time_pct)}</td>
          <td class="num">${num(p.stats.avg_days)}</td>
          <td class="num">${p.stats.done_7}</td>
          <td>${ago(p.stats.last_activity)}</td>
          <td><div class="flags">${flagPills(p.stats)}</div></td>
        </tr>`
        )
        .join('')}</tbody></table></div>`
        : '<div class="card empty">No one reports to you yet. Add a team member to get started.</div>'
    }`;
  $('#add-person').onclick = openAddPerson;
}

async function renderPerson(id) {
  const p = await api(`/users/${id}`);
  rememberTasks(p.tasks);
  const s = p.stats;
  const open = p.tasks.filter((t) => t.status !== 'Done');
  const done = p.tasks.filter((t) => t.status === 'Done');
  view.innerHTML = `
    <div class="page-head">
      <div>
        <div class="muted small"><a href="#/team">Team dashboard</a></div>
        <h1>${esc(p.name)}</h1>
        <div class="muted">${esc(p.title || '')}${p.manager_name ? ` · reports to ${esc(p.manager_name)}` : ''}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">${healthPill(s)}
        <button class="btn primary" id="assign-to">Assign task to ${esc(p.name.split(' ')[0])}</button></div>
    </div>
    ${s.flags.length ? `<div class="flags" style="margin-bottom:14px">${flagPills(s)}</div>` : ''}
    <div class="tiles">
      <div class="tile"><div class="label">Open tasks</div><div class="value">${s.open_tasks}</div></div>
      <div class="tile"><div class="label">Open hours</div><div class="value">${s.open_hours}</div></div>
      <div class="tile ${s.overdue ? 'bad' : ''}"><div class="label">Overdue</div><div class="value">${s.overdue}</div></div>
      <div class="tile"><div class="label">On time (90 days)</div><div class="value">${pct(s.on_time_pct)}</div></div>
      <div class="tile"><div class="label">Avg days to finish</div><div class="value">${num(s.avg_days)}</div></div>
      <div class="tile"><div class="label">Finished (90 days)</div><div class="value">${s.done_90}</div></div>
      <div class="tile"><div class="label">Last activity</div><div class="value" style="font-size:16px">${ago(s.last_activity)}</div></div>
    </div>
    <h2>Open work</h2>
    ${taskTable(open, { showAssignee: false })}
    <h2 style="margin-top:24px">Completed</h2>
    ${taskTable(done, { showAssignee: false })}
    ${
      p.reports.length
        ? `<h2 style="margin-top:24px">Direct reports</h2><div class="flags">${p.reports
            .map((r) => `<a class="pill neutral" href="#/person/${r.id}">${esc(r.name)}</a>`)
            .join('')}</div>`
        : ''
    }`;
  $('#assign-to').onclick = () => openAssign({ assignee_id: p.id });
}

function taskTable(tasks, { showAssignee = true, showAssigner = false } = {}) {
  if (!tasks.length) return '<div class="card empty">Nothing here.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Task</th>${showAssignee ? '<th>Assigned to</th>' : ''}${showAssigner ? '<th>From</th>' : ''}
      <th>Project</th><th>Priority</th><th>Due</th><th class="num">Est hrs</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${tasks
      .map(
        (t) => `<tr class="${t.status === 'Done' ? 'done' : ''}">
        <td class="wrap"><strong>${esc(t.title)}</strong>${t.notes ? `<div class="muted small">${esc(t.notes)}</div>` : ''}</td>
        ${showAssignee ? `<td><a href="#/person/${t.assignee_id}">${esc(t.assignee_name)}</a></td>` : ''}
        ${showAssigner ? `<td>${esc(t.assigned_by_name || '')}</td>` : ''}
        <td>${t.project_id ? `<a href="#/project/${t.project_id}">${esc(t.project_name)}</a>` : '<span class="muted">None</span>'}</td>
        <td>${priorityPill(t.priority)}</td>
        <td class="${isOverdue(t) ? 'bad-text' : ''}">${fmtDate(t.due_date)}${isOverdue(t) ? ' (late)' : ''}</td>
        <td class="num">${t.est_hours}</td>
        <td>${statusSelect(t)}</td>
        <td>${
          t.assigned_by === me.id || t.assignee_id !== me.id
            ? `<button class="btn sm" data-edit="${t.id}">Edit</button>`
            : ''
        }</td>
      </tr>`
      )
      .join('')}</tbody></table></div>`;
}

// Edit buttons inside any task table.
view.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  const rowTasks = window.__tasks || {};
  openAssign(rowTasks[btn.dataset.edit]);
});
function rememberTasks(tasks) {
  window.__tasks = Object.fromEntries(tasks.map((t) => [t.id, t]));
}

async function renderTaskList(scope) {
  const tasks = await api(`/tasks?scope=${scope}`);
  rememberTasks(tasks);
  const mine = scope === 'mine';
  const openCount = tasks.filter((t) => t.status !== 'Done').length;
  const overdue = tasks.filter(isOverdue).length;
  view.innerHTML = `
    <div class="page-head">
      <div><h1>${mine ? 'My tasks' : 'Assigned by me'}</h1>
      <div class="muted">${openCount} open${overdue ? `, <span class="bad-text">${overdue} overdue</span>` : ''}</div></div>
    </div>
    ${taskTable(tasks, { showAssignee: !mine, showAssigner: mine })}`;
}

async function renderProjects() {
  const projects = await api('/projects');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Projects</h1><div class="muted">${projects.length} total</div></div>
      <button class="btn primary" id="new-project">+ New project</button>
    </div>
    ${
      projects.length
        ? `<div class="grid">${projects
            .map((p) => {
              const pctDone = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
              return `<div class="card project" data-href="#/project/${p.id}">
          <div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(p.name)}</strong>
            <span class="pill ${p.status === 'Complete' ? 'good' : 'neutral'}">${esc(p.status)}</span></div>
          <div class="muted small">${esc(p.description || '')}</div>
          <div class="bar"><span style="width:${pctDone}%"></span></div>
          <div class="small muted">${p.done_count}/${p.task_count} tasks done · Due ${fmtDate(p.due_date)} · Owner ${esc(p.owner_name || '')}</div>
          ${p.overdue_count ? `<div><span class="pill bad">${p.overdue_count} overdue</span></div>` : ''}
        </div>`;
            })
            .join('')}</div>`
        : '<div class="card empty">No projects yet.</div>'
    }`;
  $('#new-project').onclick = openNewProject;
}

async function renderProject(id) {
  const p = await api(`/projects/${id}`);
  rememberTasks(p.tasks);
  const pctDone = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <div class="muted small"><a href="#/projects">Projects</a></div>
        <h1>${esc(p.name)}</h1>
        <div class="muted">${esc(p.description || '')}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="toggle-status">${p.status === 'Complete' ? 'Reopen' : 'Mark complete'}</button>
        <button class="btn primary" id="add-task">+ Add task</button>
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">Progress</div><div class="value">${pctDone}%</div></div>
      <div class="tile"><div class="label">Tasks</div><div class="value">${p.done_count}/${p.task_count}</div></div>
      <div class="tile ${p.overdue_count ? 'bad' : ''}"><div class="label">Overdue</div><div class="value">${p.overdue_count}</div></div>
      <div class="tile"><div class="label">Due</div><div class="value" style="font-size:16px">${fmtDate(p.due_date)}</div></div>
      <div class="tile"><div class="label">Owner</div><div class="value" style="font-size:16px">${esc(p.owner_name || '')}</div></div>
    </div>
    ${taskTable(p.tasks)}`;
  $('#add-task').onclick = () => openAssign({ project_id: p.id });
  $('#toggle-status').onclick = async () => {
    try {
      await api(`/projects/${p.id}`, { method: 'PATCH', body: { status: p.status === 'Complete' ? 'Active' : 'Complete' } });
      route();
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- modals ----------
const modal = $('#modal');
function openModal(html, onSubmit) {
  $('#modal-body').innerHTML = html;
  modal.showModal();
  const form = $('#modal-body form');
  form.querySelector('[data-close]')?.addEventListener('click', () => modal.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await onSubmit(data, form);
      modal.close();
      route();
    } catch (err) {
      form.querySelector('.error').textContent = err.message;
    }
  });
}

async function openAssign(task = {}) {
  const [people, projects] = await Promise.all([api('/assignable'), api('/projects')]);
  const editing = Boolean(task.id);
  const opt = (v, label, sel) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(label)}</option>`;
  openModal(
    `<form>
      <h2>${editing ? 'Edit task' : 'Assign a task'}</h2>
      <label>Task<input name="title" required value="${esc(task.title || '')}" placeholder="What needs to get done?" /></label>
      <div class="row">
        <label>Assign to<select name="assignee_id">${people
          .map((u) => opt(u.id, u.id === me.id ? `${u.name} (me)` : u.name, task.assignee_id ?? people[1]?.id ?? me.id))
          .join('')}</select></label>
        <label>Project<select name="project_id">${opt('', 'No project', task.project_id ?? '')}${projects
          .filter((p) => p.status !== 'Complete' || p.id === task.project_id)
          .map((p) => opt(p.id, p.name, task.project_id))
          .join('')}</select></label>
      </div>
      <div class="row">
        <label>Due date<input type="date" name="due_date" value="${esc(task.due_date || '')}" /></label>
        <label>Priority<select name="priority">${['Low', 'Medium', 'High']
          .map((p) => opt(p, p, task.priority || 'Medium'))
          .join('')}</select></label>
      </div>
      <label>Estimated hours<input type="number" min="0" step="0.5" name="est_hours" value="${task.est_hours ?? ''}" /></label>
      <label>Notes<textarea name="notes" placeholder="Context, links, what done looks like">${esc(task.notes || '')}</textarea></label>
      <p class="error"></p>
      <div class="actions">
        ${editing ? '<button type="button" class="btn" id="delete-task" style="margin-right:auto">Delete</button>' : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn primary">${editing ? 'Save' : 'Assign'}</button>
      </div>
    </form>`,
    async (data) => {
      if (editing) await api(`/tasks/${task.id}`, { method: 'PATCH', body: data });
      else await api('/tasks', { method: 'POST', body: data });
      toast(editing ? 'Task updated' : 'Task assigned');
    }
  );
  $('#delete-task')?.addEventListener('click', async () => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      modal.close();
      toast('Task deleted');
      route();
    } catch (err) {
      toast(err.message);
    }
  });
}
$('#assign-btn').addEventListener('click', () => openAssign());

async function openAddPerson() {
  const people = await api('/assignable');
  openModal(
    `<form>
      <h2>Add team member</h2>
      <label>Full name<input name="name" required /></label>
      <div class="row">
        <label>Email<input name="email" type="email" required /></label>
        <label>Title<input name="title" /></label>
      </div>
      <div class="row">
        <label>Reports to<select name="manager_id">${people
          .map((u) => `<option value="${u.id}">${esc(u.id === me.id ? `${u.name} (me)` : u.name)}</option>`)
          .join('')}</select></label>
        <label>Temporary password<input name="password" minlength="8" required /></label>
      </div>
      <p class="muted small">Share the temporary password with them directly.</p>
      <p class="error"></p>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div>
    </form>`,
    async (data) => {
      await api('/users', { method: 'POST', body: data });
      me.has_team = true;
      document.querySelectorAll('.team-only').forEach((el) => el.classList.remove('hidden'));
      toast('Team member added');
    }
  );
}

async function openNewProject() {
  const people = await api('/assignable');
  openModal(
    `<form>
      <h2>New project</h2>
      <label>Name<input name="name" required /></label>
      <label>Description<textarea name="description"></textarea></label>
      <div class="row">
        <label>Owner<select name="owner_id">${people
          .map((u) => `<option value="${u.id}">${esc(u.id === me.id ? `${u.name} (me)` : u.name)}</option>`)
          .join('')}</select></label>
        <label>Due date<input type="date" name="due_date" /></label>
      </div>
      <p class="error"></p>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create</button></div>
    </form>`,
    async (data) => {
      await api('/projects', { method: 'POST', body: data });
      toast('Project created');
    }
  );
}

boot().then(() => { if (!me) showLogin(); });
