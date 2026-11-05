const { Client } = require('pg');

function getPgClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.rqxrphtfjzduzlfnxuax:Creabily312%40@aws-0-us-east-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });
}

function cleanProfName(raw) {
  let s = String(raw || '').replace(/\s*-\s*(CREFITO|CRP|CRN|CRTP).*/i, '').replace(/\s+/g, ' ').trim();
  if (!s || s.toLowerCase() === 'pacote') return '';
  if (s.includes('Suelen Oliveira')) return 'Suelen Oliveira (Psico Tcc)';
  if (s.includes('Beatriz Batista')) return 'Beatriz Batista Santos (Nutri)';
  if (s.includes('Eduardo Nery')) return 'Eduardo Nery (Fisio e Quiro)';
  if (s.includes('Giovanna Barros')) return 'Giovanna Barros Soares (Fisio Granja)';
  if (s.includes('Rubem Porfirio')) return 'Rubem Porfirio (Rpg e Fisio)';
  if (s.includes('Tatiana Matsuda')) return 'Tatiana Matsuda (Fisio e Rpg)';
  if (s.includes('Tatiana Cirillo') || s.includes('Tati Cirillo')) return 'Tatiana Cirillo (Fisio, Drenagem)';
  if (s.includes('Thaynne Araujo') || s.includes('Thaynne Ol')) return 'Thaynne Araujo (Pilates/Fisio)';
  if (s.includes('Jessica Oliveira') || s.includes('Jessica Souza')) return 'Jessica Oliveira de Souza Siqueira (Fisio Granja)';
  if (s.includes('Angela Oliveira')) return 'Angela Oliveira da Silva (Fisio Granja)';
  if (s.includes('Piero Antonaccio')) return 'Piero Antonaccio Grani (Personal)';
  return s;
}

function getShortName(full) {
  const m = String(full || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  const parts = m.split(' ').filter(Boolean);
  if (parts.length <= 2) return m;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function detectUnidadeProf(profName, rawUnidade = '') {
  const u = String(rawUnidade || '').toUpperCase();
  const p = String(profName || '').toLowerCase();
  if (
    u.includes('GRANJA') ||
    p.includes('granja') ||
    p.includes('angela oliveira') ||
    p.includes('giovanna barros') ||
    p.includes('jessica oliveira') ||
    p.includes('piero antonaccio')
  ) {
    return 'Granja/Jandira';
  }
  return 'Paulista';
}

function detectFuncaoProf(profName) {
  const p = String(profName || '').toLowerCase();
  if (p.includes('psico') || p.includes('psican')) return 'Psicólogo(a)';
  if (p.includes('nutri')) return 'Nutricionista';
  if (p.includes('personal')) return 'Personal / Especialista iMotion';
  if (p.includes('osteopata')) return 'Fisioterapeuta e Osteopata';
  if (p.includes('quiro')) return 'Fisioterapeuta e Quiropraxista';
  if (p.includes('pilates')) return 'Fisioterapeuta e Pilates';
  if (p.includes('rpg')) return 'Fisioterapeuta e RPG';
  return 'Fisioterapeuta';
}

function classifyAppointmentRow(row, rules) {
  const prof = cleanProfName(row.profissional);
  const conv = String(row.convenio || '').trim();
  const proc = String(row.procedimento || '').trim();
  const esp = String(row.especialidade || '').trim();
  const combined = `${prof} ${conv} ${proc} ${esp}`.toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Prioridade Máxima: Espaço Uni = R$ 18,00
  if (combined.includes('ESPACO UNI') || combined.includes('PILATESUNI')) {
    return { valor: 18.00, modalidade: 'Pilates Espaço Uni (Prioridade R$ 18)', isParticular: true };
  }

  // 2. Piero Antonaccio Grani (Granja): iMotion Particular = R$ 48, iMotion Convênio = R$ 35, Bota = R$ 20
  if (prof.includes('Piero')) {
    if (combined.includes('BOTA')) {
      return { valor: 20.00, modalidade: 'Bota Pneumática', isParticular: conv.toLowerCase().includes('particular') };
    }
    if (conv.toLowerCase().includes('particular') || combined.includes('PARTICULAR') || combined.includes('ANUAL')) {
      return { valor: 48.00, modalidade: 'Colete iMotion Particular (Plano Anual)', isParticular: true };
    }
    return { valor: 35.00, modalidade: 'Colete iMotion Convênio', isParticular: false };
  }

  // 3. Terapia Neural / Ondas de Choque / Termografia Particular = R$ 140,00
  if (
    (combined.includes('TERAPIA NEURAL') || combined.includes('ONDAS DE CHOQUE') || combined.includes('TERMOGRAFIA')) &&
    (conv.toLowerCase().includes('particular') || combined.includes('PARTICULAR'))
  ) {
    return { valor: 140.00, modalidade: 'Terapia Neural / Termografia / Ondas de Choque (Particular)', isParticular: true };
  }

  // 4. Psicologia & Psicanálise
  if (prof.toLowerCase().includes('psico') || prof.toLowerCase().includes('psican') || combined.includes('PSICOTERAPIA') || combined.includes('PSICANALISE')) {
    if (combined.includes('TRIAGEM') || combined.includes('AVALIACAO INICIAL') || String(row.sessao || '') === '1/1') {
      return { valor: 20.00, modalidade: 'Triagem / Consulta Inicial Psicologia', isParticular: false };
    }
    if (combined.includes('OMINT PREMIUM')) {
      return { valor: 55.00, modalidade: 'Sessão de Psicoterapia (Omint Premium)', isParticular: false };
    }
    if (combined.includes('OMINT CORPORATE')) {
      return { valor: 35.00, modalidade: 'Sessão de Psicoterapia (Omint Corporate)', isParticular: false };
    }
    return {
      valor: 36.00,
      modalidade: 'Sessão de Psicoterapia / Psicanálise',
      isParticular: conv.toLowerCase().includes('particular')
    };
  }

  // 5. Nutrição & Bioimpedância
  if (prof.toLowerCase().includes('nutri') || combined.includes('NUTRICAO') || combined.includes('BIOIMPEDANCIA')) {
    const isPart = conv.toLowerCase().includes('particular');
    if (isPart) {
      if (combined.includes('RETORNO') || combined.includes('DESPARASITACAO')) {
        return { valor: 200.00, modalidade: 'Retorno Nutrição + Bio Particular', isParticular: true };
      }
      if (combined.includes('BIOIMPEDANCIA') && !combined.includes('CONSULTA')) {
        return { valor: 100.00, modalidade: 'Bioimpedância Avulsa Particular', isParticular: true };
      }
      return { valor: 350.00, modalidade: 'Consulta Nutrição + Bio + Cardápio Particular', isParticular: true };
    }
    if (combined.includes('OMINT PREMIUM')) {
      if (combined.includes('BIO')) return { valor: 15.00, modalidade: 'Bioimpedância Omint Premium', isParticular: false };
      return { valor: 45.00, modalidade: 'Consulta Nutrição Omint Premium', isParticular: false };
    }
    if (combined.includes('CARE PLUS')) {
      if (combined.includes('BIO') && !combined.includes('CONSULTA')) return { valor: 20.00, modalidade: 'Bioimpedância Care Plus', isParticular: false };
      return { valor: 47.00, modalidade: 'Consulta Nutrição + Bio Care Plus', isParticular: false };
    }
    if (combined.includes('BIOIMPEDANCIA')) {
      if (combined.includes('AFRESP')) return { valor: 12.00, modalidade: 'Bioimpedância Afresp Saúde', isParticular: false };
      if (combined.includes('AMIL') || combined.includes('LINCX')) return { valor: 25.00, modalidade: 'Bioimpedância Amil/One/Lincx', isParticular: false };
      return { valor: 15.00, modalidade: 'Bioimpedância Convênio', isParticular: false };
    }
    return { valor: 35.00, modalidade: 'Consulta Nutrição Convênio', isParticular: false };
  }

  // 6. Pilates & Total Pass
  if (combined.includes('PILATES') || combined.includes('TOTAL PASS') || combined.includes('38105') || combined.includes('3 FASE')) {
    if (combined.includes('TP7') || combined.includes('38105')) {
      return { valor: 30.00, modalidade: 'Pilates / Eletro Total Pass TP7 (38105)', isParticular: false };
    }
    if (combined.includes('TOTAL PASS') || combined.includes('TP5') || combined.includes('TP6')) {
      return { valor: 20.00, modalidade: 'Pilates Total Pass Padrão', isParticular: false };
    }
    if (combined.includes('OMINT SKILL')) {
      return { valor: 20.00, modalidade: 'Pilates Omint Skill', isParticular: false };
    }
    if (combined.includes('ANUAL') && (conv.toLowerCase().includes('particular') || combined.includes('PARTICULAR'))) {
      return { valor: 25.00, modalidade: 'Pilates Particular Anual', isParticular: true };
    }
    return {
      valor: 30.00,
      modalidade: conv.toLowerCase().includes('particular') ? 'Pilates Particular (Mensal/Trimestral/Semestral)' : 'Pilates Convênio / MedSênior 3ª Fase',
      isParticular: conv.toLowerCase().includes('particular')
    };
  }

  // 7. Fisioterapia, RPG, Quiropraxia, Osteopatia, MedSênior
  if (combined.includes('MEDSENIOR') || combined.includes('MED SENIOR') || combined.includes('1 FASE') || combined.includes('2 FASE')) {
    return { valor: 45.00, modalidade: 'MedSênior — 1ª e 2ª Fase (Fisio Individual/Dupla)', isParticular: false };
  }
  if (combined.includes('OMINT PREMIUM') || combined.includes('OMINT CORPORATE') || combined.includes('CREABILY ESPECIAL')) {
    if (combined.includes('RPG') || combined.includes('ACUPUNTURA') || combined.includes('SHIATSU')) {
      return { valor: 50.00, modalidade: 'RPG / Acupuntura / Shiatsu (Omint / Especial)', isParticular: false };
    }
    return { valor: 45.00, modalidade: 'Fisioterapia Omint Premium / Corporate / Especial', isParticular: false };
  }
  if (combined.includes('OMINT SKILL')) {
    if (combined.includes('QUIRO') || combined.includes('OSTEO')) {
      return { valor: 45.00, modalidade: 'Quiropraxia / Osteopatia Omint Skill', isParticular: false };
    }
    return { valor: 20.00, modalidade: 'Fisioterapia / Avaliação Omint Skill', isParticular: false };
  }
  if (conv.toLowerCase().includes('particular') || combined.includes('PLANO FISIO 24') || combined.includes('PLANO FISIO 48')) {
    if (combined.includes('RPG') || combined.includes('QUIRO') || combined.includes('OSTEO') || combined.includes('ACUPUNTURA')) {
      return { valor: 100.00, modalidade: 'RPG / Quiropraxia / Osteopatia Particular', isParticular: true };
    }
    return { valor: 75.00, modalidade: 'Fisioterapia / DLM / Plano 24 ou 48 Sessões Particular', isParticular: true };
  }
  if (combined.includes('BOTA') || combined.includes('MAGNETO') || combined.includes('OZONIO')) {
    return { valor: 20.00, modalidade: 'Bota Pneumática / Magnetoterapia / Terapia Extra', isParticular: false };
  }
  if (combined.includes('AVALIACAO') || combined.includes('CONSULTA INICIAL') || combined.includes('50000144')) {
    return { valor: 20.00, modalidade: 'Avaliação Inicial Fisioterapia Convênio', isParticular: false };
  }

  return { valor: 35.00, modalidade: 'Fisioterapia / RPG / Drenagem Convênio', isParticular: false };
}

async function computeCompetenciaFromAgil(client, competencia, rules) {
  const res = await client.query(`
    SELECT data, horario, paciente, convenio, profissional, procedimento, especialidade, sessao, status_agil, unidade
    FROM public.agendamentos_auditoria
    WHERE data LIKE $1
    ORDER BY to_date(CASE WHEN data ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN data ELSE '01/10/2026' END, 'DD/MM/YYYY') ASC, id ASC
  `, [`%/${competencia}`]);

  const byProf = new Map();
  for (const r of res.rows) {
    const pName = cleanProfName(r.profissional);
    if (!pName) continue;
    const stLow = String(r.status_agil || '').toLowerCase();
    if (stLow.includes('cancelado') || stLow.includes('desmarcado') || stLow.includes('justificada')) {
      continue;
    }
    const isFalta = stLow.includes('compareceu');
    const cls = classifyAppointmentRow(r, rules);
    const unidade = detectUnidadeProf(pName, r.unidade);

    if (!byProf.has(pName)) {
      byProf.set(pName, {
        competencia,
        profissional: pName,
        nome_curto: getShortName(pName),
        funcao: detectFuncaoProf(pName),
        unidade,
        atendimentos_total: 0,
        finalizados: 0,
        nao_compareceu: 0,
        pendentes_regra: 0,
        capacidade_agenda: 140,
        valor_repasse_calculado: 0,
        valor_repasse_confirmado: 0,
        valor_particular: 0,
        valor_convenio: 0,
        status_auditoria: 'CONFERIDO',
        observacao_auditoria: `Calculado automaticamente pela Agenda Ágil (${competencia}) aplicando a Tabela Oficial de Honorários Fixa.`,
        compMap: new Map(),
        convMap: new Map(),
        atendimentos: []
      });
    }

    const entry = byProf.get(pName);
    entry.atendimentos_total += 1;
    if (isFalta) entry.nao_compareceu += 1;
    else entry.finalizados += 1;

    entry.valor_repasse_calculado += cls.valor;
    entry.valor_repasse_confirmado += cls.valor;
    if (cls.isParticular) entry.valor_particular += cls.valor;
    else entry.valor_convenio += cls.valor;

    const compKey = `${cls.modalidade}||${cls.valor}`;
    if (!entry.compMap.has(compKey)) {
      entry.compMap.set(compKey, {
        modalidade: cls.modalidade,
        convenio: r.convenio || 'Convênio',
        qtd: 0,
        finalizados: 0,
        faltas: 0,
        unitario: cls.valor,
        total: 0
      });
    }
    const cm = entry.compMap.get(compKey);
    cm.qtd += 1;
    if (isFalta) cm.faltas += 1;
    else cm.finalizados += 1;
    cm.total += cls.valor;

    const convName = r.convenio || 'Convênio';
    if (!entry.convMap.has(convName)) {
      entry.convMap.set(convName, { convenio: convName, qtd: 0, total: 0 });
    }
    const cv = entry.convMap.get(convName);
    cv.qtd += 1;
    cv.total += cls.valor;

    if (entry.atendimentos.length < 80) {
      entry.atendimentos.push({
        data: r.data,
        paciente: r.paciente || 'Paciente Creabily',
        convenio: r.convenio || 'Convênio',
        procedimento: cls.modalidade,
        status: isFalta ? 'Não compareceu' : 'Finalizado',
        unitario: cls.valor,
        observacao: 'Tabela Oficial'
      });
    }
  }

  for (const entry of byProf.values()) {
    const composicao_json = Array.from(entry.compMap.values());
    const convenios_json = Array.from(entry.convMap.values());
    await client.query(`
      INSERT INTO public.fechamento_profissionais_mensal (
        competencia, profissional, nome_curto, funcao, unidade,
        atendimentos_total, finalizados, nao_compareceu, pendentes_regra, capacidade_agenda,
        valor_repasse_calculado, valor_repasse_confirmado, valor_particular, valor_convenio,
        status_auditoria, observacao_auditoria, composicao_json, convenios_json, atendimentos_json
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, 0, $9,
        $10, $11, $12, $13,
        $14, $15, $16::jsonb, $17::jsonb, $18::jsonb
      )
      ON CONFLICT (competencia, profissional, unidade) DO UPDATE SET
        atendimentos_total = EXCLUDED.atendimentos_total,
        finalizados = EXCLUDED.finalizados,
        nao_compareceu = EXCLUDED.nao_compareceu,
        valor_repasse_calculado = EXCLUDED.valor_repasse_calculado,
        valor_repasse_confirmado = EXCLUDED.valor_repasse_confirmado,
        valor_particular = EXCLUDED.valor_particular,
        valor_convenio = EXCLUDED.valor_convenio,
        composicao_json = EXCLUDED.composicao_json,
        convenios_json = EXCLUDED.convenios_json,
        atendimentos_json = EXCLUDED.atendimentos_json,
        updated_at = NOW();
    `, [
      entry.competencia, entry.profissional, entry.nome_curto, entry.funcao, entry.unidade,
      entry.atendimentos_total, entry.finalizados, entry.nao_compareceu, entry.capacidade_agenda,
      entry.valor_repasse_calculado, entry.valor_repasse_confirmado, entry.valor_particular, entry.valor_convenio,
      entry.status_auditoria, entry.observacao_auditoria,
      JSON.stringify(composicao_json), JSON.stringify(convenios_json), JSON.stringify(entry.atendimentos)
    ]);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    body = {};
  }

  const action = body.action || (event.queryStringParameters && event.queryStringParameters.action) || 'list';
  const competencia = String(body.competencia || (event.queryStringParameters && event.queryStringParameters.competencia) || '10/2026').trim();

  const client = getPgClient();
  try {
    await client.connect();

    if (action === 'view_recibo') {
      const token = String((event.queryStringParameters && event.queryStringParameters.token) || body.token || '').trim();
      const recRes = await client.query(`
        SELECT r.*, p.funcao, p.atendimentos_total, p.finalizados, p.nao_compareceu, p.valor_repasse_confirmado,
               p.valor_particular, p.valor_convenio, p.composicao_json, p.observacao_auditoria
        FROM public.fechamento_recibos_contabilidade r
        LEFT JOIN public.fechamento_profissionais_mensal p ON p.id = r.profissional_id
        WHERE r.token = $1
        LIMIT 1
      `, [token]);

      if (recRes.rows.length === 0) {
        return {
          statusCode: 404,
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
          body: '<h3>Recibo não encontrado.</h3>'
        };
      }

      const rec = recRes.rows[0];
      const valorFinal = Number(rec.valor_liquido_recibo || rec.valor_repasse_confirmado || 0);
      const compList = Array.isArray(rec.composicao_json) ? rec.composicao_json : [];

      const htmlPage = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recibo & Demonstrativo Individual - ${rec.nome_curto || rec.profissional_nome} (${rec.competencia})</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    body { margin: 0; padding: 20px; background: #F4F1F8; color: #1F2933; }
    .sheet { max-width: 820px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 26px; box-shadow: 0 10px 30px rgba(73,52,119,0.12); border-top: 6px solid #493477; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: #1F2933; color: #fff; padding: 10px 16px; border-radius: 10px; }
    .header { background: #493477; color: #fff; padding: 18px 22px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 5px solid #1DAAA9; }
    .header h1 { margin: 0; font-size: 18px; }
    .header .sub { margin-top: 4px; font-size: 12.5px; color: #E2DCF0; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0; }
    .kpi { background: #F4F1F8; border: 1px solid #D8CEE8; border-top: 3px solid #493477; border-radius: 8px; padding: 10px 12px; }
    .kpi .lbl { font-size: 10px; text-transform: uppercase; color: #667085; font-weight: 700; }
    .kpi .val { font-size: 18px; font-weight: 800; color: #493477; margin-top: 4px; }
    .sec { background: #493477; color: #fff; padding: 7px 12px; font-size: 11.5px; font-weight: 800; border-radius: 6px; margin: 16px 0 8px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 12px; }
    th { background: #E8F6F6; padding: 7px 8px; border: 1px solid #D8D2E5; text-align: left; }
    td { padding: 6px 8px; border: 1px solid #D8D2E5; }
    .cropped-box { border: 2px solid #1DAAA9; border-radius: 10px; padding: 14px; background: #FAF9FC; margin: 14px 0; text-align: center; }
    .cropped-box img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #D8D2E5; }
    @media print { .no-print { display: none !important; } body { background: #fff; padding: 0; } .sheet { box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="top-bar no-print">
      <span>📄 <b>Recibo Individual &amp; Demonstrativo Creabily</b> (${rec.competencia})</span>
      <button onclick="window.print()" style="background:#1DAAA9; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:800; cursor:pointer;">🖨️ Baixar PDF / Imprimir</button>
    </div>
    <div class="header">
      <div>
        <h1>CREABILY ARTE DA CURA — RECIBO &amp; FECHAMENTO INDIVIDUAL</h1>
        <div class="sub">${rec.profissional_nome} • Competência ${rec.competencia} • Unidade ${rec.unidade || 'Paulista'}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px; color:#E2DCF0;">Origem</div>
        <div style="font-size:12px; font-weight:800; color:#1DAAA9; background:#fff; padding:3px 10px; border-radius:999px; margin-top:3px;">${rec.pagina_aba_origem || 'Recibo Individual'}</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="lbl">Atendimentos no Mês</div><div class="val">${rec.atendimentos_total || 0}</div></div>
      <div class="kpi"><div class="lbl">Finalizados</div><div class="val" style="color:#16A34A;">${rec.finalizados || 0}</div></div>
      <div class="kpi"><div class="lbl">Não Compareceu (Pago)</div><div class="val" style="color:#D97706;">${rec.nao_compareceu || 0}</div></div>
      <div class="kpi" style="background:#E8F6F6; border-top-color:#1DAAA9;"><div class="lbl" style="color:#0F766E;">Valor do Recibo / Repasse</div><div class="val" style="color:#0F766E;">R$ ${valorFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
    </div>

    ${rec.imagem_data_url ? `
      <div class="sec">Recibo Oficial da Contabilidade (Recorte Individual — ${rec.pagina_aba_origem || 'Folha'})</div>
      <div class="cropped-box">
        <img src="${rec.imagem_data_url}" alt="Recibo Recortado da Contabilidade">
      </div>
    ` : ''}

    ${rec.conteudo_html ? `
      <div class="sec">Espelho do Recibo da Contabilidade (${rec.pagina_aba_origem || 'Aba Individual'})</div>
      <div style="overflow-x:auto; background:#FAF9FC; border:1px solid #D8CEE8; border-radius:8px; padding:10px; margin-bottom:14px;">
        ${rec.conteudo_html}
      </div>
    ` : ''}

    ${compList.length > 0 ? `
      <div class="sec">Composição Detalhada dos Atendimentos (${rec.competencia})</div>
      <table>
        <thead>
          <tr><th>Modalidade / Procedimento</th><th>Convênio</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Unitário</th><th style="text-align:right;">Total (R$)</th></tr>
        </thead>
        <tbody>
          ${compList.map(c => `
            <tr>
              <td style="font-weight:700;">${c.modalidade || ''}</td>
              <td>${c.convenio || ''}</td>
              <td style="text-align:center;">${c.qtd || 0}</td>
              <td style="text-align:right;">R$ ${(Number(c.unitario) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
              <td style="text-align:right; font-weight:700;">R$ ${(Number(c.total) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}

    <div style="background:#F4F1F8; border-left:4px solid #1DAAA9; padding:10px 14px; border-radius:6px; font-size:11.5px;">
      <b>Observação:</b> ${rec.resumo_recibo || rec.observacao_auditoria || 'Conferência individual emitida pelo Sistema Executivo Creabily.'}
    </div>
  </div>
</body>
</html>`;

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlPage
      };
    }

    if (action === 'list') {
      const rulesRes = await client.query(`
        SELECT * FROM public.fechamento_regras_honorarios
        ORDER BY area ASC, prioridade DESC, id ASC
      `);
      const rules = rulesRes.rows;

      let profsRes = await client.query(`
        SELECT * FROM public.fechamento_profissionais_mensal
        WHERE competencia = $1
        ORDER BY unidade DESC, nome_curto ASC
      `, [competencia]);

      if (profsRes.rows.length === 0) {
        await computeCompetenciaFromAgil(client, competencia, rules);
        profsRes = await client.query(`
          SELECT * FROM public.fechamento_profissionais_mensal
          WHERE competencia = $1
          ORDER BY unidade DESC, nome_curto ASC
        `, [competencia]);
      }

      // Garantir que cada profissional da competência tenha um registro de recibo individual pronto
      for (const p of profsRes.rows) {
        const tok = `rec_${competencia.replace('/', '')}_prof_${p.id}`;
        const rep = Number(p.valor_repasse_confirmado) || 0;
        const resTxt = `${p.atendimentos_total} atendimentos (${p.finalizados} finalizados / ${p.nao_compareceu} faltas) • Repasse: R$ ${rep.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        await client.query(`
          INSERT INTO public.fechamento_recibos_contabilidade (
            token, competencia, profissional_id, profissional_nome, nome_curto, unidade,
            telefone_whatsapp, origem_arquivo, pagina_aba_origem, valor_liquido_recibo,
            resumo_recibo, status_envio
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Demonstrativo Oficial Creabily', $8, $9, $10, 'PRONTO')
          ON CONFLICT (token) DO UPDATE SET
            telefone_whatsapp = COALESCE(NULLIF(EXCLUDED.telefone_whatsapp, ''), public.fechamento_recibos_contabilidade.telefone_whatsapp),
            valor_liquido_recibo = CASE WHEN public.fechamento_recibos_contabilidade.origem_arquivo = 'Demonstrativo Oficial Creabily' THEN EXCLUDED.valor_liquido_recibo ELSE public.fechamento_recibos_contabilidade.valor_liquido_recibo END
        `, [
          tok, competencia, p.id, p.profissional, p.nome_curto, p.unidade,
          p.telefone_whatsapp || '', `Demonstrativo #${p.id}`, rep, resTxt
        ]);
      }

      const recibosRes = await client.query(`
        SELECT id, token, competencia, profissional_id, profissional_nome, nome_curto, unidade,
               telefone_whatsapp, origem_arquivo, pagina_aba_origem, valor_liquido_recibo,
               resumo_recibo, status_envio, enviado_em,
               (CASE WHEN imagem_data_url IS NOT NULL AND imagem_data_url <> '' THEN true ELSE false END) as tem_imagem,
               (CASE WHEN conteudo_html IS NOT NULL AND conteudo_html <> '' THEN true ELSE false END) as tem_planilha
        FROM public.fechamento_recibos_contabilidade
        WHERE competencia = $1
        ORDER BY unidade DESC, nome_curto ASC
      `, [competencia]);

      let bpoRes = await client.query(`
        SELECT * FROM public.fechamento_bpo_mensal WHERE competencia = $1
      `, [competencia]);
      if (bpoRes.rows.length === 0) {
        await client.query(`
          INSERT INTO public.fechamento_bpo_mensal (competencia, faturamento_bruto_estimado, receita_particular, receita_convenios, impostos_nf_pct, custos_fixos_paulista, custos_fixos_granja, custos_variaveis_operacionais, meta_margem_liquida_pct)
          VALUES ($1, 206250.00, 64250.00, 142000.00, 16.00, 36459.00, 18500.00, 10000.00, 20.00)
          ON CONFLICT (competencia) DO NOTHING
        `, [competencia]);
        bpoRes = await client.query(`SELECT * FROM public.fechamento_bpo_mensal WHERE competencia = $1`, [competencia]);
      }

      const countsRes = await client.query(`
        SELECT competencia, COUNT(*) as profs, SUM(atendimentos_total) as atendimentos, SUM(valor_repasse_confirmado) as repasse
        FROM public.fechamento_profissionais_mensal
        GROUP BY competencia
      `);
      const compCounts = {};
      for (const r of countsRes.rows) {
        compCounts[r.competencia] = {
          profs: parseInt(r.profs, 10) || 0,
          atendimentos: parseInt(r.atendimentos, 10) || 0,
          repasse: parseFloat(r.repasse) || 0
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          data: {
            competencia,
            profissionais: profsRes.rows,
            recibos: recibosRes.rows,
            regras: rules,
            bpo: bpoRes.rows[0] || {},
            compCounts
          }
        })
      };
    }

    if (action === 'save_whatsapp_prof') {
      const profId = parseInt(body.profissional_id, 10);
      const profNome = String(body.profissional_nome || '').trim();
      const phone = String(body.telefone_whatsapp || '').replace(/\D/g, '');
      if (profId) {
        await client.query(`UPDATE public.fechamento_profissionais_mensal SET telefone_whatsapp = $1, updated_at = NOW() WHERE id = $2 OR profissional = $3`, [phone, profId, profNome]);
        await client.query(`UPDATE public.fechamento_recibos_contabilidade SET telefone_whatsapp = $1, updated_at = NOW() WHERE profissional_id = $2 OR profissional_nome = $3`, [phone, profId, profNome]);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, telefone_whatsapp: phone }) };
    }

    if (action === 'save_recibo_recortado') {
      const r = body.recibo || {};
      const tok = `rec_${competencia.replace('/', '')}_prof_${r.profissional_id}`;
      await client.query(`
        UPDATE public.fechamento_recibos_contabilidade
        SET origem_arquivo = $1,
            pagina_aba_origem = $2,
            valor_liquido_recibo = COALESCE($3, valor_liquido_recibo),
            resumo_recibo = COALESCE(NULLIF($4, ''), resumo_recibo),
            conteudo_html = COALESCE(NULLIF($5, ''), conteudo_html),
            imagem_data_url = COALESCE(NULLIF($6, ''), imagem_data_url),
            status_envio = 'RECORTADO_CONTABILIDADE',
            updated_at = NOW()
        WHERE token = $7
      `, [
        r.origem_arquivo || 'Folha Contabilidade',
        r.pagina_aba_origem || 'Página Recortada',
        r.valor_liquido_recibo ? parseFloat(r.valor_liquido_recibo) : null,
        r.resumo_recibo || '',
        r.conteudo_html || '',
        r.imagem_data_url || '',
        tok
      ]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token: tok }) };
    }

    if (action === 'mark_recibo_enviado') {
      const tok = String(body.token || '').trim();
      await client.query(`
        UPDATE public.fechamento_recibos_contabilidade
        SET status_envio = 'ENVIADO_WHATSAPP',
            enviado_em = NOW(),
            updated_at = NOW()
        WHERE token = $1
      `, [tok]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'toggle_angela_outubro') {
      const modo = body.modo === 'recalculado_7062' ? 'recalculado_7062' : 'confirmado_3442';
      const novoValor = modo === 'recalculado_7062' ? 7062.00 : 3442.00;
      const novoStatus = modo === 'recalculado_7062' ? 'VALIDADO DIRETORIA' : 'CONFERIDO';
      await client.query(`
        UPDATE public.fechamento_profissionais_mensal
        SET valor_repasse_confirmado = $1,
            status_auditoria = $2,
            updated_at = NOW()
        WHERE competencia = '10/2026' AND profissional ILIKE '%Angela Oliveira%'
      `, [novoValor, novoStatus]);

      await client.query(`
        UPDATE public.fechamento_bpo_mensal
        SET modo_angela_outubro = $1, updated_at = NOW()
        WHERE competencia = '10/2026'
      `, [modo]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, modo, valor: novoValor })
      };
    }

    if (action === 'save_prof') {
      const p = body.prof || {};
      if (p.id) {
        await client.query(`
          UPDATE public.fechamento_profissionais_mensal
          SET nome_curto = $1,
              funcao = $2,
              unidade = $3,
              atendimentos_total = $4,
              finalizados = $5,
              nao_compareceu = $6,
              capacidade_agenda = $7,
              valor_repasse_confirmado = $8,
              valor_particular = $9,
              valor_convenio = $10,
              status_auditoria = $11,
              observacao_auditoria = $12,
              updated_at = NOW()
          WHERE id = $13
        `, [
          p.nome_curto, p.funcao, p.unidade,
          parseInt(p.atendimentos_total, 10) || 0,
          parseInt(p.finalizados, 10) || 0,
          parseInt(p.nao_compareceu, 10) || 0,
          parseInt(p.capacidade_agenda, 10) || 120,
          parseFloat(p.valor_repasse_confirmado) || 0,
          parseFloat(p.valor_particular) || 0,
          parseFloat(p.valor_convenio) || 0,
          p.status_auditoria || 'VALIDADO DIRETORIA',
          p.observacao_auditoria || '',
          p.id
        ]);
      } else {
        await client.query(`
          INSERT INTO public.fechamento_profissionais_mensal (
            competencia, profissional, nome_curto, funcao, unidade,
            atendimentos_total, finalizados, nao_compareceu, capacidade_agenda,
            valor_repasse_calculado, valor_repasse_confirmado, valor_particular, valor_convenio,
            status_auditoria, observacao_auditoria
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14)
        `, [
          competencia, p.profissional || p.nome_curto, p.nome_curto, p.funcao || 'Fisioterapeuta', p.unidade || 'Paulista',
          parseInt(p.atendimentos_total, 10) || 0,
          parseInt(p.finalizados, 10) || 0,
          parseInt(p.nao_compareceu, 10) || 0,
          parseInt(p.capacidade_agenda, 10) || 120,
          parseFloat(p.valor_repasse_confirmado) || 0,
          parseFloat(p.valor_particular) || 0,
          parseFloat(p.valor_convenio) || 0,
          p.status_auditoria || 'VALIDADO DIRETORIA',
          p.observacao_auditoria || ''
        ]);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'save_regra') {
      const r = body.regra || {};
      if (r.id) {
        await client.query(`
          UPDATE public.fechamento_regras_honorarios
          SET area = $1,
              profissional = $2,
              unidade = $3,
              convenio = $4,
              procedimento_padrao = $5,
              palavras_chave = $6,
              valor_repasse = $7,
              prioridade = $8,
              observacao = $9,
              updated_at = NOW()
          WHERE id = $10
        `, [
          r.area || 'Fisioterapia',
          r.profissional || 'TODOS',
          r.unidade || 'TODAS',
          r.convenio || 'Todos os Convênios',
          r.procedimento_padrao || '',
          r.palavras_chave || '',
          parseFloat(r.valor_repasse) || 0,
          parseInt(r.prioridade, 10) || 80,
          r.observacao || '',
          r.id
        ]);
      } else {
        await client.query(`
          INSERT INTO public.fechamento_regras_honorarios
            (area, profissional, unidade, convenio, procedimento_padrao, palavras_chave, valor_repasse, prioridade, pagar_falta, observacao)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
        `, [
          r.area || 'Fisioterapia',
          r.profissional || 'TODOS',
          r.unidade || 'TODAS',
          r.convenio || 'Todos os Convênios',
          r.procedimento_padrao || '',
          r.palavras_chave || '',
          parseFloat(r.valor_repasse) || 0,
          parseInt(r.prioridade, 10) || 80,
          r.observacao || ''
        ]);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'delete_regra') {
      await client.query(`DELETE FROM public.fechamento_regras_honorarios WHERE id = $1`, [body.id]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'save_bpo') {
      const b = body.bpo || {};
      await client.query(`
        INSERT INTO public.fechamento_bpo_mensal (
          competencia, faturamento_bruto_estimado, receita_particular, receita_convenios,
          impostos_nf_pct, custos_fixos_paulista, custos_fixos_granja, custos_variaveis_operacionais,
          meta_faturamento, meta_margem_liquida_pct, observacoes_diretoria, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (competencia) DO UPDATE SET
          faturamento_bruto_estimado = EXCLUDED.faturamento_bruto_estimado,
          receita_particular = EXCLUDED.receita_particular,
          receita_convenios = EXCLUDED.receita_convenios,
          impostos_nf_pct = EXCLUDED.impostos_nf_pct,
          custos_fixos_paulista = EXCLUDED.custos_fixos_paulista,
          custos_fixos_granja = EXCLUDED.custos_fixos_granja,
          custos_variaveis_operacionais = EXCLUDED.custos_variaveis_operacionais,
          meta_faturamento = EXCLUDED.meta_faturamento,
          meta_margem_liquida_pct = EXCLUDED.meta_margem_liquida_pct,
          observacoes_diretoria = EXCLUDED.observacoes_diretoria,
          updated_at = NOW()
      `, [
        competencia,
        parseFloat(b.faturamento_bruto_estimado) || 0,
        parseFloat(b.receita_particular) || 0,
        parseFloat(b.receita_convenios) || 0,
        parseFloat(b.impostos_nf_pct) || 6,
        parseFloat(b.custos_fixos_paulista) || 28500,
        parseFloat(b.custos_fixos_granja) || 14200,
        parseFloat(b.custos_variaveis_operacionais) || 6800,
        parseFloat(b.meta_faturamento) || 240000,
        parseFloat(b.meta_margem_liquida_pct) || 25,
        b.observacoes_diretoria || ''
      ]);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'recalcular_agil') {
      const rulesRes = await client.query(`SELECT * FROM public.fechamento_regras_honorarios ORDER BY prioridade DESC`);
      if (competencia !== '10/2026' || body.forceFromAgil) {
        await computeCompetenciaFromAgil(client, competencia, rulesRes.rows);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'verify_pin' || action === 'change_pin') {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.fechamento_config_diretoria (
          id INT PRIMARY KEY DEFAULT 1,
          pin_diretoria TEXT NOT NULL DEFAULT '3120',
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        INSERT INTO public.fechamento_config_diretoria (id, pin_diretoria)
        VALUES (1, '3120')
        ON CONFLICT (id) DO NOTHING;
      `);

      const cfgRes = await client.query(`SELECT pin_diretoria FROM public.fechamento_config_diretoria WHERE id = 1`);
      const storedPin = String((cfgRes.rows[0] && cfgRes.rows[0].pin_diretoria) || '3120').trim();

      if (action === 'verify_pin') {
        const inputPin = String(body.pin || '').trim();
        const isValid = inputPin.length > 0 && inputPin === storedPin;
        if (!isValid) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'PIN incorreto.' }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'change_pin') {
        const curPin = String(body.currentPin || '').trim();
        const newPin = String(body.newPin || '').trim();
        if (curPin !== storedPin) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'A senha/PIN atual informada está incorreta.' }) };
        }
        if (newPin.length < 4) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'O novo PIN/senha deve ter pelo menos 4 caracteres.' }) };
        }
        await client.query(`
          UPDATE public.fechamento_config_diretoria
          SET pin_diretoria = $1, updated_at = NOW()
          WHERE id = 1
        `, [newPin]);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Ação inválida' }) };
  } catch (err) {
    console.error('Erro fechamento-profissionais:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  } finally {
    try { await client.end(); } catch (_) {}
  }
};
