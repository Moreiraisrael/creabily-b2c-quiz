const { Client } = require('pg');
const XLSX = require('xlsx');

const CONVENIO_LIST = [
  'Afresp Saúde',
  'Amil Black, Amil One, Lincx',
  'Care Plus',
  'Medsenior',
  'Omint Skill',
  'Omint Premium',
  'Convênio Creabily Especial',
  'Creabily Particular',
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

function computeAlerts(sessao, convenio, status_agil, paciente) {
  const alerts = [];
  const s = String(sessao || '').trim();
  const c = String(convenio || '').trim();
  const st = String(status_agil || '').toLowerCase();

  // 1. Primeira Sessão
  if (s.startsWith('1/') || s === '1') {
    alerts.push('1ª SESSÃO — conferir pedido médico atualizado e guia');
  }

  // 2. Renovação (últimas sessões)
  if (s.startsWith('8/10') || s.startsWith('9/10') || s.startsWith('10/10') || s.startsWith('18/20') || s.startsWith('19/20') || s.startsWith('20/20')) {
    alerts.push('ALERTA FINAL — últimas sessões; novo pedido se houver continuidade');
  }

  // 3. Medsenior 8ª sessão
  if (c.toLowerCase().includes('medsenior') && (s.startsWith('8/') || s === '8')) {
    alerts.push('MEDSENIOR — verificar mudança de fase do tratamento (Fase 2 / Fase 3)');
  }

  // 4. Afresp cancelamento
  if (c.toLowerCase().includes('afresp') && (st.includes('desmarcado') || st.includes('cancelado'))) {
    alerts.push('AFRESP — conferir cancelamento do token no portal Orizon');
  }

  // 5. Alerta NPS
  if (s.startsWith('10/10') || s.startsWith('10/')) {
    alerts.push('⭐ ALERTA NPS — 10ª sessão de tratamento; verificar elegibilidade');
  }

  return alerts.join(' | ') || (st.includes('finalizado') ? 'FINALIZADO NO ÁGIL' : '');
}

exports.handler = async (event, context) => {
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
    const client = getPgClient();
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
          whereClauses.push(`(LOWER(validacao) LIKE '%não compareceu%' OR LOWER(validacao) LIKE '%nao compareceu%' OR LOWER(status_agil) LIKE '%não compareceu%')`);
        } else if (validacaoFilter === 'cancelado') {
          whereClauses.push(`(LOWER(validacao) LIKE '%cancelado%' OR LOWER(validacao) LIKE '%desmarcado%' OR LOWER(status_agil) LIKE '%desmarcado%')`);
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
          LOWER(acao_lembrete) LIKE $${pIdx}
        )`);
        params.push(sTerm);
        pIdx++;
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Total count filtered
      const countRes = await client.query(`SELECT count(*) FROM public.agendamentos_auditoria ${whereSql};`, params);
      const totalFiltered = parseInt(countRes.rows[0].count, 10);

      // Paginated rows
      const offset = Math.max(0, (page - 1) * limit);
      const queryParams = [...params, limit, offset];
      const rowsRes = await client.query(`
        SELECT id, data, paciente, horario, status_agil, profissional, especialidade,
               procedimento, sessao, cpf_carteirinha, guia, acao_lembrete, situacao,
               validacao, observacao, unidade, convenio, validado_por, validado_em
        FROM public.agendamentos_auditoria
        ${whereSql}
        ORDER BY data DESC, unidade ASC, paciente ASC
        LIMIT $${pIdx++} OFFSET $${pIdx++};
      `, queryParams);

      // KPIs consolidados globais (ou filtrados por data se selecionada)
      const kpiDateFilter = (dataFilter && dataFilter !== 'all') ? `WHERE data = '${dataFilter}'` : '';
      const kpisRes = await client.query(`
        SELECT 
          count(*) AS total,
          count(*) FILTER (WHERE LOWER(unidade) LIKE '%paulista%') AS paulista,
          count(*) FILTER (WHERE LOWER(unidade) LIKE '%granja%') AS granja,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%finalizado%' OR LOWER(validacao) LIKE '%validado%') AS validados,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%pendente%' OR validacao IS NULL OR validacao = '') AS pendentes,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%justificada%' OR LOWER(status_agil) LIKE '%justificada%') AS faltas_justificadas,
          count(*) FILTER (WHERE (LOWER(validacao) LIKE '%não compareceu%' OR LOWER(validacao) LIKE '%nao compareceu%' OR LOWER(status_agil) LIKE '%não compareceu%') AND LOWER(validacao) NOT LIKE '%validado%') AS nao_compareceu,
          count(*) FILTER (WHERE LOWER(validacao) LIKE '%cancelado%' OR LOWER(status_agil) LIKE '%desmarcado%') AS cancelados
        FROM public.agendamentos_auditoria
        ${kpiDateFilter};
      `);

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
        taxaConclusao: parseFloat(taxaConclusao)
      };

      // Dias disponíveis
      const diasRes = await client.query(`
        SELECT data, count(*) as count,
               count(*) FILTER (WHERE LOWER(unidade) LIKE '%paulista%') AS paulista,
               count(*) FILTER (WHERE LOWER(unidade) LIKE '%granja%') AS granja
        FROM public.agendamentos_auditoria
        GROUP BY data
        ORDER BY to_date(data, 'DD/MM/YYYY') DESC;
      `);

      // Convênios disponíveis
      const convRes = await client.query(`
        SELECT convenio, count(*) as count
        FROM public.agendamentos_auditoria
        GROUP BY convenio
        ORDER BY count DESC;
      `);

      await client.end();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          total: totalFiltered,
          page,
          limit,
          totalPages: Math.ceil(totalFiltered / limit) || 1,
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

      updateQuery += ` WHERE id = ANY($${pIdx}::bigint[]) RETURNING id, validacao, observacao;`;
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
    // ACTION: IMPORT (Ingestão do arquivo do Ágil)
    // -------------------------------------------------------------
    if (action === 'import') {
      const { rows = [], loteNome = 'Importacao_Manual' } = body;

      if (!rows.length) {
        await client.end();
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Nenhum registro para importar.' })
        };
      }

      let insertedCount = 0;
      let updatedCount = 0;

      for (const r of rows) {
        const data = String(r.data || '').trim();
        const paciente = String(r.paciente || '').trim();
        const horario = String(r.horario || '').trim();
        const status_agil = String(r.status_agil || '').trim();
        const profissional = String(r.profissional || '').trim();
        const especialidade = String(r.especialidade || '').trim();
        const procedimento = String(r.procedimento || '').trim();
        const sessao = String(r.sessao || '').trim();
        const cpf_carteirinha = String(r.cpf_carteirinha || '').trim();
        const guia = String(r.guia || '').trim();
        const situacao = String(r.situacao || '').trim();
        const unidade = (String(r.unidade || '').toUpperCase().includes('GRANJA') ? 'GRANJA VIANA' : 'PAULISTA');
        const convenio = String(r.convenio || 'SEM CONVÊNIO').trim();
        
        // Calcular alertas automáticos se não vier preenchido
        const acao_lembrete = r.acao_lembrete || computeAlerts(sessao, convenio, status_agil, paciente);

        // Status inicial de validação
        let initialValidacao = r.validacao || 'Pendente';
        if (status_agil.toLowerCase().includes('justificada')) {
          initialValidacao = 'Falta Justificada';
        } else if (status_agil.toLowerCase().includes('finalizado')) {
          initialValidacao = 'Finalizado';
        }

        // Verificar se registro já existe para não sobrescrever validação manual (Regra do Prompt Mestre)
        const checkRes = await client.query(`
          SELECT id, validacao, observacao FROM public.agendamentos_auditoria
          WHERE data = $1 AND paciente = $2 AND horario = $3 AND unidade = $4;
        `, [data, paciente, horario, unidade]);

        if (checkRes.rows.length > 0) {
          // Já existe: atualizar mantendo colunas M e N intocadas!
          const existing = checkRes.rows[0];
          await client.query(`
            UPDATE public.agendamentos_auditoria
            SET status_agil = $1, profissional = $2, especialidade = $3, procedimento = $4,
                sessao = $5, cpf_carteirinha = $6, guia = $7, acao_lembrete = $8, situacao = $9,
                convenio = $10, updated_at = NOW()
            WHERE id = $11;
          `, [status_agil, profissional, especialidade, procedimento, sessao, cpf_carteirinha, guia, acao_lembrete, situacao, convenio, existing.id]);
          updatedCount++;
        } else {
          // Inserir novo
          await client.query(`
            INSERT INTO public.agendamentos_auditoria (
              data, paciente, horario, status_agil, profissional, especialidade,
              procedimento, sessao, cpf_carteirinha, guia, acao_lembrete, situacao,
              validacao, observacao, unidade, convenio, lote_importacao
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17);
          `, [
            data, paciente, horario, status_agil, profissional, especialidade,
            procedimento, sessao, cpf_carteirinha, guia, acao_lembrete, situacao,
            initialValidacao, r.observacao || '', unidade, convenio, loteNome
          ]);
          insertedCount++;
        }
      }

      await client.end();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          message: `Importação concluída: ${insertedCount} novos agendamentos inseridos, ${updatedCount} atualizados preservando validações manuais.`,
          insertedCount,
          updatedCount
        })
      };
    }

    // Ação desconhecida
    await client.end();
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Ação inválida: ${action}` }) };

  } catch (err) {
    console.error('[Agendamentos API Error]:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno no servidor: ' + err.message })
    };
  }
};
