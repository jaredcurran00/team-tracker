const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'tracker.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title         TEXT,
  manager_id    INTEGER REFERENCES users(id),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  owner_id    INTEGER REFERENCES users(id),
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'Active',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  notes        TEXT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assignee_id  INTEGER NOT NULL REFERENCES users(id),
  assigned_by  INTEGER REFERENCES users(id),
  priority     TEXT NOT NULL DEFAULT 'Medium',
  status       TEXT NOT NULL DEFAULT 'To do',
  due_date     TEXT,
  est_hours    REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_users_manager  ON users(manager_id);
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// Demo data so the dashboard has something to show on first run.
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;

  const now = Date.now();
  const day = 86400000;
  const iso = (offsetDays) => new Date(now + offsetDays * day).toISOString();
  const date = (offsetDays) => iso(offsetDays).slice(0, 10);
  const pw = hashPassword('demo1234');

  const addUser = db.prepare(
    'INSERT INTO users (name, email, title, manager_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const addProject = db.prepare(
    'INSERT INTO projects (name, description, owner_id, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const addTask = db.prepare(`INSERT INTO tasks
    (title, project_id, assignee_id, assigned_by, priority, status, due_date, est_hours, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    const director = addUser.run('Alex Rivera', 'director@example.com', 'Director', null, pw, iso(-200)).lastInsertRowid;
    const manager = addUser.run('Morgan Lee', 'manager@example.com', 'Associate Director', director, pw, iso(-180)).lastInsertRowid;
    const sam = addUser.run('Sam Patel', 'sam@example.com', 'Coordinator', manager, pw, iso(-150)).lastInsertRowid;
    const jordan = addUser.run('Jordan Kim', 'jordan@example.com', 'Assistant', manager, pw, iso(-90)).lastInsertRowid;
    const taylor = addUser.run('Taylor Brooks', 'taylor@example.com', 'Assistant', director, pw, iso(-60)).lastInsertRowid;

    const p1 = addProject.run('Year-End Campaign', 'December giving push across all channels', manager, date(40), 'Active', iso(-45)).lastInsertRowid;
    const p2 = addProject.run('Donor Event Series', 'Spring hospitality and stewardship events', director, date(90), 'Active', iso(-30)).lastInsertRowid;
    const p3 = addProject.run('Database Cleanup', 'Fix duplicate and outdated contact records', manager, date(20), 'Active', iso(-20)).lastInsertRowid;

    // [title, project, assignee, by, priority, status, dueOffset, hours, createdOffset, updatedOffset, completedOffset]
    const rows = [
      ['Draft campaign email #1', p1, sam, manager, 'High', 'Done', -20, 4, -30, -22, -22],
      ['Build donor segment lists', p1, sam, manager, 'High', 'Done', -12, 6, -25, -13, -13],
      ['Write social posts for Giving Tuesday', p1, sam, manager, 'Medium', 'In progress', 5, 3, -6, -1, null],
      ['Proof campaign mailer', p1, sam, manager, 'Medium', 'To do', 9, 2, -2, -2, null],
      ['Merge duplicate records (A-M)', p3, jordan, manager, 'Medium', 'Done', -8, 5, -18, -5, -5],
      ['Merge duplicate records (N-Z)', p3, jordan, manager, 'Medium', 'In progress', -3, 5, -10, -9, null],
      ['Update address change requests', p3, jordan, manager, 'Low', 'To do', -1, 2, -12, -12, null],
      ['Pull lapsed donor report', p1, jordan, manager, 'High', 'Done', -15, 3, -22, -14, -14],
      ['Venue quotes for spring event', p2, taylor, director, 'High', 'Done', -10, 4, -20, -11, -11],
      ['Draft event invite list', p2, taylor, director, 'Medium', 'In progress', 7, 6, -8, -2, null],
      ['Catering vendor comparison', p2, taylor, director, 'Low', 'To do', 14, 3, -3, -3, null],
      ['Approve campaign calendar', p1, manager, director, 'High', 'Done', -28, 2, -40, -29, -29],
      ['Review cleanup progress', p3, manager, director, 'Medium', 'To do', 3, 1, -4, -4, null],
      ['Thank-you call list', p1, sam, manager, 'Low', 'Done', -40, 2, -50, -38, -38],
    ];
    for (const r of rows) {
      addTask.run(r[0], r[1], r[2], r[3], r[4], r[5], date(r[6]), r[7], iso(r[8]), iso(r[9]), r[10] === null ? null : iso(r[10]));
    }
  })();

  console.log('Seeded demo data. Sign in as director@example.com / demo1234');
}

module.exports = { db, hashPassword, verifyPassword, seedIfEmpty };
