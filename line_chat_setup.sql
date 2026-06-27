-- 灯だまり手帖 — セージとのLINE会話の記憶
-- line-webhook が直近の会話を読んで文脈をつなぐために使う。
-- Supabase の SQL Editor で一度だけ実行する。

CREATE TABLE techo_line_chat (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    text not null,            -- LINE userId
  role       text not null,            -- 'user'（ことはさん） / 'model'（セージ）
  text       text not null
);

CREATE INDEX techo_line_chat_user_time ON techo_line_chat (user_id, created_at);

ALTER TABLE techo_line_chat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON techo_line_chat
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE techo_line_chat TO authenticated;
