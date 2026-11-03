const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Permite apenas requisições POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { nome, whatsapp, path, foco, q2, q3, q4, unit, turno, previsao, modalidade } = body;
        const limpar = (v, max = 300) => (v === undefined || v === null) ? null : String(v).trim().slice(0, max) || null;

        // Validação básica do lead
        if (!nome || !whatsapp) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Nome e WhatsApp são obrigatórios' })
            };
        }

        console.log(`[Webhook] Processando novo lead do Quiz: ${nome} (Caminho ${path}, Unidade ${unit}, Turno ${turno})`);

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
            'rpg': 'RPG',
            'imotion': 'i-Motion (EMS)'
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
            rpg:          ['Qual é a sua principal queixa postural?', 'Você sente muita dor associada a essa má postura?', 'Qual o seu nível atual de atividade física?'],
            imotion:      ['Qual é o seu objetivo principal com a tecnologia i-Motion (EMS)?', 'Com que frequência você pratica atividades físicas atualmente?', 'Você possui alguma contraindicação como marcapasso ou gestação?']
        };
        const textosPerguntas = PERGUNTAS[path] || ['Pergunta 2', 'Pergunta 3', 'Pergunta 4'];
        const quizAnswers = [q2, q3, q4]
            .map((resposta, i) => ({ pergunta: textosPerguntas[i], resposta: limpar(resposta) }))
            .filter(item => item.resposta);

        if (turno) {
            quizAnswers.push({ pergunta: 'Turno de Preferência', resposta: limpar(turno) });
        }
        if (previsao) {
            quizAnswers.push({ pergunta: 'Previsão para Início', resposta: limpar(previsao) });
        }
        if (modalidade) {
            quizAnswers.push({ pergunta: 'Modalidade de Atendimento', resposta: limpar(modalidade) });
        }

        const rotinas = [];

        const rawFirst = (limpar(nome, 120) || 'Paciente').trim().split(/\s+/)[0];
        const primeiroNome = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
        const turnoLower = (turno || '').toLowerCase();
        const turnoHumanizado = turnoLower.includes('manhã') || turnoLower.includes('manha')
            ? 'no período da *manhã*'
            : (turnoLower.includes('tarde')
                ? 'no período da *tarde*'
                : (turnoLower.includes('noite') ? 'no *final do dia*' : ''));
        const queixaHumana = q2 ? ` — vi aqui que seu principal objetivo é *${limpar(q2).replace(/\.$/, '').toLowerCase()}*` : '';
        const modLimpa = limpar(modalidade) || 'Particular / Reembolso';
        const isConvenioCredenciado = /conv[êe]nio:|parceria:|care plus|omint|afresp|amil|meds[êe]nior|totalpass|classpass/i.test(modLimpa);
        const complementoModalidade = isConvenioCredenciado
            ? ` pelo *${modLimpa.replace(/^(Convênio:\s*|Parceria:\s*)/i, '')}*`
            : '';

        const wppMessage = `Olá, ${primeiroNome}! Tudo bem? Aqui é a Beatriz, da Creabily 😊\n\nAcabei de receber a sua avaliação para *${tratamentoFormatado}* na *${nomeUnidade}*${complementoModalidade}${queixaHumana}. Vai ser um prazer cuidar de você!\n\nJá separei prioridade na nossa agenda${turnoHumanizado ? ` ${turnoHumanizado}` : ''}. Qual dia da semana fica mais confortável na sua rotina para olharmos o melhor horário para você?`;

        // ==========================================
        // 1. INSERIR DADOS NO SUPABASE + MEMÓRIA DO AGENTE IA (n8n_chat_histories)
        // ==========================================
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;

        if (supabaseUrl && supabaseKey) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            const preAgendamentoNote = isConvenioCredenciado
                ? `[Pré-Agendamento] Turno: ${limpar(turno) || 'Não informado'} | Previsão: ${limpar(previsao) || 'Esta semana'} | Modalidade: ${modLimpa} (Credenciado)`
                : `[Pré-Agendamento] Turno: ${limpar(turno) || 'Não informado'} | Previsão: ${limpar(previsao) || 'Esta semana'} | Modalidade: ${modLimpa} (Avaliação R$ 300)`;

            const baseLead = {
                name: limpar(nome, 120),
                phone: cleanNumber,
                preferred_unit: safeUnit,
                treatment_interest: tratamentoFormatado,
                main_complaint: limpar(foco) || 'Não informada',
                status: 'novo_lead_quiz'
            };
            // Campos novos (compatíveis com schema do CRM)
            const leadCompleto = {
                ...baseLead,
                quiz_answers: quizAnswers,
                notes: preAgendamentoNote,
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
                    // Se as colunas novas ainda não existirem, tenta formato básico (nunca perder um lead)
                    console.error('[Supabase] Erro ao inserir lead completo, tentando formato básico:', error.message);
                    ({ error } = await supabase.from('leads').insert([baseLead]));
                }
                if (error) {
                    console.error('[Supabase] Erro ao inserir lead:', error);
                } else {
                    console.log('[Supabase] Lead B2C inserido com sucesso na tabela leads.');
                }

                // Grava a triagem e a 1ª mensagem enviada pela Beatriz na memória do n8n (n8n_chat_histories)
                // para que a IA tenha contexto imediato quando o paciente responder "Sim", "Não", etc.
                const sessionId = `${cleanNumber}@s.whatsapp.net`;
                const resumoRespostas = quizAnswers.map(q => `${q.pergunta}: ${q.resposta}`).join(' | ');
                const contextoHuman = `[Triagem preenchida no site da Creabily] Meu nome é ${limpar(nome, 120)}. Busco atendimento de ${tratamentoFormatado} na ${nomeUnidade} (Objetivo/Queixa: ${limpar(foco) || 'Não informada'}). ${resumoRespostas}`;

                const { error: memErr } = await supabase.from('n8n_chat_histories').insert([
                    {
                        session_id: sessionId,
                        message: {
                            type: 'human',
                            content: contextoHuman,
                            additional_kwargs: {},
                            response_metadata: {}
                        }
                    },
                    {
                        session_id: sessionId,
                        message: {
                            type: 'ai',
                            content: wppMessage,
                            tool_calls: [],
                            additional_kwargs: {},
                            response_metadata: {},
                            invalid_tool_calls: []
                        }
                    }
                ]);
                if (memErr) {
                    console.error('[Supabase] Aviso ao gravar memória inicial no n8n_chat_histories:', memErr.message);
                } else {
                    console.log(`[Supabase] Memória inicial do Quiz gravada em n8n_chat_histories para ${sessionId}.`);
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
