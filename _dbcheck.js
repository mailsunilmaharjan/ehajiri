const { Client } = require("pg");
const c = new Client({ host: "localhost", port: 5432, user: "postgres", password: "28029", database: "postgres" });
c.connect().then(async () => {
  const r = await c.query("SELECT rolname FROM pg_roles WHERE rolname=$1", ["ehajiri"]);
  const d = await c.query("SELECT datname FROM pg_database WHERE datname=$1", ["ehajiri_db"]);
  console.log("ehajiri role exists:", r.rows.length > 0);
  console.log("ehajiri_db exists:", d.rows.length > 0);
  await c.end();
}).catch(e => console.log("ERR:", e.message));
