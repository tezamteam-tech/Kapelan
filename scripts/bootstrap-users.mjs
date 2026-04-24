import process from "node:process";

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function createUser({ email, password, role, name }) {
  const url = req("SUPABASE_URL").replace(/\/+$/, "");
  const key = req("SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, name },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Create user failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function main() {
  const users = [
    {
      email: process.env.KAPELAN_ADMIN_EMAIL || "admin@kapelan.com",
      password: req("KAPELAN_ADMIN_PASSWORD"),
      role: "admin",
      name: "Администратор",
    },
    {
      email: process.env.KAPELAN_MANAGER_EMAIL || "manager@kapelan.com",
      password: req("KAPELAN_MANAGER_PASSWORD"),
      role: "manager",
      name: "Менеджер",
    },
    {
      email: process.env.KAPELAN_INSTALLER_EMAIL || "mantazh@kappelan.com",
      password: req("KAPELAN_INSTALLER_PASSWORD"),
      role: "installer",
      name: "Монтажник",
    },
  ];

  for (const u of users) {
    try {
      const out = await createUser(u);
      console.log(`OK: ${u.email} (${u.role}) id=${out?.id || out?.user?.id || "?"}`);
    } catch (e) {
      console.error(`ERR: ${u.email} (${u.role})`, e?.message || e);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

