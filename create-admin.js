// Usage: npm run create-admin -- "Full Name" email@company.com "password" ["Title"]
// Creates a top-level account (no manager). Use this for the most senior person.
const { db, hashPassword } = require('./db');

const [name, email, password, title] = process.argv.slice(2);
if (!name || !email || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- "Full Name" email@company.com "password (8+ chars)" ["Title"]');
  process.exit(1);
}
try {
  db.prepare('INSERT INTO users (name, email, title, manager_id, password_hash, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
    .run(name, email, title || null, hashPassword(password), new Date().toISOString());
  console.log(`Created ${name} <${email}>. Start the app and sign in.`);
} catch (e) {
  console.error(String(e.message).includes('UNIQUE') ? 'That email already exists.' : e.message);
  process.exit(1);
}
