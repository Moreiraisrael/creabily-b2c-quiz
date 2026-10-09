const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Permite apenas requisições POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { nome, whatsapp, email, instagram, faturamento, negocio, motivo } = body;

        // Validação básica do lead
        if (!nome || !whatsapp) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Nome e WhatsApp são obrigatórios' })
            };
        }

        console.log(`[Webhook B2B] Processando nova aplicação de Mentoria: ${nome}`);

        // ==========================================
        // INSERIR DADOS NO SUPABASE
        // ==========================================
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            let cleanNumber = whatsapp.replace(/\D/g, '');
            if (!cleanNumber.startsWith('55')) {
                cleanNumber = '55' + cleanNumber;
            }

            const { error } = await supabase
                .from('leads_b2b')
                .insert([
                    {
                        nome: nome,
                        whatsapp: cleanNumber,
                        email: email,
                        instagram: instagram,
                        faturamento: faturamento,
                        profissao: negocio, // Mapeado da pergunta sobre o negócio
                        transformacao: motivo, // Mapeado da pergunta sobre o motivo
                        status: 'novo_lead_quiz' // Para cair na primeira coluna do CRM
                    }
                ]);

            if (error) {
                console.error('[Supabase B2B] Erro:', error);
                throw error;
            }
            console.log('[Supabase B2B] Aplicação B2B inserida com sucesso.');
        } else {
            console.warn('[Supabase B2B] Variáveis ausentes. Pulando inserção no banco.');
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Erro de configuração do banco de dados' })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Aplicação B2B processada com sucesso' })
        };

    } catch (error) {
        console.error('Erro no processamento da Mentoria B2B:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erro interno ao processar a aplicação' })
        };
    }
};
