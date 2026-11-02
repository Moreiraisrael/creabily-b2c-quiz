const { Client } = require('pg');

function getPgClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.rqxrphtfjzduzlfnxuax:Creabily312%40@aws-0-us-east-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });
}

function normalizeName(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSameBeneficiario(nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  const pA = a.split(' ').filter(Boolean);
  const pB = b.split(' ').filter(Boolean);
  if (pA.length < 2 || pB.length < 2) return false;
  if (pA[0] !== pB[0]) return false;
  const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const sA = pA.filter(w => !stop.has(w));
  const sB = pB.filter(w => !stop.has(w));
  if (sA.length >= 2 && sB.length >= 2) {
    if (sA.every(w => sB.includes(w)) || sB.every(w => sA.includes(w))) return true;
  }
  return false;
}

function normalizeDateBR(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.toUpperCase().includes('ILEG')) return 'ILEGÍVEL';
  const m1 = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m1) {
    const dd = m1[1].padStart(2, '0');
    const mm = m1[2].padStart(2, '0');
    let yyyy = m1[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    return `${dd}/${mm}/${yyyy}`;
  }
  const m2 = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) {
    return `${m2[3].padStart(2, '0')}/${m2[2].padStart(2, '0')}/${m2[1]}`;
  }
  return s.slice(0, 20);
}

function parseDateBRToTime(dStr) {
  const m = String(dStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
}

function extractSadtNumber(rawGuia) {
  const s = String(rawGuia || '').trim();
  if (!s || s === '—') return '';
  const m = s.match(/(\d{6,12})/);
  return m ? m[1] : s;
}

function detectFaseBloco(rawFase, rawGuia) {
  const combined = `${rawFase || ''} ${rawGuia || ''}`.toUpperCase();
  if (combined.includes('3/3') || combined.includes('3ª') || combined.includes('3A') || combined.includes('FASE 3')) {
    return '3ª Fase (Sessões 17 a 24 • GUIA 3/3)';
  }
  if (combined.includes('2/3') || combined.includes('2ª') || combined.includes('2A') || combined.includes('FASE 2')) {
    return '2ª Fase (Sessões 9 a 16 • GUIA 2/3)';
  }
  return '1ª Fase (Sessões 1 a 8 • GUIA 1/3)';
}

// Regra de Cálculo Interno Creabily (Seção 5 do Prompt Mestre)
function calcularValoresMedSenior(sessoesConfirmadas, validadoContratual = false) {
  const n = Math.max(0, Math.min(8, parseInt(sessoesConfirmadas, 10) || 0));
  const valorProposto = 880.00;
  let valorRegraInterna = 0;
  if (n === 1) valorRegraInterna = 110.00;
  else if (n === 2) valorRegraInterna = 220.00;
  else if (n === 3) valorRegraInterna = 330.00;
  else if (n >= 4 && n <= 8) valorRegraInterna = 880.00;

  const requerValidacaoContratual = (n >= 4 && n <= 7);
  // Se tiver 4 a 7 sessões e ainda não teve validação contratual expressa, mantém separado como pendente de validação
  const valorAuditado = (requerValidacaoContratual && !validadoContratual)
    ? valorRegraInterna
    : valorRegraInterna;

  return {
    valorProposto,
    valorRegraInterna,
    valorAuditado,
    requerValidacaoContratual
  };
}

// Audita uma Guia SADT confrontando com os registros do Ágil (Seções 3, 4, 5, 7 e 8 do Prompt Mestre)
function auditarGuiaContraAgil(guiaRow, agilRowsForPatient, duplicateSadtCount = 1) {
  const beneficiario = String(guiaRow.beneficiario || '').trim().toUpperCase();
  const numeroSadt = String(guiaRow.numero_sadt || '').trim();
  const validadeGuia = normalizeDateBR(guiaRow.validade_guia);
  const validadeTime = parseDateBRToTime(validadeGuia);
  const validadoContratual = Boolean(guiaRow.validado_contratual);
  const statusManual = String(guiaRow.status_auditoria || '').toUpperCase();

  const sList = [
    normalizeDateBR(guiaRow.sessao_1),
    normalizeDateBR(guiaRow.sessao_2),
    normalizeDateBR(guiaRow.sessao_3),
    normalizeDateBR(guiaRow.sessao_4),
    normalizeDateBR(guiaRow.sessao_5),
    normalizeDateBR(guiaRow.sessao_6),
    normalizeDateBR(guiaRow.sessao_7),
    normalizeDateBR(guiaRow.sessao_8)
  ];

  // Mapear datas do Ágil para este paciente
  const agilByDate = new Map();
  for (const ar of (agilRowsForPatient || [])) {
    const dNorm = normalizeDateBR(ar.data);
    if (!dNorm) continue;
    const stLow = `${ar.status_agil || ''} ${ar.validacao || ''}`.toLowerCase();
    const isCanceladoOuFalta =
      (stLow.includes('cancelado') || stLow.includes('desmarcado') || stLow.includes('justificada') || stLow.includes('não compareceu') || stLow.includes('nao compareceu')) &&
      !stLow.includes('validado');
    agilByDate.set(dNorm, {
      data: dNorm,
      sessao: ar.sessao || '',
      guia: ar.guia || '',
      status_agil: ar.status_agil || '',
      validacao: ar.validacao || '',
      realizada: !isCanceladoOuFalta,
      canceladaOuFalta: isCanceladoOuFalta
    });
  }

  const pendencias = [];
  const sessoesDetalhe = [];
  let sessoesPreenchidasSadt = 0;
  let sessoesConfirmadas = 0;
  const seenDatesInGuide = new Set();

  // 1. Verificar Número SADT
  if (!numeroSadt || numeroSadt === 'SEM_SADT' || numeroSadt.length < 5) {
    pendencias.push({
      beneficiario,
      numero_sadt: numeroSadt || 'NÃO INFORMADO',
      categoria: 'Número SADT inconsistente',
      descricao: 'Guia sem número SP/SADT definitivo registrado (consta apenas senha ou em branco no Ágil).',
      acao_necessaria: 'Conferir guia física/PDF SP/SADT e preencher o Nº SADT de 8 dígitos.'
    });
  }

  // 2. Verificar Duplicidade de Guia
  if (duplicateSadtCount > 1 && numeroSadt && numeroSadt !== 'SEM_SADT') {
    pendencias.push({
      beneficiario,
      numero_sadt: numeroSadt,
      categoria: 'Guia duplicada',
      descricao: `O número SADT ${numeroSadt} aparece em ${duplicateSadtCount} linhas na mesma competência.`,
      acao_necessaria: 'Unificar em uma única linha por guia SADT distinta para evitar cobrança duplicada.'
    });
  }

  // 3. Conferir cada uma das 8 sessões
  for (let i = 0; i < 8; i++) {
    const numSess = i + 1;
    const dSadt = sList[i];
    if (!dSadt) {
      sessoesDetalhe.push({ numero: numSess, data: '', status: 'VAZIA', motivo: '' });
      continue;
    }

    if (dSadt === 'ILEGÍVEL') {
      pendencias.push({
        beneficiario,
        numero_sadt: numeroSadt || '—',
        categoria: 'Data manuscrita ilegível',
        descricao: `Data manuscrita ilegível na ${numSess}ª sessão da guia SADT.`,
        acao_necessaria: `Conferir assinatura física na guia SADT (${numSess}ª sessão) e confrontar com o histórico do paciente no Ágil.`
      });
      sessoesDetalhe.push({ numero: numSess, data: 'ILEGÍVEL', status: 'ILEGÍVEL', motivo: 'Data manuscrita ilegível na guia SADT' });
      continue;
    }

    sessoesPreenchidasSadt++;

    // Duplicidade de data na mesma guia
    if (seenDatesInGuide.has(dSadt)) {
      pendencias.push({
        beneficiario,
        numero_sadt: numeroSadt || '—',
        categoria: 'Quantidade de sessões divergente',
        descricao: `A data ${dSadt} foi repetida em mais de um campo manuscrito na mesma guia (${numSess}ª sessão).`,
        acao_necessaria: 'Verificar na guia SADT se houve erro de preenchimento manuscrito da data pelo paciente.'
      });
    }
    seenDatesInGuide.add(dSadt);

    // Verificar validade da autorização (quando informada)
    const dTime = parseDateBRToTime(dSadt);
    if (validadeTime && dTime && dTime > validadeTime) {
      pendencias.push({
        beneficiario,
        numero_sadt: numeroSadt || '—',
        categoria: 'Autorização vencida ou com validade divergente',
        descricao: `A ${numSess}ª sessão (${dSadt}) foi realizada após a validade impressa da guia (${validadeGuia}).`,
        acao_necessaria: 'Verificar prorrogação de validade da senha no portal MedSênior antes de faturar.'
      });
    }

    // Confrontar com o Ágil (se a data for de Outubro/2026 ou se houver registros no Ágil para aquela data)
    const agilMatch = agilByDate.get(dSadt);
    const isOct2026 = dSadt.endsWith('/10/2026');

    if (agilMatch) {
      if (agilMatch.canceladaOuFalta) {
        pendencias.push({
          beneficiario,
          numero_sadt: numeroSadt || '—',
          categoria: 'Data da SADT diferente da Ágil',
          descricao: `A ${numSess}ª sessão (${dSadt}) consta na SADT, mas no Ágil está registrada como "${agilMatch.status_agil || agilMatch.validacao}" (não realizada/desmarcada).`,
          acao_necessaria: 'Não faturar sessão desmarcada/falta; validar assinatura física na guia SADT.'
        });
        sessoesDetalhe.push({ numero: numSess, data: dSadt, status: 'DIVERGENTE_AGIL_FALTA', motivo: `No Ágil consta: ${agilMatch.validacao || agilMatch.status_agil}` });
      } else {
        sessoesConfirmadas++;
        sessoesDetalhe.push({ numero: numSess, data: dSadt, status: 'CONFIRMADA_AGIL', motivo: `Confirmada no Ágil (${agilMatch.sessao || 'Realizada'})` });
      }
    } else if (isOct2026 && (agilRowsForPatient || []).length > 0) {
      // Data é de Outubro/2026, o paciente tem registros no Ágil em Outubro, mas não nesta data exata
      pendencias.push({
        beneficiario,
        numero_sadt: numeroSadt || '—',
        categoria: 'Data da SADT diferente da Ágil',
        descricao: `A ${numSess}ª sessão (${dSadt}) consta manuscrita na SADT, mas não foi localizada nessa data na planilha Ágil.`,
        acao_necessaria: 'Confrontar data manuscrita na SADT com as datas efetivas do paciente no sistema Ágil.'
      });
      sessoesDetalhe.push({ numero: numSess, data: dSadt, status: 'NAO_LOCALIZADA_AGIL', motivo: 'Data não localizada no Ágil em Outubro/2026' });
    } else {
      // Sessão de mês anterior (ex: Agosto/Setembro em guia que fechou agora) assinada na guia SADT (Fonte 1 documental)
      sessoesConfirmadas++;
      sessoesDetalhe.push({ numero: numSess, data: dSadt, status: 'CONFIRMADA_SADT', motivo: 'Data e assinatura comprovadas na Guia SP/SADT' });
    }
  }

  // 4. Verificar se há sessões realizadas no Ágil para esta guia/paciente que estão faltando na guia SADT
  const agilRealizadasDates = [...agilByDate.values()].filter(x => x.realizada).map(x => x.data);
  if (sessoesPreenchidasSadt === 0) {
    pendencias.push({
      beneficiario,
      numero_sadt: numeroSadt || '—',
      categoria: 'Sessão não localizada',
      descricao: 'Nenhuma data de sessão preenchida/comprovada nesta guia SADT.',
      acao_necessaria: 'Fazer upload da guia SP/SADT digitalizada ou preencher as datas manuscritas.'
    });
  }

  // 5. Controle de Bloco (Seção 4 do Prompt Mestre: sinalizar quando faltarem <= 2 sessões ou novo bloco)
  let alertaBloco = '';
  if (sessoesConfirmadas === 6 || sessoesConfirmadas === 7) {
    alertaBloco = `⚠️ Faltam ${8 - sessoesConfirmadas} sessão(ões) para concluir o bloco de 8 sessões — verificar renovação/próxima fase.`;
  } else if (sessoesConfirmadas === 8) {
    alertaBloco = '✅ Bloco completo (8/8 sessões confirmadas).';
  } else if (sessoesConfirmadas >= 1 && sessoesConfirmadas <= 3) {
    alertaBloco = `ℹ️ Bloco parcial (${sessoesConfirmadas}/8 sessões realizadas).`;
  }

  // 6. Regra de Cálculo Interno (Seção 5 do Prompt Mestre)
  const calc = calcularValoresMedSenior(sessoesConfirmadas, validadoContratual);
  if (calc.requerValidacaoContratual && !validadoContratual) {
    pendencias.push({
      beneficiario,
      numero_sadt: numeroSadt || '—',
      categoria: 'Valor dependente de validação contratual',
      descricao: `Guia com ${sessoesConfirmadas} sessões confirmadas (bloco parcial de 4 a 7 sessões). Critério interno simula R$ 880,00, mas exige confirmação contratual expressa.`,
      acao_necessaria: 'Validar contratualmente se a guia será faturada integral (R$ 880,00), proporcional ou aguardará conclusão das 8 sessões.'
    });
  }

  const temPendenciaImpeditiva = pendencias.length > 0 && statusManual !== 'APROVADA_MANUAL';

  return {
    sessoesDetalhe,
    sessoesPreenchidasSadt,
    sessoesConfirmadas,
    agilRealizadasDates,
    alertaBloco,
    valorProposto: calc.valorProposto,
    valorRegraInterna: calc.valorRegraInterna,
    valorAuditado: calc.valorAuditado,
    requerValidacaoContratual: calc.requerValidacaoContratual,
    pendencias,
    statusCalculado: temPendenciaImpeditiva ? 'PENDENTE_CONFERENCIA' : 'APROVADA_FATURAMENTO'
  };
}

async function ensureMedSeniorTableAndSeed(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.auditoria_medsenior_guias (
      id bigserial PRIMARY KEY,
      competencia text NOT NULL DEFAULT '10/2026',
      beneficiario text NOT NULL,
      numero_sadt text NOT NULL,
      carteira text DEFAULT '',
      data_autorizacao text DEFAULT '',
      senha text DEFAULT '',
      validade_guia text DEFAULT '',
      fase_bloco text DEFAULT '1ª Fase (Sessões 1 a 8 • GUIA 1/3)',
      qtde_autorizada integer DEFAULT 8,
      sessao_1 text DEFAULT '',
      sessao_2 text DEFAULT '',
      sessao_3 text DEFAULT '',
      sessao_4 text DEFAULT '',
      sessao_5 text DEFAULT '',
      sessao_6 text DEFAULT '',
      sessao_7 text DEFAULT '',
      sessao_8 text DEFAULT '',
      valor_proposto numeric(10,2) DEFAULT 880.00,
      valor_auditado numeric(10,2) DEFAULT 880.00,
      validado_contratual boolean DEFAULT false,
      status_auditoria text DEFAULT 'AUTOMATICO',
      origem_registro text DEFAULT 'SADT_DIGITALIZADA',
      observacoes text DEFAULT '',
      arquivo_nome text DEFAULT '',
      auditado_por text DEFAULT 'Camila (Coordenação)',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `);

  // Verificar se as 4 guias SP/SADT reais enviadas pela Dra. Camila já estão cadastradas
  const countRes = await client.query(`SELECT count(*) FROM public.auditoria_medsenior_guias;`);
  if (parseInt(countRes.rows[0].count, 10) === 0) {
    const initialGuides = [
      {
        competencia: '10/2026',
        beneficiario: 'MARIA QUITERIA PEREIRA',
        numero_sadt: '17930251',
        carteira: '2023100001940',
        data_autorizacao: '10/08/2026',
        senha: '10020666690',
        validade_guia: '09/12/2026',
        fase_bloco: '1ª Fase (Sessões 1 a 8 • GUIA 1/3)',
        sessao_1: '12/08/2026',
        sessao_2: '17/08/2026',
        sessao_3: '19/08/2026',
        sessao_4: '24/08/2026',
        sessao_5: '26/08/2026',
        sessao_6: '31/08/2026',
        sessao_7: '02/09/2026',
        sessao_8: '25/09/2026',
        origem_registro: 'SADT_DIGITALIZADA',
        arquivo_nome: '17930251 Maria Quiteria Pereira.pdf',
        observacoes: 'Guia SP/SADT 1/3 completa com 8 assinaturas manuscritas conferidas.'
      },
      {
        competencia: '10/2026',
        beneficiario: 'JORGELI SANTOS REIS GONCALVES',
        numero_sadt: '17966121',
        carteira: '2023120014860',
        data_autorizacao: '11/08/2026',
        senha: '10020710949',
        validade_guia: '09/12/2026',
        fase_bloco: '2ª Fase (Sessões 9 a 16 • GUIA 2/3)',
        sessao_1: '21/08/2026',
        sessao_2: '28/08/2026',
        sessao_3: '04/09/2026',
        sessao_4: '',
        sessao_5: '',
        sessao_6: '',
        sessao_7: '',
        sessao_8: '',
        origem_registro: 'SADT_DIGITALIZADA',
        arquivo_nome: '17966121 Jorgeli Santos Reis Gonçalves.pdf',
        observacoes: 'Guia SP/SADT 2/3 parcial com 3 sessões realizadas e assinadas (R$ 330,00).'
      },
      {
        competencia: '10/2026',
        beneficiario: 'APRIGIO PEREIRA LIMA',
        numero_sadt: '18091060',
        carteira: '2023050044640',
        data_autorizacao: '17/08/2026',
        senha: '10020885857',
        validade_guia: '15/12/2026',
        fase_bloco: '1ª Fase (Sessões 1 a 8 • GUIA 1/3)',
        sessao_1: '01/09/2026',
        sessao_2: '08/09/2026',
        sessao_3: '15/09/2026',
        sessao_4: '17/09/2026',
        sessao_5: '22/09/2026',
        sessao_6: '24/09/2026',
        sessao_7: '29/09/2026',
        sessao_8: '01/10/2026',
        origem_registro: 'SADT_DIGITALIZADA',
        arquivo_nome: '18091060 Aprigio Pereira Lima.pdf',
        observacoes: 'Guia SP/SADT com 8 sessões assinadas (8ª sessão em 01/10/2026 confirmada no Ágil).'
      },
      {
        competencia: '10/2026',
        beneficiario: 'MARIA ANGELA MONTENEGRO DE AZEVEDO',
        numero_sadt: '18117298',
        carteira: '2026050015231',
        data_autorizacao: '18/08/2026',
        senha: '10020898277',
        validade_guia: '16/12/2026',
        fase_bloco: '1ª Fase (Sessões 1 a 8 • GUIA 1/3)',
        sessao_1: '02/09/2026',
        sessao_2: '08/09/2026',
        sessao_3: '09/09/2026',
        sessao_4: '14/09/2026',
        sessao_5: '16/09/2026',
        sessao_6: '21/09/2026',
        sessao_7: '23/09/2026',
        sessao_8: '30/09/2026',
        origem_registro: 'SADT_DIGITALIZADA',
        arquivo_nome: '18117298 Maria Angela Montenegro de Azevedo.pdf',
        observacoes: 'Guia SP/SADT com 8 sessões assinadas.'
      }
    ];

    for (const g of initialGuides) {
      await client.query(`
        INSERT INTO public.auditoria_medsenior_guias (
          competencia, beneficiario, numero_sadt, carteira, data_autorizacao, senha,
          validade_guia, fase_bloco, sessao_1, sessao_2, sessao_3, sessao_4,
          sessao_5, sessao_6, sessao_7, sessao_8, origem_registro, arquivo_nome, observacoes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19);
      `, [
        g.competencia, g.beneficiario, g.numero_sadt, g.carteira, g.data_autorizacao, g.senha,
        g.validade_guia, g.fase_bloco, g.sessao_1, g.sessao_2, g.sessao_3, g.sessao_4,
        g.sessao_5, g.sessao_6, g.sessao_7, g.sessao_8, g.origem_registro, g.arquivo_nome, g.observacoes
      ]);
    }
  }
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
    const competencia = body.competencia || '10/2026';

    await client.connect();
    await ensureMedSeniorTableAndSeed(client);

    // -------------------------------------------------------------
    // ACTION: SYNC_AGIL / DEDUPE_GUIAS
    // REGRA DE OURO (Dra. Camila & Prompt Mestre):
    // Na Planilha Espelho SÓ entram as guias SP/SADT que a Dra. Camila subir (ou cadastrar manualmente).
    // A Planilha Ágil serve EXCLUSIVAMENTE para conferir as datas das sessões e enriquecer carteirinha — NUNCA para inserir linhas sozinhas!
    // -------------------------------------------------------------
    if (action === 'sync_agil' || action === 'dedupe_guias') {
      // 1. Garantir remoção de qualquer registro antigo que tenha vindo apenas do Ágil sem upload da guia
      const delAgilRes = await client.query(`
        DELETE FROM public.auditoria_medsenior_guias
        WHERE competencia = $1 AND origem_registro = 'AGIL_SINCRONIZADO';
      `, [competencia]);
      const removedAgilOnly = delAgilRes.rowCount || 0;

      // 2. Buscar guias reais enviadas pela Dra. Camila na competência (ordenadas da mais recente para a mais antiga)
      const existingRes = await client.query(`
        SELECT * FROM public.auditoria_medsenior_guias
        WHERE competencia = $1 AND origem_registro <> 'AGIL_SINCRONIZADO'
        ORDER BY updated_at DESC NULLS LAST, id DESC;
      `, [competencia]);
      const existingGuides = existingRes.rows || [];

      // 3. Remover eventuais guias duplicadas (mesmo Nº SADT ou mesmo Beneficiário + mesmas datas de sessão)
      const keptGuides = [];
      const duplicateIdsToDelete = [];

      for (const g of existingGuides) {
        const sadtNorm = String(g.numero_sadt || '').trim();
        const sigDates = [g.sessao_1, g.sessao_2, g.sessao_3, g.sessao_4, g.sessao_5, g.sessao_6, g.sessao_7, g.sessao_8]
          .map(d => normalizeDateBR(d))
          .filter(Boolean)
          .join('|');

        const isDup = keptGuides.some(k => {
          const kSadt = String(k.numero_sadt || '').trim();
          if (sadtNorm && sadtNorm !== 'SEM_SADT' && kSadt === sadtNorm) return true;
          if (isSameBeneficiario(k.beneficiario, g.beneficiario)) {
            const kDates = [k.sessao_1, k.sessao_2, k.sessao_3, k.sessao_4, k.sessao_5, k.sessao_6, k.sessao_7, k.sessao_8]
              .map(d => normalizeDateBR(d))
              .filter(Boolean)
              .join('|');
            if (sigDates && kDates && sigDates === kDates) return true;
          }
          return false;
        });

        if (isDup) {
          duplicateIdsToDelete.push(g.id);
        } else {
          keptGuides.push(g);
        }
      }

      if (duplicateIdsToDelete.length > 0) {
        await client.query(`
          DELETE FROM public.auditoria_medsenior_guias WHERE id = ANY($1::bigint[]);
        `, [duplicateIdsToDelete]);
      }

      // 4. Conferir com os registros do Ágil (apenas para completar carteirinha se estiver vazia na guia subida)
      const agilRes = await client.query(`
        SELECT paciente, cpf_carteirinha
        FROM public.agendamentos_auditoria
        WHERE LOWER(convenio) LIKE '%medsenior%'
        ORDER BY id DESC;
      `);

      let updatedCount = 0;
      for (const g of keptGuides) {
        if (!g.carteira || g.carteira === '000' || g.carteira === '—') {
          const agilRow = (agilRes.rows || []).find(ar =>
            isSameBeneficiario(ar.paciente, g.beneficiario) &&
            ar.cpf_carteirinha &&
            ar.cpf_carteirinha !== '000' &&
            ar.cpf_carteirinha !== '—'
          );
          if (agilRow) {
            await client.query(`
              UPDATE public.auditoria_medsenior_guias
              SET carteira = $1, updated_at = NOW()
              WHERE id = $2;
            `, [agilRow.cpf_carteirinha, g.id]);
            updatedCount++;
          }
        }
      }

      await client.end();
      const totalRemoved = removedAgilOnly + duplicateIdsToDelete.length;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          conferidasCount: keptGuides.length,
          removedDuplicatesCount: totalRemoved,
          updatedCount,
          message: totalRemoved > 0
            ? `Conferência concluída: ${keptGuides.length} guias enviadas conferidas com o Ágil e ${totalRemoved} guia(s) duplicada(s)/extras removida(s)!`
            : `Conferência com o Ágil concluída: todas as ${keptGuides.length} guias que você subiu foram confrontadas com o Ágil sem duplicidades!`
        })
      };
    }

    // -------------------------------------------------------------
    // ACTION: OCR_GUIA (Extrai dados de PDF/Imagem da Guia SP/SADT via GPT-4o Vision no n8n e salva)
    // -------------------------------------------------------------
    if (action === 'ocr_guia') {
      const { imageDataUrl, fileName = 'Guia_SADT.png' } = body;
      if (!imageDataUrl) {
        await client.end();
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Imagem da guia não fornecida.' }) };
      }

      const knownRes = await client.query(`
        SELECT DISTINCT UPPER(TRIM(paciente)) AS pac, cpf_carteirinha, guia
        FROM public.agendamentos_auditoria
        WHERE LOWER(convenio) LIKE '%medsenior%'
        ORDER BY pac ASC;
      `);
      const knownHints = knownRes.rows
        .map(r => `${r.pac} (Carteira: ${r.cpf_carteirinha || ''}, Guia: ${r.guia || ''})`)
        .join(' | ');

      const ocrRes = await fetch('http://2.25.163.224:5678/webhook/ocr-medsenior-sadt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, fileName, knownHints })
      });

      if (!ocrRes.ok) {
        await client.end();
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Falha ao comunicar com o motor de Visão IA.' }) };
      }

      const ocrJson = await ocrRes.json();
      const rawOcr = Array.isArray(ocrJson) ? ocrJson[0] : ocrJson;
      let parsed = null;
      if (rawOcr && rawOcr.choices && rawOcr.choices[0] && rawOcr.choices[0].message) {
        const cleanJsonStr = String(rawOcr.choices[0].message.content || '').replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        parsed = JSON.parse(cleanJsonStr);
      } else if (rawOcr && (rawOcr.beneficiario || rawOcr.numero_sadt)) {
        parsed = rawOcr;
      }

      if (!parsed || (!parsed.beneficiario && !parsed.numero_sadt)) {
        await client.end();
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Não foi possível ler os campos da Guia SP/SADT na imagem enviada.' }) };
      }

      const beneficiario = String(parsed.beneficiario || 'BENEFICIÁRIO NÃO IDENTIFICADO').trim().toUpperCase();
      const numero_sadt = String(parsed.numero_sadt || 'SEM_SADT').trim();
      let carteira = String(parsed.carteira || '').trim();
      if (!carteira || carteira === '000' || carteira === '—') {
        const agilCart = (knownRes.rows || []).find(ar =>
          isSameBeneficiario(ar.pac, beneficiario) &&
          ar.cpf_carteirinha &&
          ar.cpf_carteirinha !== '000' &&
          ar.cpf_carteirinha !== '—'
        );
        if (agilCart) carteira = String(agilCart.cpf_carteirinha).trim();
      }
      const data_autorizacao = normalizeDateBR(parsed.data_autorizacao);
      const senha = String(parsed.senha || '').trim();
      const validade_guia = normalizeDateBR(parsed.validade_guia);
      const fase_bloco = detectFaseBloco(parsed.fase_observacao, '');
      const sessArr = Array.isArray(parsed.sessoes) ? parsed.sessoes : [];
      const getS = (idx) => {
        const item = sessArr.find(x => Number(x.numero) === idx) || sessArr[idx - 1];
        if (!item) return '';
        if (item.legivel === false || String(item.data || '').toUpperCase().includes('ILEG')) return 'ILEGÍVEL';
        return normalizeDateBR(item.data);
      };

      const s1 = getS(1), s2 = getS(2), s3 = getS(3), s4 = getS(4);
      const s5 = getS(5), s6 = getS(6), s7 = getS(7), s8 = getS(8);
      const newDatesSig = [s1, s2, s3, s4, s5, s6, s7, s8].filter(Boolean).join('|');

      // Verificar se essa guia SADT já existe na competência (pelo Nº SADT ou pelo mesmo Beneficiário + mesmas datas de sessão) para atualizar sem duplicar
      const allCompRes = await client.query(`
        SELECT id, beneficiario, numero_sadt, sessao_1, sessao_2, sessao_3, sessao_4, sessao_5, sessao_6, sessao_7, sessao_8
        FROM public.auditoria_medsenior_guias
        WHERE competencia = $1 AND origem_registro <> 'AGIL_SINCRONIZADO';
      `, [competencia]);

      const existingMatch = (allCompRes.rows || []).find(row => {
        if (numero_sadt !== 'SEM_SADT' && String(row.numero_sadt || '').trim() === numero_sadt) {
          return true;
        }
        if (isSameBeneficiario(row.beneficiario, beneficiario)) {
          const rowDatesSig = [row.sessao_1, row.sessao_2, row.sessao_3, row.sessao_4, row.sessao_5, row.sessao_6, row.sessao_7, row.sessao_8]
            .map(d => normalizeDateBR(d))
            .filter(Boolean)
            .join('|');
          if (newDatesSig && rowDatesSig && newDatesSig === rowDatesSig) return true;
        }
        return false;
      });

      let savedId = null;
      let wasUpdatedDuplicate = false;
      if (existingMatch) {
        savedId = existingMatch.id;
        wasUpdatedDuplicate = true;
        await client.query(`
          UPDATE public.auditoria_medsenior_guias
          SET beneficiario = $1, numero_sadt = $2, carteira = COALESCE(NULLIF($3, ''), carteira),
              data_autorizacao = COALESCE(NULLIF($4, ''), data_autorizacao),
              senha = COALESCE(NULLIF($5, ''), senha),
              validade_guia = COALESCE(NULLIF($6, ''), validade_guia),
              fase_bloco = $7,
              sessao_1 = $8, sessao_2 = $9, sessao_3 = $10, sessao_4 = $11,
              sessao_5 = $12, sessao_6 = $13, sessao_7 = $14, sessao_8 = $15,
              origem_registro = 'SADT_DIGITALIZADA', arquivo_nome = $16, updated_at = NOW()
          WHERE id = $17;
        `, [beneficiario, numero_sadt, carteira, data_autorizacao, senha, validade_guia, fase_bloco, s1, s2, s3, s4, s5, s6, s7, s8, fileName, savedId]);
      } else {
        const ins = await client.query(`
          INSERT INTO public.auditoria_medsenior_guias (
            competencia, beneficiario, numero_sadt, carteira, data_autorizacao, senha,
            validade_guia, fase_bloco, sessao_1, sessao_2, sessao_3, sessao_4,
            sessao_5, sessao_6, sessao_7, sessao_8, origem_registro, arquivo_nome, observacoes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'SADT_DIGITALIZADA',$17,$18)
          RETURNING id;
        `, [
          competencia, beneficiario, numero_sadt, carteira, data_autorizacao, senha,
          validade_guia, fase_bloco, s1, s2, s3, s4, s5, s6, s7, s8, fileName,
          `Extraído via IA Multimodal da Guia SP/SADT (${fileName}).`
        ]);
        savedId = ins.rows[0].id;
      }

      await client.end();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          id: savedId,
          wasUpdatedDuplicate,
          extracted: {
            beneficiario, numero_sadt, carteira, data_autorizacao, senha, validade_guia, fase_bloco,
            sessoes: [s1, s2, s3, s4, s5, s6, s7, s8]
          }
        })
      };
    }

    // -------------------------------------------------------------
    // ACTION: SAVE_GUIA (Cria ou edita manualmente uma Guia SADT)
    // -------------------------------------------------------------
    if (action === 'save_guia') {
      const g = body.guia || {};
      const id = g.id ? parseInt(g.id, 10) : null;
      const beneficiario = String(g.beneficiario || '').trim().toUpperCase();
      const numero_sadt = String(g.numero_sadt || '').trim();
      if (!beneficiario || !numero_sadt) {
        await client.end();
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome do Beneficiário e Nº SADT são obrigatórios.' }) };
      }

      const carteira = String(g.carteira || '').trim();
      const data_autorizacao = normalizeDateBR(g.data_autorizacao);
      const senha = String(g.senha || '').trim();
      const validade_guia = normalizeDateBR(g.validade_guia);
      const fase_bloco = g.fase_bloco || detectFaseBloco('', '');
      const s1 = normalizeDateBR(g.sessao_1);
      const s2 = normalizeDateBR(g.sessao_2);
      const s3 = normalizeDateBR(g.sessao_3);
      const s4 = normalizeDateBR(g.sessao_4);
      const s5 = normalizeDateBR(g.sessao_5);
      const s6 = normalizeDateBR(g.sessao_6);
      const s7 = normalizeDateBR(g.sessao_7);
      const s8 = normalizeDateBR(g.sessao_8);
      const validado_contratual = Boolean(g.validado_contratual);
      const status_auditoria = g.status_auditoria || 'AUTOMATICO';
      const observacoes = String(g.observacoes || '').trim();

      if (id) {
        await client.query(`
          UPDATE public.auditoria_medsenior_guias
          SET beneficiario = $1, numero_sadt = $2, carteira = $3, data_autorizacao = $4,
              senha = $5, validade_guia = $6, fase_bloco = $7,
              sessao_1 = $8, sessao_2 = $9, sessao_3 = $10, sessao_4 = $11,
              sessao_5 = $12, sessao_6 = $13, sessao_7 = $14, sessao_8 = $15,
              validado_contratual = $16, status_auditoria = $17, observacoes = $18,
              updated_at = NOW()
          WHERE id = $19;
        `, [
          beneficiario, numero_sadt, carteira, data_autorizacao, senha, validade_guia, fase_bloco,
          s1, s2, s3, s4, s5, s6, s7, s8, validado_contratual, status_auditoria, observacoes, id
        ]);
      } else {
        await client.query(`
          INSERT INTO public.auditoria_medsenior_guias (
            competencia, beneficiario, numero_sadt, carteira, data_autorizacao, senha,
            validade_guia, fase_bloco, sessao_1, sessao_2, sessao_3, sessao_4,
            sessao_5, sessao_6, sessao_7, sessao_8, validado_contratual, status_auditoria,
            origem_registro, observacoes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'CADASTRO_MANUAL',$19);
        `, [
          competencia, beneficiario, numero_sadt, carteira, data_autorizacao, senha, validade_guia, fase_bloco,
          s1, s2, s3, s4, s5, s6, s7, s8, validado_contratual, status_auditoria, observacoes
        ]);
      }

      await client.end();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // -------------------------------------------------------------
    // ACTION: TOGGLE_CONTRATUAL / DELETE_GUIA
    // -------------------------------------------------------------
    if (action === 'toggle_contratual') {
      const { id, validado_contratual, status_auditoria } = body;
      await client.query(`
        UPDATE public.auditoria_medsenior_guias
        SET validado_contratual = COALESCE($1, validado_contratual),
            status_auditoria = COALESCE($2, status_auditoria),
            updated_at = NOW()
        WHERE id = $3;
      `, [validado_contratual, status_auditoria, id]);
      await client.end();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'delete_guia') {
      const { id } = body;
      await client.query(`DELETE FROM public.auditoria_medsenior_guias WHERE id = $1;`, [id]);
      await client.end();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // -------------------------------------------------------------
    // ACTION: LIST (Retorna Planilha Espelho A–Z + Aba de Pendências + Relatório Executivo)
    // -------------------------------------------------------------
    const guiasRes = await client.query(`
      SELECT *
      FROM public.auditoria_medsenior_guias
      WHERE competencia = $1 AND origem_registro <> 'AGIL_SINCRONIZADO'
      ORDER BY UPPER(TRIM(beneficiario)) ASC, numero_sadt ASC;
    `, [competencia]);

    const compRes = await client.query(`
      SELECT competencia, COUNT(*)::int AS count
      FROM public.auditoria_medsenior_guias
      WHERE origem_registro <> 'AGIL_SINCRONIZADO'
      GROUP BY competencia
      ORDER BY competencia DESC;
    `);

    const agilAllRes = await client.query(`
      SELECT paciente, data, horario, sessao, guia, cpf_carteirinha, status_agil, validacao
      FROM public.agendamentos_auditoria
      WHERE LOWER(convenio) LIKE '%medsenior%'
      ORDER BY id ASC;
    `);
    const agilAll = agilAllRes.rows || [];

    // Contar duplicidades de Nº SADT na competência
    const sadtCounts = {};
    for (const g of guiasRes.rows) {
      const num = String(g.numero_sadt || '').trim();
      if (num) sadtCounts[num] = (sadtCounts[num] || 0) + 1;
    }

    const todasPendencias = [];
    let totalSessoesConfirmadas = 0;
    let totalValorProposto = 0;
    let totalValorAuditadoConfirmado = 0;
    let totalValorPendenteValidacao = 0;
    let guiasSemPendencias = 0;
    let guiasComPendencias = 0;

    const auditedRows = guiasRes.rows.map(g => {
      const patientAgilRows = agilAll.filter(ar => isSameBeneficiario(ar.paciente, g.beneficiario));
      const dupCount = sadtCounts[String(g.numero_sadt || '').trim()] || 1;
      const audit = auditarGuiaContraAgil(g, patientAgilRows, dupCount);

      todasPendencias.push(...audit.pendencias.map(p => ({ ...p, guia_id: g.id })));
      totalSessoesConfirmadas += audit.sessoesConfirmadas;
      totalValorProposto += audit.valorProposto;

      if (audit.statusCalculado === 'APROVADA_FATURAMENTO') {
        guiasSemPendencias++;
        totalValorAuditadoConfirmado += audit.valorAuditado;
      } else {
        guiasComPendencias++;
        if (audit.requerValidacaoContratual && !g.validado_contratual) {
          totalValorPendenteValidacao += audit.valorRegraInterna;
        } else {
          totalValorAuditadoConfirmado += audit.valorAuditado;
        }
      }

      return {
        ...g,
        sessoes_detalhe: audit.sessoesDetalhe,
        sessoes_confirmadas: audit.sessoesConfirmadas,
        agil_realizadas_dates: audit.agilRealizadasDates,
        alerta_bloco: audit.alertaBloco,
        valor_proposto_calc: audit.valorProposto,
        valor_regra_interna: audit.valorRegraInterna,
        valor_auditado_calc: audit.valorAuditado,
        requer_validacao_contratual: audit.requerValidacaoContratual,
        pendencias: audit.pendencias,
        status_calculado: audit.statusCalculado
      };
    });

    const parecerFinal = (auditedRows.length > 0 && guiasComPendencias === 0)
      ? 'APROVADO PARA FATURAMENTO'
      : 'PENDENTE DE CONFERÊNCIA';

    const relatorioExecutivo = {
      competencia,
      guiasRecebidas: auditedRows.length,
      guiasConferidas: auditedRows.length,
      guiasSemPendencias,
      guiasComPendencias,
      sessoesConfirmadas: totalSessoesConfirmadas,
      valorProposto: totalValorProposto,
      valorAuditadoConfirmado: totalValorAuditadoConfirmado,
      valoresPendentesValidacao: totalValorPendenteValidacao,
      divergenciasIdentificadas: todasPendencias.length,
      parecerFinal,
      statusArquivo: parecerFinal === 'APROVADO PARA FATURAMENTO' ? 'FINALIZADO' : 'PRELIMINAR'
    };

    await client.end();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        competencia,
        competencias: compRes.rows || [],
        rows: auditedRows,
        pendencias: todasPendencias,
        relatorioExecutivo
      })
    };

  } catch (err) {
    try { await client.end(); } catch (_) {}
    console.error('[Auditoria MedSenior Error]:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro na Auditoria MedSênior: ' + err.message })
    };
  }
};
