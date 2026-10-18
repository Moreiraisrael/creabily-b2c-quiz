const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { password, action, id, status } = body;

        const ADMIN_PASSWORD = process.env.CRM_PASSWORD;
        if (!ADMIN_PASSWORD) {
            console.error('[Segurança] Variável CRM_PASSWORD não configurada no Netlify.');
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'CRM sem senha configurada (CRM_PASSWORD). Configure no Netlify.' })
            };
        }
        if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
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
            const STATUS_PERMITIDOS = ['novo_lead_quiz', 'conversando', 'followup_1', 'followup_2', 'followup_3', 'agendado', 'consulta_realizada', 'transbordo_humano', 'no_show', 'perdido'];
            if (tableName === 'leads' && !STATUS_PERMITIDOS.includes(status)) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Status inválido.' }) };
            }

            let { error } = await supabase
                .from(tableName)
                .update({ status: status, status_changed_at: new Date().toISOString() })
                .eq('id', id);

            if (error) {
                // Coluna status_changed_at ainda não criada: atualiza só o status
                console.warn('[manage-lead] Atualizando sem status_changed_at:', error.message);
                ({ error } = await supabase.from(tableName).update({ status: status }).eq('id', id));
            }
                
            if (error) throw error;
            return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Status atualizado' }) };
        }

        if (action === 'bulk_update_status') {
            const updates = Array.isArray(body.updates) ? body.updates : [];
            if (updates.length === 0) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Nenhuma atualização informada.' }) };
            }
            const STATUS_PERMITIDOS = ['novo_lead_quiz', 'conversando', 'followup_1', 'followup_2', 'followup_3', 'agendado', 'consulta_realizada', 'transbordo_humano', 'no_show', 'perdido'];
            
            for (const item of updates) {
                if (tableName === 'leads' && !STATUS_PERMITIDOS.includes(item.status)) continue;
                await supabase.from(tableName).update({ 
                    status: item.status, 
                    status_changed_at: new Date().toISOString() 
                }).eq('id', item.id);
            }
            return { statusCode: 200, body: JSON.stringify({ success: true, count: updates.length }) };
        }

        if (action === 'update_fields') {
            // Só estes campos podem ser editados pelo CRM
            const PERMITIDOS = ['notes', 'next_action', 'next_action_at', 'appointment_at', 'lost_reason'];
            const fields = body.fields || {};
            const update = {};
            for (const k of PERMITIDOS) {
                if (k in fields) {
                    const v = fields[k];
                    update[k] = (v === null || v === '') ? null : String(v).slice(0, 5000);
                }
            }
            if (!id || Object.keys(update).length === 0) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Nada para atualizar.' }) };
            }
            const { error } = await supabase.from(tableName).update(update).eq('id', id);
            if (error) {
                const faltaColuna = /column|schema cache/i.test(error.message || '');
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: faltaColuna ? 'Rode o SQL da Fase 0 no Supabase para salvar anotações.' : `Erro: ${error.message}` })
                };
            }
            return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Campos atualizados' }) };
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
