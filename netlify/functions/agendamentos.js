const { Client } = require('pg');

const CONVENIO_LIST = [
  'Afresp Saúde',
  'Amil Black, Amil One, Lincx',
  'Care Plus',
  'Medsenior',
  'Convênio Creabily Especial',
  'Creabily Particular',
  'Omint Premium',
  'Omint Skill',
  'Omint Corporate',
  'SEM CONVÊNIO',
  'Total Pass'
];

function getPgClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.rqxrphtfjzduzlfnxuax:Creabily312%40@aws-0-us-east-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });
}

function normalizeDateStr(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // DD/MM/YYYY or DD/MM/YY
  const m1 = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m1) {
    const dd = m1[1].padStart(2, '0');
    const mm = m1[2].padStart(2, '0');
    let yyyy = m1[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    return `${dd}/${mm}/${yyyy}`;
  }
  // YYYY-MM-DD
  const m2 = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) {
    return `${m2[3].padStart(2, '0')}/${m2[2].padStart(2, '0')}/${m2[1]}`;
  }
  return s.slice(0, 20);
}

function normalizeTimeStr(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return s.slice(0, 20);
}

function detectUnidade(r) {
  const u = String(r.unidade || '').toUpperCase();
  if (u.includes('GRANJA')) return 'GRANJA VIANA';
  const combined = `${r.profissional || ''} ${r.especialidade || ''} ${r.procedimento || ''}`.toLowerCase();
  if (
    combined.includes('granja') ||
    combined.includes('angela oliveira') ||
    combined.includes('giovanna barros') ||
    combined.includes('jessica oliveira') ||
    combined.includes('piero') ||
    combined.includes('pierro') ||
    combined.includes('antonaccio') ||
    combined.includes('camila (fisio')
  ) {
    return 'GRANJA VIANA';
  }
  return 'PAULISTA';
}

function normalizeConvenio(raw, procedimento = '', guia = '') {
  const s = String(raw || '').trim();
  const combined = `${s} ${procedimento} ${guia}`.toLowerCase();
  if (!s || s.toUpperCase() === 'SEM CONVÊNIO' || s.toUpperCase() === 'SEM CONVENIO') {
    if (combined.includes('total pass') || combined.includes('totalpass')) return 'Total Pass';
    if (combined.includes('afresp')) return 'Afresp Saúde';
    if (combined.includes('amil') || combined.includes('lincx') || combined.includes('one health')) return 'Amil Black, Amil One, Lincx';
    if (combined.includes('care plus') || combined.includes('careplus')) return 'Care Plus';
    if (combined.includes('medsenior') || combined.includes('medsênior') || combined.includes('med senior')) return 'Medsenior';
    if (combined.includes('omint')) {
      if (combined.includes('premium')) return 'Omint Premium';
      if (combined.includes('corporate')) return 'Omint Corporate';
      return 'Omint Skill';
    }
    if (combined.includes('particular')) return 'Creabily Particular';
    return 'SEM CONVÊNIO';
  }
  // Exact match
  const exact = CONVENIO_LIST.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;

  const low = s.toLowerCase();
  if (low.includes('afresp')) return 'Afresp Saúde';
  if (low.includes('amil') || low.includes('lincx') || low.includes('one')) return 'Amil Black, Amil One, Lincx';
  if (low.includes('care plus') || low.includes('careplus')) return 'Care Plus';
  if (low.includes('medsenior') || low.includes('medsênior') || low.includes('med senior')) return 'Medsenior';
  if (low.includes('especial')) return 'Convênio Creabily Especial';
  if (low.includes('particular')) return 'Creabily Particular';
  if (low.includes('omint') && low.includes('premium')) return 'Omint Premium';
  if (low.includes('omint') && low.includes('corporate')) return 'Omint Corporate';
  if (low.includes('omint')) return 'Omint Skill';
  if (low.includes('total pass') || low.includes('totalpass')) return 'Total Pass';
  return 'SEM CONVÊNIO';
}

function analyzePatientHistory(historyRows) {
  const list = historyRows || [];
  const allText = list.map(x => `${x.procedimento || ''} ${x.guia || ''} ${x.especialidade || ''} ${x.sessao || ''}`).join(' ').toLowerCase();

  const hasPhase2OrMore = /2\s*[\*ªa]\s*fase|3\s*[\*ªa]\s*fase|4\s*[\*ªa]\s*fase|2ª-senha|3ª-senha|2a-senha|3a-senha|24\s*sess|semestral|trimestral|anual|\/20|\/30|\/40|\/48/.test(allText);

  const hasAvaliacao = list.some(x =>
    String(x.sessao || '').trim() === '1/1' ||
    /avalia|consulta|termografia/i.test(`${x.especialidade || ''} ${x.procedimento || ''}`)
  );

  const sessions = list.map(x => {
    const m = String(x.sessao || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    return m ? { cur: parseInt(m[1], 10), tot: parseInt(m[2], 10) } : null;
  }).filter(Boolean);

  const idxStart10 = sessions.findIndex(s => s.cur <= 3 && s.tot === 10);
  const hadHighBeforeStart = idxStart10 > 0 && sessions.slice(0, idxStart10).some(s => s.cur >= 5 && s.tot === 10);
  const idx10_10 = sessions.findIndex(s => s.cur === 10 && s.tot === 10);
  const restartedAfter10_10 = idx10_10 >= 0 && sessions.slice(idx10_10 + 1).some(s => s.cur <= 3 && s.tot === 10);

  const isConfirmedNewWithEval = hasAvaliacao && (idxStart10 >= 0 || sessions.some(s => s.tot === 10)) && !hadHighBeforeStart && !hasPhase2OrMore;
  const isFirstCycle10 = !hasPhase2OrMore && !hadHighBeforeStart && !restartedAfter10_10 && sessions.some(s => s.tot === 10);

  return { isConfirmedNewWithEval, isFirstCycle10, hasPhase2OrMore };
}

function computeAlerts(r, historyProfile = null) {
  const alerts = [];
  const sess = String(r.sessao || '').trim();
  const conv = String(r.convenio || '').toLowerCase();
  const st = String(r.status_agil || '').toLowerCase();
  const val = String(r.validacao || '').toLowerCase();
  const espProc = `${r.especialidade || ''} ${r.procedimento || ''}`;

  const isConfirmedNewWithEval = historyProfile ? historyProfile.isConfirmedNewWithEval : false;
  const isFirstCycle10 = historyProfile ? historyProfile.isFirstCycle10 : true;

  // 0. Falta Justificada na Agenda -> Alerta prioritário para NÃO validar token/assinatura
  if (st.includes('justificada') || val.includes('justificada')) {
    alerts.push('⚪ 🚫 FALTA JUSTIFICADA — NÃO VALIDAR TOKEN / ASSINATURA');
  }

  // 1. Avaliação Inicial
  if (sess === '1/1' || /avalia/i.test(espProc)) {
    alerts.push('📋 Avaliação Inicial (Verificar início de bloco de 10 sessões)');
  }

  // 2. Sessões 1/10 a 10/10 e Regra de NPS para Pacientes Novos
  if (sess === '1/10' || sess === '1') {
    alerts.push('1ª Sessão (Conferir Pedido Médico/Guia)');
    if (isConfirmedNewWithEval) {
      alerts.push('🔵 🆕 PACIENTE NOVO (Avaliação + 1º Bloco de 10 ➔ Alerta NPS na 10ª sessão)');
    }
  } else if (sess === '8/10' || sess === '9/10' || sess === '18/20' || sess === '19/20') {
    alerts.push('Renovação de Pedido (Faltam <=2 sessões)');
    if ((sess === '8/10' || sess === '9/10') && (isConfirmedNewWithEval || isFirstCycle10)) {
      alerts.push('🔵 Preparar NPS (Paciente Novo chegando na 10ª sessão)');
    }
  } else if (sess === '10/10') {
    if (isConfirmedNewWithEval || isFirstCycle10) {
      alerts.push('🔵 ⭐ ALERTA NPS — 10ª Sessão (Paciente Novo • Enviar Pesquisa NPS)');
    } else {
      alerts.push('Fim de Ciclo 10/10 (Paciente recorrente — sem envio de NPS)');
    }
  } else if (isConfirmedNewWithEval && /^\d+\/10$/.test(sess)) {
    alerts.push(`🔵 🆕 Paciente Novo em 1º Bloco (${sess} — NPS programado na 10/10)`);
  }

  // 3. Medsenior 8ª sessão
  if (conv.includes('medsenior') && (sess.startsWith('8/') || sess === '8')) {
    alerts.push('MEDSENIOR — verificar mudança de fase (Fase 2 / Fase 3)');
  }

  // 4. Afresp cancelamento
  if (conv.includes('afresp') && (st.includes('desmarcado') || st.includes('cancelado'))) {
    alerts.push('AFRESP — conferir cancelamento do token no portal Orizon');
  }

  // 5. Não compareceu / Cancelado
  if (st.includes('não compareceu') || st.includes('nao compareceu')) {
    if (!val.includes('validado')) {
      alerts.push('Verificar Token ou Assinatura');
    }
  } else if ((st.includes('cancelado') || st.includes('desmarcado')) && !st.includes('falta') && !st.includes('justificada')) {
    if (!val.includes('validado')) {
      alerts.push('Conferência de Cancelamento');
    }
  }

  return alerts.join(' • ');
}

function normalizeNameForMatch(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSamePersonName(agilName, leadName) {
  const nA = normalizeNameForMatch(agilName);
  const nL = normalizeNameForMatch(leadName);
  if (!nA || !nL) return false;
  const partsA = nA.split(' ').filter(Boolean);
  const partsL = nL.split(' ').filter(Boolean);
  if (partsA.length < 2 || partsL.length < 2) return false;
  if (nA === nL) return true;

  // Se todos os nomes/sobrenomes do Lead (mínimo 2 tokens relevantes >=3 letras e primeiro nome igual) estão contidos na mesma ordem no nome do Ágil
  if (partsA[0] !== partsL[0]) return false;
  const stopWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const sigA = partsA.filter(w => !stopWords.has(w));
  const sigL = partsL.filter(w => !stopWords.has(w));
  if (sigA.length < 2 || sigL.length < 2) return false;

  // Se ambos têm >= 3 nomes significativos e todos os de um estão no outro
  if (sigL.length >= 3 && sigL.every(w => sigA.includes(w))) return true;
  if (sigA.length >= 3 && sigA.every(w => sigL.includes(w))) return true;

  // Se o lead preencheu Nome + Último Sobrenome exato (e sobrenome não é ultra-comum isolado)
  const commonSurnames = new Set(['silva', 'santos', 'souza', 'sousa', 'oliveira', 'pereira', 'lima', 'costa', 'ferreira', 'rodrigues', 'almeida', 'nascimento', 'alves', 'araujo', 'ribeiro', 'carvalho']);
  if (sigL.length === 2 && sigA[0] === sigL[0] && sigA[sigA.length - 1] === sigL[1] && !commonSurnames.has(sigL[1]) && sigL[0].length >= 4 && sigL[1].length >= 4) {
    return true;
  }
  return false;
}

async function syncAgilPatientsWithCrmLeads(client, targetPatientNames = null) {
  const leadsRes = await client.query(`
    SELECT id, name, phone, status, notes
    FROM public.leads
    WHERE name IS NOT NULL AND TRIM(name) <> ''
    ORDER BY created_at DESC;
  `);
  const leads = leadsRes.rows || [];
  if (!leads.length) return { syncedCount: 0, matchedLeadsTotal: 0, updatedLeads: [], leadMapByAgilNorm: {} };

  let agilQuery = `
    SELECT paciente, data, horario, status_agil, validacao, unidade, especialidade, convenio, sessao
    FROM public.agendamentos_auditoria
  `;
  const agilParams = [];
  if (Array.isArray(targetPatientNames) && targetPatientNames.length > 0) {
    agilQuery += ` WHERE LOWER(TRIM(paciente)) = ANY($1::text[])`;
    agilParams.push(targetPatientNames.map(x => String(x || '').trim().toLowerCase()));
  }
  agilQuery += ` ORDER BY to_date(CASE WHEN data ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN data ELSE '01/10/2026' END, 'DD/MM/YYYY') DESC, id DESC;`;

  const agilRes = await client.query(agilQuery, agilParams);
  const byPatient = new Map();
  for (const r of agilRes.rows) {
    const pNorm = normalizeNameForMatch(r.paciente);
    if (!pNorm) continue;
    if (!byPatient.has(pNorm)) {
      byPatient.set(pNorm, { rawName: r.paciente, rows: [] });
    }
    byPatient.get(pNorm).rows.push(r);
  }

  let syncedCount = 0;
  let matchedLeadsTotal = 0;
  const updatedLeads = [];
  const leadMapByAgilNorm = {};

  for (const [pNorm, pData] of byPatient.entries()) {
    const matchedLead = leads.find(l => isSamePersonName(pData.rawName, l.name));
    if (!matchedLead) continue;

    matchedLeadsTotal++;
    const rows = pData.rows;
    const latest = rows[0];
    const hasValidado = rows.some(r => {
      const v = String(r.validacao || '').toLowerCase();
      const s = String(r.status_agil || '').toLowerCase();
      return v.includes('validado') || v.includes('finalizado') || s.includes('finalizado');
    });
    const hasOpenOrJustified = rows.some(r => {
      const v = String(r.validacao || '').toLowerCase();
      const s = String(r.status_agil || '').toLowerCase();
      return v.includes('pendente') || v.includes('justificada') || s.includes('aberto') || s.includes('agendado') || s.includes('justificada');
    });
    const allNoShow = rows.length > 0 && rows.every(r => {
      const v = String(r.validacao || '').toLowerCase();
      const s = String(r.status_agil || '').toLowerCase();
      return (v.includes('não compareceu') || v.includes('nao compareceu') || s.includes('não compareceu')) && !v.includes('validado');
    });

    let desiredStatus = null;
    let noteTag = '';
    if (hasValidado) {
      desiredStatus = 'consulta_realizada';
      noteTag = `[Agente Creabily] ✅ Comparecimento/Sessão confirmada na agenda do Ágil em ${latest.data} (${latest.horario || ''} - ${latest.unidade || ''} - ${latest.especialidade || 'Atendimento'}). Removido do fluxo do Funil.`;
    } else if (hasOpenOrJustified) {
      desiredStatus = 'consulta_realizada';
      noteTag = `[Agente Creabily] 📅 Subiu na Agenda do Ágil para ${latest.data} às ${latest.horario || ''} (${latest.unidade || ''} - ${latest.especialidade || 'Atendimento'}). Removido automaticamente do Funil.`;
    } else if (allNoShow) {
      desiredStatus = 'no_show';
      noteTag = `[Agente Creabily] ⚠️ Ausência (Não Compareceu) registrada na agenda do Ágil em ${latest.data}.`;
    }

    let finalStatus = matchedLead.status;
    // Nunca rebaixar consulta_realizada para agendado ou no_show
    if (desiredStatus && matchedLead.status !== desiredStatus) {
      if (matchedLead.status === 'consulta_realizada' && desiredStatus !== 'consulta_realizada') {
        finalStatus = 'consulta_realizada';
      } else {
        const currentNotes = String(matchedLead.notes || '').trim();
        const updatedNotes = currentNotes.includes(noteTag)
          ? currentNotes
          : (currentNotes ? `${currentNotes}\n${noteTag}` : noteTag);

        await client.query(`
          UPDATE public.leads
          SET status = $1,
              status_changed_at = NOW(),
              notes = $2
          WHERE id = $3;
        `, [desiredStatus, updatedNotes, matchedLead.id]);

        finalStatus = desiredStatus;
        matchedLead.status = desiredStatus;
        matchedLead.notes = updatedNotes;
        syncedCount++;
        updatedLeads.push({
          leadId: matchedLead.id,
          name: matchedLead.name,
          oldStatus: matchedLead.status,
          newStatus: desiredStatus,
          data: latest.data
        });
      }
    }

    leadMapByAgilNorm[pNorm] = {
      id: matchedLead.id,
      name: matchedLead.name,
      phone: matchedLead.phone,
      status: finalStatus
    };
  }

  return { syncedCount, matchedLeadsTotal, updatedLeads, leadMapByAgilNorm };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const client = getPgClient();
  try {
    const body = JSON.parse(event.body || '{}');
    const password = body.password;
    const ADMIN_PASSWORD = process.env.CRM_PASSWORD || 'Creabily2026';

    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Acesso Negado. Senha incorreta.' })
      };
    }

    const action = body.action || 'list';
    await client.connect();

    // -------------------------------------------------------------
    // ACTION: OCR_IMAGE (Lê Prints/Imagens da Agenda Ágil ou Guias via GPT-4o Vision)
    // -------------------------------------------------------------
    if (action === 'ocr_image') {
      const { imageDataUrl, fileName = 'Agenda_Agil.png', fallbackDate = '' } = body;
      await client.end();
      if (!imageDataUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Imagem não fornecida.' }) };
      }

      const customSystemPrompt = `Você é o Auditor de Agenda Clínica da CREABILY – ARTE DA CURA.
Analise visualmente esta imagem (que pode ser um print/captura de tela da Agenda do Sistema Ágil, uma planilha de atendimentos ou uma Guia SP/SADT com datas de sessão).
Extraia TODOS os atendimentos/sessões visíveis na imagem e retorne APENAS um objeto JSON válido com a estrutura:
{
  "atendimentos": [
    {
      "data": "DD/MM/2026 (se não houver ano visível, use 2026; se for uma guia SP/SADT com várias datas no Campo 56, gere um item para cada data manuscrita preenchida)",
      "horario": "HH:MM (ou '08:00' se não informado)",
      "paciente": "Nome completo do paciente/beneficiário",
      "convenio": "Convênio (ex: Afresp Saúde, Medsenior, Care Plus, Omint Skill, Omint Premium, Omint Corporate, Amil Black, Amil One, Lincx, Total Pass, Creabily Particular, SEM CONVÊNIO)",
      "profissional": "Nome do fisioterapeuta/profissional (se visível)",
      "especialidade": "Especialidade (ex: Fisioterapia, Pilates, RPG, Acupuntura, Nutrição, Psicologia)",
      "procedimento": "Procedimento realizado",
      "sessao": "Número da sessão ex: 1/10, 2/8, etc.",
      "cpf_carteirinha": "Número da carteirinha ou CPF (se visível)",
      "guia": "Número da guia SADT ou senha (se visível)",
      "status_agil": "Finalizado, Em Aberto, Não Compareceu ou Falta Justificada",
      "unidade": "PAULISTA ou GRANJA VIANA"
    }
  ]
}`;

      const ocrRes = await fetch('http://2.25.163.224:5678/webhook/ocr-medsenior-sadt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl,
          fileName,
          customSystemPrompt,
          customUserPrompt: `Extraia todos os atendimentos desta imagem (${fileName}). Data de referência caso não apareça na linha: ${fallbackDate || new Date().toLocaleDateString('pt-BR')}.`
        })
      });

      if (!ocrRes.ok) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Falha ao comunicar com o motor de Visão IA.' }) };
      }

      const ocrJson = await ocrRes.json();
      let parsed = null;
      if (ocrJson.choices && ocrJson.choices[0] && ocrJson.choices[0].message) {
        const rawContent = String(ocrJson.choices[0].message.content || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        parsed = JSON.parse(rawContent);
      } else if (ocrJson.atendimentos) {
        parsed = ocrJson;
      }

      const rawList = (parsed && Array.isArray(parsed.atendimentos)) ? parsed.atendimentos : [];
      const todayBR = new Date().toLocaleDateString('pt-BR');
      const normalizedRows = rawList
        .filter(r => r && r.paciente && String(r.paciente).trim().length >= 2)
        .map(r => {
          const dt = normalizeDateStr(r.data) || fallbackDate || todayBR;
          const hr = normalizeTimeStr(r.horario) || '';
          const unid = detectUnidade(r);
          const conv = normalizeConvenio(r.convenio, r.procedimento, r.guia);
          const stAgil = String(r.status_agil || 'Finalizado').trim();
          return {
            data: dt,
            unidade: unid,
            convenio: conv,
            paciente: String(r.paciente).trim(),
            horario: hr,
            status_agil: stAgil,
            profissional: String(r.profissional || '').trim(),
            especialidade: String(r.especialidade || 'Fisioterapia').trim(),
            procedimento: String(r.procedimento || 'Atendimento').trim(),
            sessao: String(r.sessao || '').trim(),
            cpf_carteirinha: String(r.cpf_carteirinha || '000').trim(),
            guia: String(r.guia || '').trim(),
            acao_lembrete: '',
            situacao: stAgil,
            validacao: stAgil.toLowerCase().includes('finalizado') ? 'Finalizado' : 'Pendente',
            observacao: `Extraído via IA Visual (${fileName})`
          };
        });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, rows: normalizedRows })
      };
    }

    // -------------------------------------------------------------
    // ACTION: LIST (Listagem analítica com paginação e filtros)
    // -------------------------------------------------------------
    if (action === 'list') {
      const {
        mesFilter = 'all',
        dataFilter = 'all',
        unidadeFilter = 'all',
        convenioFilter = 'all',
        validacaoFilter = 'all',
        search = '',
        page = 1,
        limit = 50
      } = body;

      const whereClauses = [];
      const params = [];
      let pIdx = 1;

      if (dataFilter && dataFilter !== 'all') {
        whereClauses.push(`data = $${pIdx++}`);
        params.push(dataFilter);
      } else if (mesFilter && mesFilter !== 'all') {
        whereClauses.push(`data LIKE $${pIdx++}`);
        params.push(`%/${mesFilter}`);
      }

      if (unidadeFilter && unidadeFilter !== 'all') {
        whereClauses.push(`UPPER(unidade) LIKE $${pIdx++}`);
        params.push(`%${unidadeFilter.toUpperCase()}%`);
      }

      if (convenioFilter && convenioFilter !== 'all') {
        whereClauses.push(`convenio = $${pIdx++}`);
        params.push(convenioFilter);
      }

      if (validacaoFilter && validacaoFilter !== 'all') {
        if (validacaoFilter === 'validado') {
          whereClauses.push(`(LOWER(validacao) LIKE '%finalizado%' OR LOWER(validacao) LIKE '%validado%')`);
        } else if (validacaoFilter === 'pendente') {
          whereClauses.push(`(LOWER(validacao) LIKE '%pendente%' OR validacao IS NULL OR validacao = '')`);
        } else if (validacaoFilter === 'falta_justificada') {
          whereClauses.push(`(LOWER(validacao) LIKE '%justificada%' OR LOWER(status_agil) LIKE '%justificada%')`);
        } else if (validacaoFilter === 'nao_compareceu') {
          whereClauses.push(`((LOWER(validacao) LIKE '%não compareceu%' OR LOWER(validacao) LIKE '%nao compareceu%' OR LOWER(status_agil) LIKE '%não compareceu%') AND LOWER( COALESCE(validacao,'') ) NOT LIKE '%validado%')`);
        } else if (validacaoFilter === 'cancelado') {
          whereClauses.push(`(LOWER(validacao) LIKE '%cancelado%' OR LOWER(validacao) LIKE '%desmarcado%' OR LOWER(status_agil) LIKE '%desmarcado%')`);
        } else if (validacaoFilter === 'nps') {
          whereClauses.push(`(LOWER(acao_lembrete) LIKE '%alerta nps%' OR LOWER(acao_lembrete) LIKE '%paciente novo%' OR LOWER(acao_lembrete) LIKE '%preparar nps%')`);
        } else if (validacaoFilter === 'nps_10') {
          whereClauses.push(`(LOWER(acao_lembrete) LIKE '%alerta nps%')`);
        }
      }

      if (search && search.trim()) {
        const sTerm = `%${search.trim().toLowerCase()}%`;
        whereClauses.push(`(
          LOWER(paciente) LIKE $${pIdx} OR
          LOWER(profissional) LIKE $${pIdx} OR
          LOWER(especialidade) LIKE $${pIdx} OR
          LOWER(procedimento) LIKE $${pIdx} OR
          LOWER(observacao) LIKE $${pIdx} OR
          LOWER(acao_lembrete) LIKE $${pIdx} OR
          LOWER(cpf_carteirinha) LIKE $${pIdx} OR
          LOWER(guia) LIKE $${pIdx}
        )`);
        params.push(sTerm);
        pIdx++;
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRes = await client.query(`SELECT count(*) FROM public.agendamentos_auditoria ${whereSql};`, params);
      const totalFiltered = parseInt(countRes.rows[0].count, 10);

      const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 5000);
      const offset = Math.max(0, ((parseInt(page, 10) || 1) - 1) * safeLimit);
      const queryParams = [...params, safeLimit, offset];
      const rowsRes = await client.query(`
        SELECT id, data, paciente, horario, status_agil, profissional, especialidade,
               procedimento, sessao, cpf_carteirinha, guia, acao_lembrete, situacao,
               validacao, observacao, unidade, convenio, validado_por, validado_em
        FROM public.agendamentos_auditoria
        ${whereSql}
        ORDER BY to_date(CASE WHEN data ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN data ELSE '01/10/2026' END, 'DD/MM/YYYY') DESC, LOWER(TRIM(paciente)) ASC, horario ASC
        LIMIT $${pIdx++} OFFSET $${pIdx++};
      `, queryParams);

      // KPIs consolidados (filtrados por data ou mês se selecionado)
      const kpiParams = [];
      let kpiDateFilter = '';
      if (dataFilter && dataFilter !== 'all') {
        kpiDateFilter = 'WHERE data = $1';
        kpiParams.push(dataFilter);
      } else if (mesFilter && mesFilter !== 'all') {
        kpiDateFilter = 'WHERE data LIKE $1';
        kpiParams.push(`%/${mesFilter}`);
      }

      const kpisRes = await client.query(`
        SELECT 
          count(*) AS total,
          count(*) FILTER (WHERE LOWER(unidade) LIKE '%paulista%') AS paulista,
          count(*) FILTER (WHERE LOWER(unidade) LIKE '%granja%') AS granja,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%finalizado%' OR LOWER(validacao) LIKE '%validado%') AS validados,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%pendente%' OR validacao IS NULL OR validacao = '') AS pendentes,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%justificada%' OR LOWER(status_agil) LIKE '%justificada%') AS faltas_justificadas,
          count(*) FILTER (WHERE (LOWER(validacao) LIKE '%não compareceu%' OR LOWER(validacao) LIKE '%nao compareceu%' OR LOWER(status_agil) LIKE '%não compareceu%') AND LOWER(COALESCE(validacao,'')) NOT LIKE '%validado%') AS nao_compareceu,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%cancelado%' OR LOWER(status_agil) LIKE '%desmarcado%') AS cancelados,
          count(*) FILTER (WHERE LOWER(acao_lembrete) LIKE '%alerta nps%') AS nps_alertas,
          count(*) FILTER (WHERE LOWER(acao_lembrete) LIKE '%alerta nps%' OR LOWER(acao_lembrete) LIKE '%paciente novo%' OR LOWER(acao_lembrete) LIKE '%preparar nps%') AS nps_ciclo_total
        FROM public.agendamentos_auditoria
        ${kpiDateFilter};
      `, kpiParams);

      const kpiRow = kpisRes.rows[0];
      const totalNum = parseInt(kpiRow.total, 10) || 0;
      const validadosNum = parseInt(kpiRow.validados, 10) || 0;
      const taxaConclusao = totalNum > 0 ? ((validadosNum / totalNum) * 100).toFixed(1) : '0.0';

      const kpis = {
        totalAgendamentos: totalNum,
        paulistaTotal: parseInt(kpiRow.paulista, 10) || 0,
        granjaTotal: parseInt(kpiRow.granja, 10) || 0,
        validados: validadosNum,
        pendentes: parseInt(kpiRow.pendentes, 10) || 0,
        faltasJustificadas: parseInt(kpiRow.faltas_justificadas, 10) || 0,
        naoCompareceu: parseInt(kpiRow.nao_compareceu, 10) || 0,
        cancelamentos: parseInt(kpiRow.cancelados, 10) || 0,
        npsAlertas: parseInt(kpiRow.nps_alertas, 10) || 0,
        npsCicloTotal: parseInt(kpiRow.nps_ciclo_total, 10) || 0,
        taxaConclusao: parseFloat(taxaConclusao)
      };

      const mesesRes = await client.query(`
        SELECT SUBSTRING(data FROM 4 FOR 7) AS mes, count(*) as count
        FROM public.agendamentos_auditoria
        WHERE data ~ '^\\d{2}/\\d{2}/\\d{4}$'
        GROUP BY SUBSTRING(data FROM 4 FOR 7)
        ORDER BY to_date('01/' || SUBSTRING(data FROM 4 FOR 7), 'DD/MM/YYYY') DESC;
      `);

      const diasParams = [];
      let diasMonthClause = '';
      if (mesFilter && mesFilter !== 'all') {
        diasMonthClause = 'AND data LIKE $1';
        diasParams.push(`%/${mesFilter}`);
      }

      const diasRes = await client.query(`
        SELECT data, count(*) as count,
               count(*) FILTER (WHERE LOWER(unidade) LIKE '%paulista%') AS paulista,
               count(*) FILTER (WHERE LOWER(unidade) LIKE '%granja%') AS granja
        FROM public.agendamentos_auditoria
        WHERE data ~ '^\\d{2}/\\d{2}/\\d{4}$' ${diasMonthClause}
        GROUP BY data
        ORDER BY to_date(data, 'DD/MM/YYYY') DESC;
      `, diasParams);

      const convRes = await client.query(`
        SELECT convenio, count(*) as count
        FROM public.agendamentos_auditoria
        ${kpiDateFilter}
        GROUP BY convenio
        ORDER BY count DESC;
      `, kpiParams);

      // Enriquecer linhas exibidas com vínculo automático ao Funil do CRM (public.leads)
      const leadsForMatchRes = await client.query(`
        SELECT id, name, phone, status
        FROM public.leads
        WHERE name IS NOT NULL AND TRIM(name) <> ''
        ORDER BY created_at DESC;
      `);
      const allLeads = leadsForMatchRes.rows || [];
      const enrichedRows = rowsRes.rows.map(r => {
        const matched = allLeads.find(l => isSamePersonName(r.paciente, l.name));
        return matched
          ? { ...r, crm_lead: { id: matched.id, name: matched.name, phone: matched.phone, status: matched.status } }
          : r;
      });

      await client.end();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          total: totalFiltered,
          page,
          limit: safeLimit,
          totalPages: Math.ceil(totalFiltered / safeLimit) || 1,
          rows: enrichedRows,
          kpis,
          meses: mesesRes.rows,
          dias: diasRes.rows,
          convenios: convRes.rows,
          conveniosList: CONVENIO_LIST
        })
      };
    }

    // -------------------------------------------------------------
    // ACTION: SYNC_CRM (Cruzamento completo Agenda do Ágil ➔ Funil do CRM)
    // -------------------------------------------------------------
    if (action === 'sync_crm') {
      const syncResult = await syncAgilPatientsWithCrmLeads(client, null);
      await client.end();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          ...syncResult
        })
      };
    }

    // -------------------------------------------------------------
    // ACTION: VALIDATE (Validação de 1 clique, edição de obs/carteirinha ou em lote)
    // -------------------------------------------------------------
    if (action === 'validate') {
      const { id, ids, validacao, observacao, cpf_carteirinha, guia, validado_por = 'Recepção' } = body;
      const targetIds = ids || (id ? [id] : []);

      if (!targetIds.length || !validacao) {
        await client.end();
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'IDs e status de validação são obrigatórios.' })
        };
      }

      let updateQuery = `
        UPDATE public.agendamentos_auditoria
        SET validacao = $1,
            validado_por = $2,
            validado_em = NOW(),
            updated_at = NOW()
      `;
      const updateParams = [validacao, validado_por];
      let pIdx = 3;

      if (observacao !== undefined) {
        updateQuery += `, observacao = $${pIdx++}`;
        updateParams.push(observacao);
      }
      if (cpf_carteirinha !== undefined) {
        updateQuery += `, cpf_carteirinha = $${pIdx++}`;
        updateParams.push(String(cpf_carteirinha).trim());
      }
      if (guia !== undefined) {
        updateQuery += `, guia = $${pIdx++}`;
        updateParams.push(String(guia).trim());
      }
      if (String(validacao).toLowerCase().includes('justificada')) {
        updateQuery += `, situacao = 'JUSTIFICADA', acao_lembrete = CASE WHEN COALESCE(acao_lembrete, '') LIKE '%FALTA JUSTIFICADA%' THEN acao_lembrete WHEN COALESCE(acao_lembrete, '') = '' THEN '⚪ 🚫 FALTA JUSTIFICADA — NÃO VALIDAR TOKEN / ASSINATURA' ELSE '⚪ 🚫 FALTA JUSTIFICADA — NÃO VALIDAR TOKEN / ASSINATURA • ' || acao_lembrete END`;
      }

      updateQuery += ` WHERE id = ANY($${pIdx}::bigint[]) RETURNING id, paciente, validacao, observacao, cpf_carteirinha, guia, acao_lembrete;`;
      updateParams.push(targetIds);

      const updateRes = await client.query(updateQuery, updateParams);
      const patientNames = [...new Set(updateRes.rows.map(r => r.paciente).filter(Boolean))];
      const crmSync = patientNames.length ? await syncAgilPatientsWithCrmLeads(client, patientNames) : { syncedCount: 0, updatedLeads: [] };
      await client.end();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          updatedCount: updateRes.rowCount,
          updatedRows: updateRes.rows,
          crmSyncedCount: crmSync.syncedCount,
          crmUpdatedLeads: crmSync.updatedLeads
        })
      };
    }

    // -------------------------------------------------------------
    // ACTION: IMPORT (Ingestão inteligente do relatório do Ágil)
    // -------------------------------------------------------------
    if (action === 'import') {
      const { rows = [], loteNome = 'Importacao_Manual' } = body;

      if (!rows.length) {
        await client.end();
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Nenhum registro válido para importar.' })
        };
      }

      // Normalizar todas as linhas recebidas antes de consultar o banco (com proteção contra colunas deslocadas do Ágil)
      const normalizedRows = rows.map(r => {
        const data = normalizeDateStr(r.data);
        let paciente = String(r.paciente || '').trim();
        let horario = String(r.horario || '').trim();
        let status_agil = String(r.status_agil || '').trim();
        let profissional = String(r.profissional || '').trim();
        let especialidade = String(r.especialidade || '').trim();
        let procedimento = String(r.procedimento || '').trim();
        let sessao = String(r.sessao || '').trim();
        let cpf_carteirinha = String(r.cpf_carteirinha || '').trim();
        let guia = String(r.guia || '').trim();
        let acao_lembrete = String(r.acao_lembrete || '').trim();
        let situacao = String(r.situacao || '').trim();
        let validacao = String(r.validacao || '').trim();
        let observacao = String(r.observacao || '').trim();
        let rawConvenio = String(r.convenio || '').trim();

        // Se a linha veio deslocada do relatório bruto do Ágil (ex: paciente = horário ou status_agil = Feminino/Masculino ou procedimento = CREFITO)
        const isShiftedAgil =
          (/^\d{1,2}:\d{2}/.test(paciente) && horario && !/^\d{1,2}:\d{2}/.test(horario)) ||
          /^(feminino|masculino|não informado)$/i.test(status_agil) ||
          /^(crefito|crp|crn|crtp|crm)\s*:/i.test(procedimento);

        if (isShiftedAgil) {
          const realTime = /^\d{1,2}:\d{2}/.test(paciente) ? paciente : horario;
          const realName = /^\d{1,2}:\d{2}/.test(paciente) ? horario : paciente;
          const realConv = profissional;
          const rawProf = especialidade;
          const rawConselho = procedimento;
          const realProc = sessao;
          const realEsp = cpf_carteirinha;
          const rawStSess = acao_lembrete;

          horario = normalizeTimeStr(realTime);
          paciente = realName;
          rawConvenio = realConv;
          profissional = (rawConselho && /^(crefito|crp|crn|crtp|crm)/i.test(rawConselho) && !rawProf.includes(rawConselho))
            ? `${rawProf} - ${rawConselho}`
            : rawProf;
          procedimento = realProc;
          especialidade = realEsp;
          cpf_carteirinha = '';
          acao_lembrete = '';
          situacao = '';
          validacao = 'Pendente';
          observacao = '';

          const mSt = rawStSess.match(/^([^\(]+?)\s*(?:\(([^)]*)\))?$/);
          if (mSt) {
            status_agil = (mSt[1] || 'Em Aberto').trim();
            const inside = (mSt[2] || '').trim();
            sessao = /^\d+\s*\/\s*\d+$/.test(inside) ? inside.replace(/\s+/g, '') : '';
          } else {
            status_agil = 'Em Aberto';
            sessao = '';
          }
        } else {
          horario = normalizeTimeStr(horario);
          status_agil = status_agil || 'Agendado';
          if (/^[0-9.]+$/.test(validacao)) validacao = 'Pendente';
          if (/^[0-9.]+$/.test(observacao)) observacao = '';
          if (/^[0-9.]+$/.test(situacao)) situacao = '';
          if (/^[0-9.]+$/.test(acao_lembrete)) acao_lembrete = '';
          if (/^(tratamento|consulta|avaliação|avaliacao)$/i.test(profissional)) profissional = '';
        }

        const rowForUnit = { unidade: r.unidade, profissional, especialidade, procedimento };
        const unidade = detectUnidade(rowForUnit);
        const convenio = normalizeConvenio(rawConvenio, procedimento, guia);
        return {
          ...r,
          data,
          paciente,
          horario,
          status_agil,
          profissional,
          especialidade,
          procedimento,
          sessao,
          cpf_carteirinha,
          guia,
          acao_lembrete,
          situacao,
          validacao,
          observacao,
          unidade,
          convenio
        };
      }).filter(r => r.data && r.paciente);

      if (!normalizedRows.length) {
        await client.end();
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Não foi possível identificar Data e Paciente nas linhas enviadas.' })
        };
      }

      const uniqueDates = [...new Set(normalizedRows.map(r => r.data))];
      const uniquePatientsLower = [...new Set(normalizedRows.map(r => r.paciente.trim().toLowerCase()))];

      // Buscar registros existentes nas datas importadas em 1 única query
      const existingRes = await client.query(`
        SELECT id, data, paciente, horario, unidade, validacao, observacao, cpf_carteirinha, profissional
        FROM public.agendamentos_auditoria
        WHERE data = ANY($1::text[]);
      `, [uniqueDates]);

      const existingMap = new Map();
      for (const ex of existingRes.rows) {
        const key = `${ex.data}|${(ex.paciente || '').trim().toLowerCase()}|${ex.horario || ''}`;
        existingMap.set(key, ex);
      }

      // Buscar histórico dos pacientes para cálculo inteligente de Paciente Novo & 10ª Sessão NPS + Herança Automática de Carteirinha e Profissional
      const historyRes = await client.query(`
        SELECT paciente, data, sessao, especialidade, procedimento, guia, cpf_carteirinha, profissional, convenio, unidade
        FROM public.agendamentos_auditoria
        WHERE LOWER(TRIM(paciente)) = ANY($1::text[])
        ORDER BY id ASC;
      `, [uniquePatientsLower]);

      const historyByPatient = {};
      const patientDefaults = {};
      for (const h of historyRes.rows) {
        const pKey = (h.paciente || '').trim().toLowerCase();
        if (!historyByPatient[pKey]) historyByPatient[pKey] = [];
        historyByPatient[pKey].push(h);

        if (!patientDefaults[pKey]) {
          patientDefaults[pKey] = { cpf_carteirinha: '', guia: '', profissional: '', convenio: '', unidade: '' };
        }
        const def = patientDefaults[pKey];
        const cVal = String(h.cpf_carteirinha || '').trim();
        if (cVal && cVal !== '—' && (!def.cpf_carteirinha || def.cpf_carteirinha === '000')) {
          def.cpf_carteirinha = cVal;
        }
        const gVal = String(h.guia || '').trim();
        if (gVal && gVal !== '—') def.guia = gVal;
        const prVal = String(h.profissional || '').trim();
        if (prVal && prVal !== 'Tratamento' && prVal !== '—') def.profissional = prVal;
        const cvVal = String(h.convenio || '').trim();
        if (cvVal && cvVal !== 'SEM CONVÊNIO') def.convenio = cvVal;
        if (h.unidade) def.unidade = h.unidade;
      }
      // Incluir também os próprios registros do lote atual na análise histórica
      for (const nr of normalizedRows) {
        const pKey = nr.paciente.trim().toLowerCase();
        if (!historyByPatient[pKey]) historyByPatient[pKey] = [];
        historyByPatient[pKey].push(nr);
      }

      const patientProfiles = {};
      for (const [pKey, list] of Object.entries(historyByPatient)) {
        patientProfiles[pKey] = analyzePatientHistory(list);
      }

      let insertedCount = 0;
      let updatedCount = 0;
      let npsCount = 0;

      await client.query('BEGIN');

      for (const r of normalizedRows) {
        const pKey = r.paciente.trim().toLowerCase();
        const profile = patientProfiles[pKey] || null;
        const def = patientDefaults[pKey] || {};

        // Herdar automaticamente o número da carteirinha, profissional e convênio do histórico se não vieram na planilha do Ágil
        if ((!r.cpf_carteirinha || r.cpf_carteirinha === '—') && def.cpf_carteirinha) {
          r.cpf_carteirinha = def.cpf_carteirinha;
        }
        if ((!r.profissional || r.profissional === 'Tratamento' || r.profissional === '—') && def.profissional) {
          r.profissional = def.profissional;
        }
        if ((!r.convenio || r.convenio === 'SEM CONVÊNIO') && def.convenio) {
          r.convenio = def.convenio;
        }
        r.unidade = detectUnidade({ unidade: r.unidade || def.unidade, profissional: r.profissional, especialidade: r.especialidade, procedimento: r.procedimento });

        const stLow = r.status_agil.toLowerCase();
        let initialValidacao = r.validacao || 'Pendente';
        let initialSituacao = r.situacao || 'EM ABERTO';
        if (stLow.includes('justificada')) {
          initialValidacao = 'Falta Justificada';
          initialSituacao = 'JUSTIFICADA';
        } else if (stLow.includes('não compareceu') || stLow.includes('nao compareceu')) {
          if (!initialValidacao.toLowerCase().includes('validado')) {
            initialValidacao = 'Não compareceu';
          }
        } else if (stLow.includes('cancelado') || stLow.includes('desmarcado')) {
          if (!initialValidacao.toLowerCase().includes('validado')) {
            initialValidacao = 'Pendente';
          }
        }
        r.validacao = initialValidacao;
        r.situacao = initialSituacao;

        const acao_lembrete = r.acao_lembrete || computeAlerts(r, profile);
        if (acao_lembrete.includes('ALERTA NPS')) npsCount++;

        const key = `${r.data}|${pKey}|${r.horario}`;
        const existing = existingMap.get(key);

        if (existing) {
          // Preservar validação manual, observação e carteirinha existentes (Regra Seção 6 do Prompt Mestre)
          const preservedVal = (existing.validacao && existing.validacao !== 'Pendente') ? existing.validacao : initialValidacao;
          const preservedObs = existing.observacao || r.observacao || '';
          const preservedCart = r.cpf_carteirinha || existing.cpf_carteirinha || '';
          const preservedProf = r.profissional || existing.profissional || '';
          await client.query(`
            UPDATE public.agendamentos_auditoria
            SET status_agil = $1, profissional = $2, especialidade = $3, procedimento = $4,
                sessao = $5, cpf_carteirinha = $6, guia = $7, acao_lembrete = $8, situacao = $9,
                convenio = $10, validacao = $11, observacao = $12, unidade = $13, updated_at = NOW()
            WHERE id = $14;
          `, [
            r.status_agil, preservedProf, r.especialidade, r.procedimento,
            r.sessao, preservedCart, r.guia, acao_lembrete, r.situacao,
            r.convenio, preservedVal, preservedObs, r.unidade, existing.id
          ]);
          updatedCount++;
        } else {
          const insRes = await client.query(`
            INSERT INTO public.agendamentos_auditoria (
              data, paciente, horario, status_agil, profissional, especialidade,
              procedimento, sessao, cpf_carteirinha, guia, acao_lembrete, situacao,
              validacao, observacao, unidade, convenio, lote_importacao
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id;
          `, [
            r.data, r.paciente, r.horario, r.status_agil, r.profissional, r.especialidade,
            r.procedimento, r.sessao, r.cpf_carteirinha, r.guia, acao_lembrete, r.situacao,
            initialValidacao, r.observacao || '', r.unidade, r.convenio, loteNome
          ]);
          existingMap.set(key, { id: insRes.rows[0].id, validacao: initialValidacao, observacao: r.observacao || '' });
          insertedCount++;
        }
      }

      await client.query('COMMIT');
      const crmSync = await syncAgilPatientsWithCrmLeads(client, uniquePatientsLower);
      await client.end();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          message: `Importação concluída: ${insertedCount} novos agendamentos inseridos, ${updatedCount} atualizados preservando validações manuais.`,
          insertedCount,
          updatedCount,
          npsCount,
          crmSyncedCount: crmSync.syncedCount,
          crmMatchedTotal: crmSync.matchedLeadsTotal,
          crmUpdatedLeads: crmSync.updatedLeads,
          dates: uniqueDates
        })
      };
    }

    await client.end();
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Ação inválida: ${action}` }) };

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    try { await client.end(); } catch (_) {}
    console.error('[Agendamentos API Error]:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro ao processar no banco de dados: ' + err.message })
    };
  }
};
