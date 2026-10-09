const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Permite apenas requisições POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { nome, whatsapp, path, foco, q2, q3, q4, unit } = body;

        // Validação básica do lead
        if (!nome || !whatsapp) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Nome e WhatsApp são obrigatórios' })
            };
        }

        console.log(`[Webhook] Processando novo lead do Quiz: ${nome} (Caminho ${path}, Unidade ${unit})`);

        const rotinas = [];

        // ==========================================
        // 1. INSERIR DADOS NO SUPABASE
        // ==========================================
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            const rotuloTratamento = {
                'acupuntura': 'Acupuntura',
                'fisioterapia': 'Fisioterapia',
                'nutricao': 'Nutrição',
                'pilates': 'Pilates',
                'psicologia': 'Psicologia',
                'psicoterapia': 'Psicoterapia',
                'quiropraxia': 'Quiropraxia',
                'rpg': 'RPG'
            };
            const tratamentoIndicado = rotuloTratamento[path] || 'Saúde Integrada';
            
            // Format unit to enum values ('paulista' or 'granja_viana')
            let safeUnit = 'paulista'; // default
            if (unit && unit.toLowerCase().includes('granja')) {
                safeUnit = 'granja_viana';
            }

            let cleanNumber = whatsapp.replace(/\D/g, '');
            if (!cleanNumber.startsWith('55')) {
                cleanNumber = '55' + cleanNumber;
            }

            const supabasePromise = supabase
                .from('leads')
                .insert([
                    {
                        name: nome,
                        phone: cleanNumber,
                        preferred_unit: safeUnit,
                        treatment_interest: tratamentoIndicado,
                        main_complaint: foco || 'Não informada',
                        status: 'novo_lead_quiz'
                    }
                ])
                .then(({ error }) => {
                    if (error) throw error;
                    console.log('[Supabase] Lead B2C inserido com sucesso na tabela leads.');
                })
                .catch(err => console.error('[Supabase] Erro:', err));
            
            rotinas.push(supabasePromise);
        } else {
            console.warn('[Supabase] Variáveis ausentes. Pulando inserção no banco.');
        }

        // ==========================================
        // 2. DISPARO WHATSAPP (Evolution API)
        // ==========================================
        const evolutionApiUrl = process.env.EVOLUTION_API_URL;
        const evolutionApiKey = process.env.EVOLUTION_API_KEY;
        const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

        if (evolutionApiUrl && evolutionApiKey && instanceName) {
            const rotuloTratamento = {
                'acupuntura': 'Acupuntura',
                'fisioterapia': 'Fisioterapia',
                'nutricao': 'Nutrição',
                'pilates': 'Pilates',
                'psicologia': 'Psicologia',
                'psicoterapia': 'Psicoterapia',
                'quiropraxia': 'Quiropraxia',
                'rpg': 'RPG'
            };
            const tratamentoFormatado = rotuloTratamento[path] || 'Saúde Integrada';
            
            const wppMessage = `Olá ${nome}, tudo bem? Aqui é a Beatriz, sou da Creabily. 🌟\n\nSeu pré-diagnóstico do nosso teste indicou que você pode se beneficiar do perfil de tratamento de *${tratamentoFormatado}*.\n\nVocê teria disponibilidade essa semana para uma Avaliação Integrada com nossos especialistas?`;
            
            let cleanNumber = whatsapp.replace(/\D/g, '');
            if (!cleanNumber.startsWith('55')) {
                cleanNumber = '55' + cleanNumber;
            }

            const wppPromise = fetch(`${evolutionApiUrl}/message/sendText/${instanceName}`, {
                method: 'POST',
                headers: {
                    'apikey': evolutionApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: cleanNumber, 
                    options: { delay: 3000, presence: 'composing' },
                    text: wppMessage 
                })
            })
            .then(res => {
                if (!res.ok) throw new Error(`Status ${res.status}`);
                console.log('[Evolution API] WhatsApp enviado com sucesso.');
            })
            .catch(err => console.error('[Evolution API] Erro:', err));

            rotinas.push(wppPromise);
        }

        // Aguarda execução paralela
        await Promise.allSettled(rotinas);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Lead B2C processado com sucesso' })
        };

    } catch (error) {
        console.error('Erro no processamento do Quiz:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erro interno' })
        };
    }
};
