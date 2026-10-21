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

        if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Acesso Negado. Senha incorreta.' })
            };
        }

        if (body.tableType === 'agente') {
            try {
                const agenteHandler = require('./get-agente-sheets.js');
                return await agenteHandler.handler(event, context);
            } catch (err) {
                console.error('[Agente Proxy Error]:', err);
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Erro ao carregar dados do Agente: ' + err.message })
                };
            }
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

        let tableName = 'leads';
        let orderCol = 'last_interaction_at';
        if (body.tableType === 'b2b') {
            tableName = 'leads_b2b';
            orderCol = 'last_interaction_at';
        } else if (body.tableType === 'nps') {
            tableName = 'nps_feedbacks';
            orderCol = 'created_at';
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Buscar dados ordenados pelos mais recentes
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .order(orderCol, { ascending: false });

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                leads: data,
                feedbacks: body.tableType === 'nps' ? data : undefined
            })
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
