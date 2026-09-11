ALTER TABLE public.workshop_topics
  ADD COLUMN IF NOT EXISTS frente text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS boards text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exam_focus text NOT NULL DEFAULT '';

ALTER TABLE public.workshop_questions
  ADD COLUMN IF NOT EXISTS frente text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS board text;

CREATE INDEX IF NOT EXISTS workshop_topics_user_frente_idx
  ON public.workshop_topics (user_id, area, subject_label, frente);

CREATE INDEX IF NOT EXISTS workshop_questions_user_frente_idx
  ON public.workshop_questions (user_id, area, frente);