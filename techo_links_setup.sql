-- 灯だまり手帖 — 情報タブ「便利リンク」用テーブル
-- Supabase の SQL Editor で一度だけ実行する。

CREATE TABLE techo_links (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  url         text not null,
  sort_order  int default 0
);

ALTER TABLE techo_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_only" ON techo_links
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 2026-10-30 以降の新規テーブルは Data API への明示公開が必要
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE techo_links TO authenticated;
