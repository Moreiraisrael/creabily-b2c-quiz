const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Permite POST para enviar a senha no corpo da requisição de forma mais segura
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const password = body.password;

        // Senha para proteger os dados. Pode ser configurada na Netlify via CRM_PASSWORD
        const ADMIN_PASSWORD = process.env.CRM_PASSWORD || 'Creabily2026';

        if (password !== ADMIN_PASSWORD) {
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Acesso Negado. Senha incorreta.' })
            };
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Configurações de banco de dados (Supabase) ausentes nas variáveis de ambiente.' })
            };
        }

        const tableName = body.tableType === 'b2b' ? 'leads_b2b' : 'leads';

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Buscar leads ordenados pelos mais recentes
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .order('last_interaction_at', { ascending: false });

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, leads: data })
        };

    } catch (error) {
        console.error('Erro ao buscar leads:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: `Erro Supabase: ${error.message || JSON.stringify(error)}` })
        };
    }
};
