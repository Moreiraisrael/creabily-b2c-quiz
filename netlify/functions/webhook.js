const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Permite apenas requisições POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { nome, whatsapp, path, foco, q2, q3, q4, unit } = body;
        const limpar = (v, max = 300) => (v === undefined || v === null) ? null : String(v).trim().slice(0, max) || null;

        // Validação básica do lead
        if (!nome || !whatsapp) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Nome e WhatsApp são obrigatórios' })
            };
        }

        console.log(`[Webhook] Processando novo lead do Quiz: ${nome} (Caminho ${path}, Unidade ${unit})`);

        // Formatação consistente do número de WhatsApp
        let cleanNumber = String(whatsapp).replace(/\D/g, '');
        if (cleanNumber.length === 10 || cleanNumber.length === 11) {
            cleanNumber = '55' + cleanNumber;
        }

        // Mapeamento amigável de tratamento
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

        // Mapeamento de unidade
        let safeUnit = 'paulista'; // default
        if (unit && unit.toLowerCase().includes('granja')) {
            safeUnit = 'granja_viana';
        }
        const nomeUnidade = safeUnit === 'granja_viana' ? 'Unidade Granja Viana' : 'Unidade Paulista';

        // Perguntas do quiz por serviço (mesmos textos do index.html)
        const PERGUNTAS = {
            acupuntura:   ['O que mais te motivou a buscar Acupuntura hoje?', 'Há quanto tempo você sente esses sintomas?', 'Você já tentou outros tratamentos antes sem sucesso?'],
            fisioterapia: ['Onde a dor ou limitação mais te incomoda?', 'Há quanto tempo você sente esse incômodo?', 'Isso está impedindo você de trabalhar ou se exercitar?'],
            nutricao:     ['Qual é o seu principal objetivo com a nutrição?', 'Como é a sua relação com a comida hoje?', 'Você possui alguma restrição alimentar ou condição de saúde?'],
            pilates:      ['Qual o seu maior objetivo ao buscar o Pilates?', 'Como é a sua rotina atual?', 'Você já tem experiência com o método Pilates?'],
            psicologia:   ['O que você sente que mais afeta sua rotina hoje?', 'Você sente que essas emoções estão afetando seu corpo físico?', 'Você já fez acompanhamento psicológico antes?'],
            psicoterapia: ['Qual é o foco que você deseja dar para a psicoterapia?', 'Com que frequência esses sentimentos atrapalham seu dia a dia?', 'Qual formato de terapia você tem preferência?'],
            quiropraxia:  ['O que te fez buscar a Quiropraxia?', 'Você costuma "travar" a coluna ou pescoço com frequência?', 'Você já tem algum exame de imagem recente (Raio-X, Ressonância)?'],
            rpg:          ['Qual é a sua principal queixa postural?', 'Você sente muita dor associada a essa má postura?', 'Qual o seu nível atual de atividade física?']
        };
        const textosPerguntas = PERGUNTAS[path] || ['Pergunta 2', 'Pergunta 3', 'Pergunta 4'];
        const quizAnswers = [q2, q3, q4]
            .map((resposta, i) => ({ pergunta: textosPerguntas[i], resposta: limpar(resposta) }))
            .filter(item => item.resposta);

        const rotinas = [];

        // ==========================================
        // 1. INSERIR DADOS NO SUPABASE
        // ==========================================
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            const baseLead = {
                name: limpar(nome, 120),
                phone: cleanNumber,
                preferred_unit: safeUnit,
                treatment_interest: tratamentoFormatado,
                main_complaint: limpar(foco) || 'Não informada',
                status: 'novo_lead_quiz'
            };
            // Campos novos (exigem a migração SQL da Fase 0)
            const leadCompleto = {
                ...baseLead,
                quiz_answers: quizAnswers,
                utm_source: limpar(body.utm_source, 120),
                utm_medium: limpar(body.utm_medium, 120),
                utm_campaign: limpar(body.utm_campaign, 200),
                utm_content: limpar(body.utm_content, 200),
                utm_term: limpar(body.utm_term, 200),
                gclid: limpar(body.gclid, 300),
                status_changed_at: new Date().toISOString()
            };

            const supabasePromise = (async () => {
                let { error } = await supabase.from('leads').insert([leadCompleto]);
                if (error) {
                    // Se as colunas novas ainda não existirem, grava o lead mesmo assim (nunca perder um lead)
                    console.error('[Supabase] Erro ao inserir lead completo, tentando formato básico:', error.message);
                    ({ error } = await supabase.from('leads').insert([baseLead]));
                }
                if (error) {
                    console.error('[Supabase] Erro ao inserir lead:', error);
                } else {
                    console.log('[Supabase] Lead B2C inserido com sucesso na tabela leads.');
                }
            })().catch(err => console.error('[Supabase] Exceção:', err));
            
            rotinas.push(supabasePromise);
        } else {
            console.warn('[Supabase] Variáveis ausentes. Pulando inserção no banco.');
        }

        // ==========================================
        // 2. DISPARO WHATSAPP (Beatriz via Evolution API)
        // ==========================================
        const evolutionApiUrl = process.env.EVOLUTION_API_URL;
        const evolutionApiKey = process.env.EVOLUTION_API_KEY;
        const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

        if (evolutionApiUrl && evolutionApiKey && instanceName) {
            const wppMessage = `Olá ${nome}, tudo bem? Aqui é a Beatriz, da Creabily. 🌟\n\nPelas suas respostas no nosso teste, indicamos o tratamento de *${tratamentoFormatado}* na nossa *${nomeUnidade}*.\n\nVocê teria disponibilidade esta semana para conversarmos e agendarmos sua Avaliação Integrada com nossa equipe?`;

            console.log(`[Evolution API] Enviando mensagem da Beatriz para ${cleanNumber} (instância: ${instanceName})...`);

            const wppPromise = fetch(`${evolutionApiUrl}/message/sendText/${instanceName}`, {
                method: 'POST',
                headers: {
                    'apikey': evolutionApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: cleanNumber, 
                    options: { delay: 1500, presence: 'composing', linkPreview: false },
                    text: wppMessage 
                })
            })
            .then(async res => {
                const resText = await res.text();
                if (!res.ok) {
                    console.error(`[Evolution API] Falha no disparo. Status HTTP ${res.status}: ${resText}`);
                } else {
                    console.log('[Evolution API] WhatsApp da Beatriz enviado com sucesso:', resText);
                }
            })
            .catch(err => console.error('[Evolution API] Erro de rede ou requisição:', err));

            rotinas.push(wppPromise);
        } else {
            console.warn(`[Evolution API] Variáveis ausentes (URL: ${!!evolutionApiUrl}, Key: ${!!evolutionApiKey}, Instance: ${!!instanceName}). Disparo cancelado.`);
        }

        // Aguarda execução paralela das rotinas
        await Promise.allSettled(rotinas);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Lead B2C processado com sucesso' })
        };

    } catch (error) {
        console.error('Erro no processamento do Quiz:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erro interno', details: error.message })
        };
    }
};
