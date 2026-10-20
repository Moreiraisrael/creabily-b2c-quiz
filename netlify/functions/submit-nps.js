const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // Enable CORS
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
        const {
            patient_name,
            phone,
            unit = 'paulista',
            service = 'Fisioterapia / Pilates',
            score,
            feedback_text = '',
            improvement_tags = [],
            redirected_to_google = false
        } = body;

        const numScore = parseInt(score, 10);
        if (isNaN(numScore) || numScore < 0 || numScore > 10) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Nota NPS inválida. Deve ser entre 0 e 10.' })
            };
        }

        // Categorize
        let category = 'promoter';
        if (numScore <= 6) {
            category = 'detractor';
        } else if (numScore <= 8) {
            category = 'passive';
        }

        const supabaseUrl = process.env.SUPABASE_URL || 'https://rqxrphtfjzduzlfnxuax.supabase.co';
        const supabaseKey = process.env.SUPABASE_KEY;

        if (!supabaseKey) {
            console.error('[NPS] SUPABASE_KEY não configurada no ambiente.');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Configuração do banco de dados ausente.' })
            };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Normalize phone if provided
        let cleanPhone = null;
        if (phone) {
            cleanPhone = String(phone).replace(/\D/g, '');
            if (cleanPhone.length === 10 || cleanPhone.length === 11) {
                cleanPhone = '55' + cleanPhone;
            }
        }

        // Try to match lead in public.leads
        let matchedLeadId = null;
        if (cleanPhone) {
            const { data: matchedLeads } = await supabase
                .from('leads')
                .select('id, name, notes')
                .or(`phone.eq.${cleanPhone},phone.eq.${cleanPhone.replace(/^55/, '')}`)
                .limit(1);

            if (matchedLeads && matchedLeads.length > 0) {
                matchedLeadId = matchedLeads[0].id;
                const lead = matchedLeads[0];

                // Append note to lead card
                const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
                let npsNote = `\n[${timestamp}] [NPS ${numScore}/10 - ${category.toUpperCase()}]`;
                if (redirected_to_google) {
                    npsNote += ' ⭐ Redirecionado para o Google Meu Negócio';
                }
                if (feedback_text) {
                    npsNote += `\nComentário: "${feedback_text}"`;
                }
                if (improvement_tags && improvement_tags.length > 0) {
                    npsNote += ` (Pontos citados: ${improvement_tags.join(', ')})`;
                }

                const updatedNotes = (lead.notes || '') + npsNote;
                await supabase
                    .from('leads')
                    .update({
                        notes: updatedNotes,
                        last_interaction_at: new Date().toISOString()
                    })
                    .eq('id', lead.id);
            }
        }

        // Insert into nps_feedbacks
        const insertPayload = {
            lead_id: matchedLeadId,
            patient_name: patient_name || (cleanPhone ? `Paciente ${cleanPhone.slice(-4)}` : 'Paciente Anônimo'),
            phone: cleanPhone,
            unit: unit.toLowerCase().includes('granja') ? 'granja_viana' : 'paulista',
            service,
            score: numScore,
            category,
            feedback_text: feedback_text || null,
            improvement_tags: improvement_tags || [],
            redirected_to_google: !!redirected_to_google,
            google_unit_url: unit.toLowerCase().includes('granja')
                ? 'https://www.google.com/maps/search/?api=1&query=Creabily+Fisioterapia+e+Pilates+Granja+Viana'
                : 'https://www.google.com/maps/search/?api=1&query=Creabily+Fisioterapia+e+Pilates+Av+Paulista'
        };

        const { data: inserted, error: insertError } = await supabase
            .from('nps_feedbacks')
            .insert([insertPayload])
            .select();

        if (insertError) {
            console.error('[NPS] Erro ao gravar feedback:', insertError);
            throw insertError;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                id: inserted && inserted[0] ? inserted[0].id : null,
                category,
                score: numScore,
                redirected_to_google: !!redirected_to_google
            })
        };

    } catch (err) {
        console.error('[NPS] Erro geral na função:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message || 'Erro interno ao processar NPS.' })
        };
    }
};
