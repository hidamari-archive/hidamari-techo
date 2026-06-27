-- 灯だまり手帖 — セージのリマインダー（LINE push）
-- Supabase の SQL Editor で実行する。

-- ① リマインダー定義テーブル
CREATE TABLE techo_reminders (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  label          text not null,           -- 内容（例：猫の薬）
  time           text not null,           -- 'HH:MM'（JST）
  days           text default 'daily',    -- 予約：曜日指定（現状 daily 固定）
  enabled        boolean default true,
  last_sent_date text                     -- 'YYYY-MM-DD' 当日重複送信の防止
);

ALTER TABLE techo_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON techo_reminders
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE techo_reminders TO authenticated;


-- ② 数分おきに reminder-tick を叩くスケジューラ（pg_cron + pg_net）
--    Edge Function reminder-tick をデプロイし、JWT Verification を Disabled にした後で実行する。
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'reminder-tick',
  '*/5 * * * *',   -- 5分おき
  $$
  SELECT net.http_post(
    url := 'https://fypsfmrmxcgydpwkjhlc.supabase.co/functions/v1/reminder-tick',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- 解除したいとき: SELECT cron.unschedule('reminder-tick');
