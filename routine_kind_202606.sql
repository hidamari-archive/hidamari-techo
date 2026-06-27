-- 灯だまり手帖 — ルーティンを「毎日（必須・コンプ対象）」と「週単位（ゆるめ・曜日グリッド）」に分ける
-- hk_routines に kind 列を追加。既存ルーティンは全て 'daily' になる。
-- Supabase の SQL Editor で一度だけ実行。

ALTER TABLE hk_routines
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'daily';
-- kind: 'daily'（毎日必須・コンプ対象） / 'weekly'（今週のゆるめ習慣・曜日グリッド）
