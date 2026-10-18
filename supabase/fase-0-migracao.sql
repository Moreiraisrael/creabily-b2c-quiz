-- Creabily CRM - Fase 0
-- Rodar no Supabase: SQL Editor > New query > colar > Run
-- Seguro rodar mais de uma vez (IF NOT EXISTS).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS quiz_answers      jsonb,
  ADD COLUMN IF NOT EXISTS utm_source        text,
  ADD COLUMN IF NOT EXISTS utm_medium        text,
  ADD COLUMN IF NOT EXISTS utm_campaign      text,
  ADD COLUMN IF NOT EXISTS utm_content       text,
  ADD COLUMN IF NOT EXISTS utm_term          text,
  ADD COLUMN IF NOT EXISTS gclid             text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  -- Já preparadas para as próximas fases:
  ADD COLUMN IF NOT EXISTS notes             text,
  ADD COLUMN IF NOT EXISTS next_action       text,
  ADD COLUMN IF NOT EXISTS next_action_at    timestamptz,
  ADD COLUMN IF NOT EXISTS lost_reason       text,
  ADD COLUMN IF NOT EXISTS appointment_at    timestamptz;

-- Leads antigos: considera a data de entrada como início da etapa atual
UPDATE public.leads
   SET status_changed_at = COALESCE(last_interaction_at, created_at)
 WHERE status_changed_at IS NULL;

-- Mentoria B2B: anotações, próximo passo e tempo na etapa
ALTER TABLE public.leads_b2b
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes             text,
  ADD COLUMN IF NOT EXISTS next_action       text,
  ADD COLUMN IF NOT EXISTS next_action_at    timestamptz,
  ADD COLUMN IF NOT EXISTS lost_reason       text,
  ADD COLUMN IF NOT EXISTS appointment_at    timestamptz;
