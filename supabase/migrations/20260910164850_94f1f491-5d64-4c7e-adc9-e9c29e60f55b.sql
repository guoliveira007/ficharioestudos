CREATE TABLE public.workshop_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  onedrive_item_id text NOT NULL,
  drive_id text,
  name text NOT NULL,
  folder text NOT NULL,
  path text NOT NULL DEFAULT '',
  size bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  pages integer,
  error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, onedrive_item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_sources TO authenticated;
GRANT ALL ON public.workshop_sources TO service_role;
ALTER TABLE public.workshop_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workshop_sources" ON public.workshop_sources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.workshop_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid REFERENCES public.workshop_sources(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  area text NOT NULL,
  subject_label text NOT NULL DEFAULT '',
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_topics TO authenticated;
GRANT ALL ON public.workshop_topics TO service_role;
ALTER TABLE public.workshop_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workshop_topics" ON public.workshop_topics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX workshop_topics_user_area_idx ON public.workshop_topics (user_id, area);

CREATE TABLE public.workshop_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic_id uuid REFERENCES public.workshop_topics(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.workshop_sources(id) ON DELETE SET NULL,
  area text NOT NULL,
  subject_label text NOT NULL DEFAULT '',
  topic_label text NOT NULL DEFAULT '',
  statement text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer text,
  explanation text,
  difficulty text NOT NULL DEFAULT 'media',
  page_number integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_questions TO authenticated;
GRANT ALL ON public.workshop_questions TO service_role;
ALTER TABLE public.workshop_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workshop_questions" ON public.workshop_questions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX workshop_questions_topic_idx ON public.workshop_questions (user_id, topic_id);

CREATE TABLE public.workshop_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic_id uuid REFERENCES public.workshop_topics(id) ON DELETE CASCADE,
  area text NOT NULL,
  stage text NOT NULL DEFAULT 'aula',
  step_index integer NOT NULL DEFAULT 0,
  minutes integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_sessions TO authenticated;
GRANT ALL ON public.workshop_sessions TO service_role;
ALTER TABLE public.workshop_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workshop_sessions" ON public.workshop_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.workshop_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.workshop_sessions(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.workshop_questions(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'aula',
  step_index integer,
  answer text NOT NULL DEFAULT '',
  is_correct boolean,
  score numeric,
  feedback jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_answers TO authenticated;
GRANT ALL ON public.workshop_answers TO service_role;
ALTER TABLE public.workshop_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workshop_answers" ON public.workshop_answers FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX workshop_answers_session_idx ON public.workshop_answers (user_id, session_id);

CREATE TRIGGER workshop_sources_updated BEFORE UPDATE ON public.workshop_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER workshop_topics_updated BEFORE UPDATE ON public.workshop_topics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER workshop_sessions_updated BEFORE UPDATE ON public.workshop_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();