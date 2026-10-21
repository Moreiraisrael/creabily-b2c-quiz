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
  const prof = String(r.profissional || '').toLowerCase();
  const esp = String(r.especialidade || '').toLowerCase();
  const proc = String(r.procedimento || '').toLowerCase();
  if (
    prof.includes('granja') ||
    prof.includes('angela oliveira') ||
    prof.includes('giovanna barros') ||
    prof.includes('jessica oliveira') ||
    prof.includes('piero antonaccio') ||
    prof.includes('camila (fisio') ||
    esp.includes('granja') ||
    proc.includes('granja')
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
    // ACTION: LIST (Listagem analítica com paginação e filtros)
    // -------------------------------------------------------------
    if (action === 'list') {
      const {
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
        ORDER BY to_date(CASE WHEN data ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN data ELSE '01/10/2026' END, 'DD/MM/YYYY') DESC, unidade ASC, paciente ASC
        LIMIT $${pIdx++} OFFSET $${pIdx++};
      `, queryParams);

      // KPIs consolidados (filtrados por data se selecionada)
      const kpiParams = [];
      let kpiDateFilter = '';
      if (dataFilter && dataFilter !== 'all') {
        kpiDateFilter = 'WHERE data = $1';
        kpiParams.push(dataFilter);
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

      const diasRes = await client.query(`
        SELECT data, count(*) as count,
               count(*) FILTER (WHERE LOWER(unidade) LIKE '%paulista%') AS paulista,
               count(*) FILTER (WHERE LOWER(unidade) LIKE '%granja%') AS granja
        FROM public.agendamentos_auditoria
        WHERE data ~ '^\\d{2}/\\d{2}/\\d{4}$'
        GROUP BY data
        ORDER BY to_date(data, 'DD/MM/YYYY') DESC;
      `);

      const convRes = await client.query(`
        SELECT convenio, count(*) as count
        FROM public.agendamentos_auditoria
        ${kpiDateFilter}
        GROUP BY convenio
        ORDER BY count DESC;
      `, kpiParams);

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
          rows: rowsRes.rows,
          kpis,
          dias: diasRes.rows,
          convenios: convRes.rows,
          conveniosList: CONVENIO_LIST
        })
      };
    }

    // -------------------------------------------------------------
    // ACTION: VALIDATE (Validação de 1 clique ou em lote)
    // -------------------------------------------------------------
    if (action === 'validate') {
      const { id, ids, validacao, observacao, validado_por = 'Recepção' } = body;
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

      updateQuery += ` WHERE id = ANY($${pIdx}::bigint[]) RETURNING id, validacao, observacao, acao_lembrete;`;
      updateParams.push(targetIds);

      const updateRes = await client.query(updateQuery, updateParams);
      await client.end();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          updatedCount: updateRes.rowCount,
          updatedRows: updateRes.rows
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

      // Normalizar todas as linhas recebidas antes de consultar o banco
      const normalizedRows = rows.map(r => {
        const data = normalizeDateStr(r.data);
        const paciente = String(r.paciente || '').trim();
        const horario = normalizeTimeStr(r.horario);
        const status_agil = String(r.status_agil || 'Agendado').trim();
        const profissional = String(r.profissional || '').trim();
        const especialidade = String(r.especialidade || '').trim();
        const procedimento = String(r.procedimento || '').trim();
        const sessao = String(r.sessao || '').trim();
        const cpf_carteirinha = String(r.cpf_carteirinha || '').trim();
        const guia = String(r.guia || '').trim();
        const situacao = String(r.situacao || '').trim();
        const unidade = detectUnidade(r);
        const convenio = normalizeConvenio(r.convenio, procedimento, guia);
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
          situacao,
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
      const uniquePatients = [...new Set(normalizedRows.map(r => r.paciente))];

      // Buscar registros existentes nas datas importadas em 1 única query
      const existingRes = await client.query(`
        SELECT id, data, paciente, horario, unidade, validacao, observacao
        FROM public.agendamentos_auditoria
        WHERE data = ANY($1::text[]);
      `, [uniqueDates]);

      const existingMap = new Map();
      for (const ex of existingRes.rows) {
        const key = `${ex.data}|${(ex.paciente || '').toLowerCase()}|${ex.horario || ''}|${ex.unidade || ''}`;
        existingMap.set(key, ex);
      }

      // Buscar histórico dos pacientes para cálculo inteligente de Paciente Novo & 10ª Sessão NPS
      const historyRes = await client.query(`
        SELECT paciente, data, sessao, especialidade, procedimento, guia
        FROM public.agendamentos_auditoria
        WHERE paciente = ANY($1::text[])
        ORDER BY id ASC;
      `, [uniquePatients]);

      const historyByPatient = {};
      for (const h of historyRes.rows) {
        const pKey = (h.paciente || '').trim().toLowerCase();
        if (!historyByPatient[pKey]) historyByPatient[pKey] = [];
        historyByPatient[pKey].push(h);
      }
      // Incluir também os próprios registros do lote atual na análise histórica
      for (const nr of normalizedRows) {
        const pKey = nr.paciente.toLowerCase();
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
        const pKey = r.paciente.toLowerCase();
        const profile = patientProfiles[pKey] || null;
        const acao_lembrete = r.acao_lembrete || computeAlerts(r, profile);
        if (acao_lembrete.includes('ALERTA NPS')) npsCount++;

        const stLow = r.status_agil.toLowerCase();
        let initialValidacao = r.validacao || 'Pendente';
        if (stLow.includes('justificada')) {
          initialValidacao = 'Falta Justificada';
        } else if (stLow.includes('não compareceu') || stLow.includes('nao compareceu')) {
          if (!initialValidacao.toLowerCase().includes('validado')) {
            initialValidacao = 'Não compareceu';
          }
        } else if (stLow.includes('cancelado') || stLow.includes('desmarcado')) {
          if (!initialValidacao.toLowerCase().includes('validado')) {
            initialValidacao = 'Pendente';
          }
        }

        const key = `${r.data}|${pKey}|${r.horario}|${r.unidade}`;
        const existing = existingMap.get(key);

        if (existing) {
          // Preservar validação manual e observação existentes (Regra Seção 6 do Prompt Mestre)
          const preservedVal = (existing.validacao && existing.validacao !== 'Pendente') ? existing.validacao : initialValidacao;
          const preservedObs = existing.observacao || r.observacao || '';
          await client.query(`
            UPDATE public.agendamentos_auditoria
            SET status_agil = $1, profissional = $2, especialidade = $3, procedimento = $4,
                sessao = $5, cpf_carteirinha = $6, guia = $7, acao_lembrete = $8, situacao = $9,
                convenio = $10, validacao = $11, observacao = $12, updated_at = NOW()
            WHERE id = $13;
          `, [
            r.status_agil, r.profissional, r.especialidade, r.procedimento,
            r.sessao, r.cpf_carteirinha, r.guia, acao_lembrete, r.situacao,
            r.convenio, preservedVal, preservedObs, existing.id
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
