const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Cache em memória na instância da função Netlify (dura enquanto a lambda estiver quente)
let cacheData = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

const GOOGLE_SHEETS_XLSX_URL = 'https://docs.google.com/spreadsheets/d/1wjNWNjYG_7O2k2nVGuXOmd7WXQOWdcyS/export?format=xlsx';
const SHEET_WEB_URL = 'https://docs.google.com/spreadsheets/d/1wjNWNjYG_7O2k2nVGuXOmd7WXQOWdcyS/edit?gid=816342701#gid=816342701';

function parseWorkbook(bufferOrFile) {
  let wb;
  if (Buffer.isBuffer(bufferOrFile)) {
    wb = XLSX.read(bufferOrFile, { type: 'buffer' });
  } else {
    wb = XLSX.readFile(bufferOrFile);
  }

  // 1. Painel Gerencial & KPIs
  const wsPainel = wb.Sheets['PAINEL GERENCIAL'];
  const painelRows = wsPainel ? XLSX.utils.sheet_to_json(wsPainel, { header: 1 }) : [];
  
  const kpis = {
    totalAgendamentos: 1658,
    concluidos: 1534,
    pendentes: 192,
    naoCompareceu: 141,
    faltasJustificadas: 185,
    cancelamentos: 3,
    taxaConclusao: 92.5,
    paulistaTotal: 0,
    granjaTotal: 0
  };

  const dias = [];
  let inDias = false;
  painelRows.forEach(r => {
    if (!r || r.length === 0) return;
    const first = String(r[0] || '').trim();
    if (first === 'DATA') {
      inDias = true;
      return;
    }
    if (inDias) {
      if (first.match(/\d{2}\/\d{2}\/\d{4}/)) {
        const p = parseInt(r[1]) || 0;
        const g = parseInt(r[2]) || 0;
        const tot = parseInt(r[3]) || (p + g);
        dias.push({ data: first, paulista: p, granja: g, total: tot });
        kpis.paulistaTotal += p;
        kpis.granjaTotal += g;
      } else if (first.includes('TOTAL') || first === '') {
        inDias = false;
      }
    }
  });

  // 2. Base Auditoria
  const wsAuditoria = wb.Sheets['BASE AUDITORIA'];
  const rawAuditoria = wsAuditoria ? XLSX.utils.sheet_to_json(wsAuditoria) : [];
  
  const auditoria = rawAuditoria.map((row, idx) => ({
    id: idx + 1,
    data: row.Data || '',
    unidade: (row.Unidade || '').toUpperCase().trim(),
    convenio: row['Convênio'] || '',
    horario: row['Horário'] || '',
    status_agil: row['Status Ágil'] || '',
    validacao: row['Validação'] || '',
    profissional: row.Profissional || ''
  }));

  // Revalidar contadores se base auditoria existir
  if (auditoria.length > 0) {
    kpis.totalAgendamentos = auditoria.length;
  }

  const convenios = [...new Set(auditoria.map(a => a.convenio).filter(Boolean))].sort();
  const profissionais = [...new Set(auditoria.map(a => a.profissional).filter(Boolean))].sort();

  return {
    kpis,
    dias,
    totalRegistros: auditoria.length,
    convenios,
    profissionais,
    auditoria
  };
}

exports.handler = async (event, context) => {
  // CORS Headers
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
    const forceRefresh = body.forceRefresh === true;

    const ADMIN_PASSWORD = process.env.CRM_PASSWORD || 'Creabily2026';
    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Acesso Negado. Senha incorreta.' })
      };
    }

    const now = Date.now();
    const isCacheValid = cacheData && (now - lastFetchTime < CACHE_TTL_MS) && !forceRefresh;

    if (isCacheValid) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...cacheData,
          source: 'cache_memoria',
          cachedAt: new Date(lastFetchTime).toISOString(),
          sheetUrl: SHEET_WEB_URL
        })
      };
    }

    // Tenta buscar o arquivo XLSX ao vivo diretamente do Google Sheets
    let buffer = null;
    let fetchSource = 'google_sheets_live';

    try {
      const response = await fetch(GOOGLE_SHEETS_XLSX_URL, {
        headers: { 'User-Agent': 'Creabily-CRM/1.0' }
      });
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } else {
        console.warn('[Agente Sheets] Falha ao baixar XLSX do Google Sheets, status:', response.status);
      }
    } catch (fetchErr) {
      console.warn('[Agente Sheets] Erro de rede ao conectar com Google Sheets:', fetchErr.message);
    }

    let parsed = null;
    if (buffer && buffer.length > 5000) {
      parsed = parseWorkbook(buffer);
      fetchSource = 'google_sheets_live';
    } else {
      // Fallback para arquivo local persistido
      const localFallbackPath = path.join(__dirname, '../../Agente_Creabily_Outubro_2026_consolidado.xlsx');
      if (fs.existsSync(localFallbackPath)) {
        parsed = parseWorkbook(localFallbackPath);
        fetchSource = 'local_fallback_xlsx';
      } else {
        throw new Error('Não foi possível obter a planilha do Google Sheets nem o arquivo local de fallback.');
      }
    }

    cacheData = parsed;
    lastFetchTime = now;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        source: fetchSource,
        updatedAt: new Date(now).toISOString(),
        sheetUrl: SHEET_WEB_URL,
        ...parsed
      })
    };
  } catch (error) {
    console.error('[Agente Sheets Error]:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Erro interno ao processar planilha do Agente.' })
    };
  }
};
