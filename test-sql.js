const { Client } = require('pg');

async function run() {
  const client = new Client({ 
    user: 'postgres.rqxrphtfjzduzlfnxuax',
    password: 'Artecura2026@',
    host: 'aws-0-us-east-2.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log("Connected to Supabase.");

  // Check the current status of all leads to see if any are agendado
  const res4 = await client.query("SELECT id, name, status, phone FROM public.leads");
  console.log("All leads:", res4.rows);

  await client.end();
}

run().catch(console.error);
