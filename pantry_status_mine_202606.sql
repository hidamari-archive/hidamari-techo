-- 灯だまり手帖 — 在庫(pantry_items)に4つ目の状態 'mine'（自分で買う／LINEに出さない）を追加
-- Supabase の SQL Editor で一度だけ実行する。
-- 既存の CHECK 制約（in_stock / needed / amazon の3値）を作り直し、'mine' を許可する。

ALTER TABLE pantry_items DROP CONSTRAINT IF EXISTS pantry_items_status_check;

ALTER TABLE pantry_items
  ADD CONSTRAINT pantry_items_status_check
  CHECK (status IN ('in_stock', 'needed', 'amazon', 'mine'));
