-- ════════════════════════════════════════════════════════════
-- 灯だまり手帳 健康：食品マスタ更新（2026-06）
-- Supabase SQL Editor で一度だけ実行してください。
-- ※ 過去の追加食事(health_extra_intake)は name/carb_g をスナップショット
--    保存しているため、マスタを消しても記録は消えません（food_id が null になるだけ）。
-- ════════════════════════════════════════════════════════════

-- 1) よく食べる(favorite)をいったん全解除
update health_food_master set favorite = false;

-- 2) お酒を削除（飲まないため）
delete from health_food_master
 where name in ('ビール350ml','ハイボール','ワイン','日本酒');

-- 3) 旧バージョン・差し替え対象・重複候補を掃除（呼び名を統一するため）
delete from health_food_master
 where name in (
   'フルーツパフェ',
   'ミルクティー（牛乳50ml＋蜂蜜小1）','板チョコ1かけ','ナッツ系（ひとつかみ）',
   'ミルクティー','アーモンドミルクラテ','ビターチョコ','クッキー','ナッツひとつかみ',
   'チョコナッツ','ヨーグルト（フルグラナッツ入り）','アイス（パルム）',
   'アーモンドミルクラテ（スタバ）','カフェラテ（ローソン）',
   'フルーツパフェ（ミニ）','フルーツパフェ（レギュラー）'
 );

-- 4) よく食べる8品（favorite=true・ホーム画面のワンタップ追加に出る）
insert into health_food_master (name, category, carb_g, unit, favorite, sort_order) values
  ('ミルクティー',                   '飲み物', 2.5, '1杯',  true, 1),
  ('アーモンドミルクラテ',           '飲み物', 2,   '1杯',  true, 2),
  ('ビターチョコ',                   'おやつ', 2,   '1かけ', true, 3),
  ('クッキー',                       'おやつ', 4,   '1枚',  true, 4),
  ('ナッツひとつかみ',               'おやつ', 3,   '1回',  true, 5),
  ('チョコナッツ',                   'おやつ', 5,   '1回',  true, 6),
  ('ヨーグルト（フルグラナッツ入り）', 'おやつ', 3.5, '1個',  true, 7),
  ('アイス（パルム）',               'おやつ', 10,  '1本',  true, 8);

-- 5) 飲み物を追加
insert into health_food_master (name, category, carb_g, unit, favorite, sort_order) values
  ('アーモンドミルクラテ（スタバ）', '飲み物', 4.5, '1杯', false, 13),
  ('カフェラテ（ローソン）',         '飲み物', 8,   '1杯', false, 14);

-- 6) パフェを2種に差し替え
insert into health_food_master (name, category, carb_g, unit, favorite, sort_order) values
  ('フルーツパフェ（ミニ）',         '外食', 40, '1個', false, 30),
  ('フルーツパフェ（レギュラー）',   '外食', 75, '1個', false, 31);
