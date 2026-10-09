const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { password, action, id, status } = body;

        const ADMIN_PASSWORD = process.env.CRM_PASSWORD || 'Creabily2026';
        if (password !== ADMIN_PASSWORD) {
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Acesso Negado.' })
            };
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Configurações de banco de dados ausentes.' })
            };
        }

        const tableName = body.tableType === 'b2b' ? 'leads_b2b' : 'leads';

        const supabase = createClient(supabaseUrl, supabaseKey);

        if (action === 'delete') {
            const { error } = await supabase
                .from(tableName)
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Excluído com sucesso' }) };
        } 
        
        if (action === 'update_status') {
            const { error } = await supabase
                .from(tableName)
                .update({ status: status })
                .eq('id', id);
                
            if (error) throw error;
            return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Status atualizado' }) };
        }

        return { statusCode: 400, body: JSON.stringify({ error: 'Ação inválida.' }) };

    } catch (error) {
        console.error('Erro ao gerenciar lead:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: `Erro: ${error.message || JSON.stringify(error)}` })
        };
    }
};
