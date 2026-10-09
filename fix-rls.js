const { Client } = require('pg');
async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres.rqxrphtfjzduzlfnxuax:Creabily312%40@aws-0-us-east-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log('Connected');
  
  const tables = ['leads', 'appointments', 'procedures', 'n8n_chat_histories', 'metrics_logs'];
  
  for (const table of tables) {
    try {
      await client.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      console.log(`Enabled RLS for ${table}`);
    } catch (e) {
      console.error(`Error for ${table}:`, e.message);
    }
  }
  
  await client.end();
}
run().catch(console.error);
