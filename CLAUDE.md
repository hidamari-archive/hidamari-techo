# 灯だまり手帳 — アプリ仕様

`C:\data\hidamari_techo\index.html` の単一ファイル PWA。
共通方針は `C:\data\CLAUDE.md` 参照。

---

## ファイル構成

```
index.html                                    ── アプリ全体（HTML + CSS + JS すべてここ）
apple-touch-icon.png
supabase/functions/line-webhook/index.ts      ── LINE Webhook（Deno/Edge Function）
資料/マステシステム補助_仕様書.md            ── 台所在庫システム設計書
```

---

## タブ構成（ボトムタブバー）

| タブ key | アイコン | id | 概要 |
|---|---|---|---|
| home | 🏠 | tab-home | ホーム（天気・予定・くらしサマリー・買い物サマリー・セージ） |
| seiiki | ☑ | tab-seiiki | くらし（ルーティン・今日のタスク・捨て活ログ・設定） |
| health | 🌿 | tab-health | 健康（糖質量×体感マネジメント。朝の体感入力・食事追加・ベース食・デイリーサマリー） |
| news | 📋 | tab-news | 情報（📰ニュース / 🔗便利リンク / ✨ひらめき の3サブタブ） |
| shop | 🧺 | tab-shop | ほしいもの（🛒買い物 / 🧺在庫 / 💫ウィッシュ の3サブタブ） |

> **2026-06 改修**: 旧「ニュース」タブ（tab-news・key `news`・id 据え置き）を「情報」に改称し、`switchInfoTab(tab)`（tab: `news`/`links`/`flash`）でサブタブ化。`switchShopTab` の `flash`（ひらめき）を情報タブへ移設し、買い物サブタブは3つに。便利リンクは `techo_links` テーブル＋遅延ロード（`loadLinks`/`renderLinks`/`addLink`/`delLink`）。

> **2026-05 改修**: 旧「ウィッシュ」タブ（tab-wish）を廃止し、買い物タブに吸収。ボトムタブは5→4。タブ名「買い物」→「ほしいもの」🧺。`switchWishTab` は廃止し `switchShopTab(tab)` に統合（tab: `memo`/`stock`/`wishlist`/`flash`）。FAB（wishFab）は shop タブ＋wishlist サブタブ時のみ表示。

`switchTab(tab)` でパネル切替。ニュースタブは初回訪問時に `loadNews()` を呼ぶ（`_newsLoaded` フラグ）。

### タブスワイプ（2026-05）
- `.app-content` 全体で touchstart/touchend を検知
- **横スクロール可能な要素の上でのスワイプはタブ切り替えをスキップ**（`_isHScrollable()` で祖先要素を遡って判定）
- 閾値: 80px 以上 かつ 縦移動の 2 倍以上の横移動のみ反応

---

## Supabase テーブル

接続情報は共通 CLAUDE.md のものをそのまま使用。

| テーブル | 用途 |
|---|---|
| `hk_routines` | 毎日のルーティン定義（text, sort_order） |
| `hk_routine_checks` | ルーティン完了記録（date, routine_id） |
| `hk_tasks` | 今日のタスク（text, done, done_date） |
| `hk_discard_log` | 一日一捨て記録（date, text, done） |
| `hk_daily_meta` | セージメッセージ管理（date, routine_message_shown, routine_rarity） |
| `hk_long_tasks` | 長期タスク（text, type: once/repeat, done） |
| `hk_weekly_tasks` | 週間タスク（text, last_done_week: YYYY-MM-DD） |
| `wishlist` | ウィッシュリスト（title, category, memo, status: want/done, completed_at） |
| `shopping_list` | 買い物リスト（item, category, checked） |
| `pantry_items` | 台所在庫（name, status: in_stock/needed/amazon, image_url, category, updated_by: app/line） |
| `flash_memos` | ひらめきメモ（text）※情報タブに移設 |
| `techo_links` | 便利リンク集（name, url, sort_order）※情報タブ。`techo_links_setup.sql` で作成 |
| `techo_rss_feeds` | ニュースフィード定義（name, url, cat） |
| `health_food_master` | 食品マスタ（name, category, carb_g, kcal, unit, favorite, sort_order） |
| `health_base_meal` | ベース食設定（meal: 朝/昼/夜・unique, carb_g, description） |
| `health_daily_log` | 日次記録（date・unique, weight_kg, swelling, fatigue, abdomen, skip_*, memo） |
| `health_extra_intake` | 追加食事（date, food_id, name/carb_g スナップショット, quantity, eat_time） |

グローバル `D` オブジェクトにすべてのデータをキャッシュ。`loadData()` で一括取得、`renderAll()` で全描画。

> **RLS注意**: 2026-04 よりSupabase Auth導入済み。新テーブルは必ずRLSを有効にしてauth_onlyポリシーを設定すること（共通 CLAUDE.md 参照）。

### Supabase Storage（2026-05 追加）
- バケット: `pantry-images`（公開バケット）
- パス: `{item_id}.{ext}`（アイテムID＋拡張子）
- RLSポリシー: `FOR ALL TO authenticated` で `bucket_id = 'pantry-images'` の単一ポリシー

---

## 外部 API

### 天気（Open-Meteo）
- エンドポイント: `https://api.open-meteo.com/v1/forecast`
- 位置: 流山市付近（lat=35.8969, lon=139.9401）
- `forecast_days=2`、hourly（temperature_2m, precipitation_probability, weathercode, **surface_pressure**）+ daily 取得
- キャッシュ: `localStorage['hidamari_weather_v3']`（1時間）
- 今日・明日の日別データ + `hourly_today` / `hourly_tomorrow` に分割保持
- 時間推移は初期非表示。今日・明日エリアをタップするとトグル表示

#### 気圧表示（2026-05 追加）
- `pressureRisk`（low/mid/high）・`pressureCur`（現在値）・`pressureChange`（6時間変化幅）・`pressureDir`（drop/rise）をキャッシュ
- `pressureHours_today` / `pressureHours_tomorrow`：3時間ごとの気圧値配列もキャッシュ
- ホームの天気カードに `pressure-row`（バッジ）を表示。**タップで展開**（`togPressureDetail()`）
- 展開すると今日→明日の時間別グラフ（`.ph-row`）が横スクロールで表示
- 3時間あたりの変化量で ±6hPa以上→💣 / ±3〜6hPa→⚠️ / 小変化→↑↓→
- **上昇も下降も同じ閾値で警告**（ことはさんは急上昇でも不調になるため）

### カレンダー（Google iCal）
- プロキシ: `https://corsproxy.io/?` + iCal URL
- iCal URL は設定タブで入力・`localStorage['hidamari_ical_url']` に保存
- 今日・明日のイベントを `calEvents` / `calTomorrowEvents` に表示
- **RRULE対応済み**: `doesRRuleOccurOnDate()` で繰り返しイベントを展開（DAILY/WEEKLY/MONTHLY/YEARLY + UNTIL/EXDATE対応）
- `RECURRENCE-ID` を持つイベント（展開済み個別インスタンス）はRRULE処理をスキップ

### ニュース（RSS）
- プロキシ: `https://corsproxy.io/?` + RSS URL（rss2json.com は使わない）
- ブラウザ内蔵 `DOMParser` で XML をパース（RSS 2.0 / Atom / **RDF/RSS 1.0** 対応）
  - RDF対応: `doc.querySelectorAll('item')` でフォールバック取得、`dc:date` は `localName==='date'` で取得
  - パース失敗時は空配列をキャッシュしない（`if(items.length>0)setNewsCache()`）
- キャッシュ: `localStorage['hidamari_news_<id>']`（30分）
- フィード一覧: `techo_rss_feeds` テーブル（Supabase）で管理
- カテゴリはフィードの `cat` フィールドから自動生成（`getNewsCats()`）
- **Google ニュース RSS**: `https://news.google.com/rss/search?q=キーワード&hl=ja&gl=JP&ceid=JP:ja` でキーワード検索も登録可能

#### ニュース UI
- ヘッダーに ⚙（フィード管理トグル）と ↺（強制リロード）
- ⚙ タップで管理パネルがカテゴリ行の上に展開（アクティブ時はアクセントカラー）
- 管理パネル: 追加フォーム（名前・URL・カテゴリ自由入力）+ 登録済みフィード一覧と削除
- フィード追加後はキャッシュ破棄して自動再読み込み

---

## ホームタブの各カード

### 天気カード
横1行コンパクト（今日・明日を `.wc-sep` で左右に並べた flex 行）。タップで時間推移トグル。
天気テキスト（「晴れ」等）・傘マークは廃止。アイコン＋気温＋降水確率のみ表示。
気圧バッジ（タップで時間別グラフ展開）を天気カード内に表示。

### セージのおすすめカード
`sageWishCard`。Gemini API でウィッシュ推薦文を生成。
「今日はいいかな」タップで当日中非表示（`localStorage['hidamari_sage_s_cache']` に `__dismissed__` を保存）。
**現在一時停止中**（`initSageMessages` でウィッシュ提案呼び出しをコメントアウト）。

### くらしサマリーカード
`homeSeiikiSummary`（`updateHomeSummary()` で更新）。※旧称「聖域サマリー」
- ルーティン達成率: `■□` ドットで表示（`mkDots(done,total)`）
- 未完タスク名
- 週間タスク: 未完のものを「週」バッジ付きで表示。件数を `X/Y` 形式で表示
- 一日一捨て: 捨てたアイテム名 or「🗑 まだです」
- **台所在庫の欠品アイテムを赤文字で表示**
- すべて完了（ルーティン・通常タスク・週間タスク）で👑表示

### セージ簡易チャットカード
`sageChatCard`。ホームカード最下部。Gemini APIキー設定済み時のみ表示。
- セッション内のみ会話履歴を保持（`_sageChatHistory`）。ページリロードでリセット
- システムプロンプト: `SAGE_CHAT_SYSTEM`（`sage_prompt.txt` の内容をコード内に埋め込み）
- 毎回の送信時に手帖コンテキスト（カレンダー・ルーティン・タスク・ウィッシュ・買い物リスト）をシステムプロンプトに付加
- `system_instruction` 非対応モデルのため、先頭の user/model ペアにシステム文脈を埋め込む方式
- 返答の下にモデル名を小さく表示（`gemini-3-flash-preview` / fallback時は `2.5-flash (fallback)`）
- `maxOutputTokens:1200`（長いシーン文が切れないよう設定）
- チャットラベルはテキストなし（🕯アイコンのみ）

### 買い物リストカード
`homeShopSummary`。買い物メモ（未チェック）と台所在庫の欠品アイテムを表示。
タップ先を分岐: 買い物メモ行タップ→買い物タブの「買い物メモ」サブタブ / 欠品行タップ→「在庫管理」サブタブ。

---

## ウィッシュリスト仕様（2026-05 改修）

- **カテゴリ機能廃止**：WISH_CATS / WISH_CAT_COLORS 削除。追加時カテゴリ選択なし（DB には 'その他' 固定保存）
- **カードタップでGoogle検索**：`searchWish(e, title)` → `window.open('https://www.google.com/search?q='+encodeURIComponent(title), '_blank')`
- memo フィールドが URL の場合は 🔗 アイコンを表示（タップは検索に統一）
- ストライプ色：欲しいもの＝`var(--accent)`、やった！＝`var(--border)`
- ○ / × ボタンは横並び（`wish-actions` flex-direction: row）
- 細長い付箋スタイル（padding 小さめ、margin-bottom:5px）

### ひらめきメモ（2026-06：情報タブへ移設）
旧・買い物タブ内のひらめきメモは**情報タブの ✨ひらめき サブタブ**に移動済み。
- **✨ ひらめきメモ**: `flash_memos` テーブル。テキスト入力のみシンプルな一覧（`info-stab-flash`）
  - `addFlashMemo()` / `delFlashMemo(id)` / `renderFlashMemos()`
  - 作成日時を `M/D HH:mm` 形式で表示
  - 新着順（`created_at DESC`）

**flash_memos テーブル作成 SQL**（初回のみ実行）:
```sql
CREATE TABLE flash_memos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  text       text not null
);
ALTER TABLE flash_memos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON flash_memos
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
```

### 便利リンク サブタブ（2026-06 追加）
情報タブの 🔗便利リンク。バス時刻表など、よく見るサイトのリンク集。
- `techo_links` テーブル（name, url, sort_order）。`techo_links_setup.sql` で作成（RLS＋GRANT）
- `_linksLoaded` フラグで遅延ロード（`loadLinks`）。サブタブ初回表示で取得
- `addLink()`: URL欄のみ必須。`http(s)://` が無ければ自動付与（`javascript:` 等のスキーム注入もこの前置で無害化）。名前未入力ならホスト名を自動採用
- `renderLinks()`: `<a target="_blank" rel="noopener">` で別タブ表示。`delLink(id)` で削除

---

## 買い物タブ（tab-shop）サブタブ構成（2026-05 追加）

`switchShopTab(tab)` で切り替え。タブキー: `list` / `pantry`。
- **🛍 買い物メモ**: `shopping_list` テーブル。個人用（絵具・化粧品等）の買い物メモ
  - **在庫サジェスト（2026-06）**: 入力中に `pantry_items` の品名と部分一致照合し、入力欄下にサジェスト表示（`renderShopSuggest`）。タップで `quickNeed(id)`→`setPantryStatus(id,'needed')` でワンタップ欠品化。在庫が増えて探しづらい問題への対処（メモ入力＝必要物の入口に統合）
- **📦 在庫管理**: `pantry_items` テーブル。台所在庫マステシステム（LINE連携あり）
  - **＋追加のカテゴリ既定値（2026-06）**: `togPantryAdd` 展開時、カテゴリ絞り込み中（`_pantryFilter` が `cat:*`）ならそのカテゴリを追加先に自動選択

---

## 台所在庫（マステシステム）仕様（2026-05）

### 概要
買い物タブ（tab-shop）の「📦 在庫管理」サブタブ内に実装。
物理マステ運用（冷蔵庫にマステを貼る）のデジタル補助。

### ステータス 4値（2026-06 に `mine` 追加）
| status | バッジ | 意味 |
|---|---|---|
| `in_stock` | 🟢 | 在庫あり |
| `needed` | 🔴 | 欠品（LINE連携で通知対象） |
| `amazon` | 📦 | Amazon購入品 |
| `mine` | 🛒 | 自分で買う（カルディ・ドラスト等。**LINEには出さない**） |

CHECK制約: `pantry_items_status_check CHECK (status IN ('in_stock', 'needed', 'amazon', 'mine'))`
**`mine` 追加には `pantry_status_mine_202606.sql` を SQL Editor で一度実行**（旧3値の制約を作り直す）。
ステータスの定義は `PANTRY_STATUSES`/`PANTRY_ICON`/`PANTRY_LABEL` に集約。バッジタップ→`openStatusMenu`→他3状態へ任意に変更可（旧来の in_stock⇄欠品/Amazon だけでなく欠品→Amazon等も直接可）。
LINE webhook は `status='needed'` のみ参照するため、`mine`/`amazon` は夫さんのリストに出ない。

### 買い物メモサブタブの行き先別リスト（2026-06）
`renderShop` 末尾の `buySection(status,title)` で 🔴欠品 / 📦Amazon待機 / 🛒自分で買う を順に表示。
- 行タップ＝買った（→`in_stock`）。各行の `.buy-reroute` 小ボタンで他の行き先へワンタップ変更
- サジェスト（`renderShopSuggest`）のタップは既定で欠品化（`quickNeed`）。Amazon/自分への振り分けは下のリストで行う

### カテゴリ管理
`pantry_items.category` カラム（text）。アイテム追加モーダルで自由入力。デフォルト `''`（未分類）。

### フィルター（2段レイアウト）
- **上段（濃い `.pantry-filter-btn`）**: ステータスフィルター — 全て / 🔴欠品 / 📦Amazon / 🟢在庫
- **下段（薄い `.pantry-filter-cat-btn`）**: カテゴリフィルター — 全カテゴリ + 登録済みカテゴリ
- `_pantryFilter`（status）/ `_pantryFilterCat`（category）で状態保持

### ソート
あいうえお順（`byName`）。ステータス変更時に位置が動かない（ソートをステータス優先からあいうえお順に変更）。

### UI
- **アイテム追加**: ＋ボタンタップで追加モーダル（`openAddPantryModal()`）。名前・カテゴリ・ステータスをまとめて設定
- **名前編集**: ✏️ボタンタップで編集モーダル（`openEditPantryModal(id)`）。広いテキスト入力で操作しやすい
- **画像なし時**: 📷（カメラ撮影）・🔗（URLパネル）の2ボタン
- **画像あり時（サムネイル）**: タップでアクションシート（`openPantryImgMenu`）が開く
  - 📷 カメラで撮り直す
  - 🔗 URLで変更する（`openPantryUrlPanel`）
  - 🗑 画像を削除する（`deletePantryImage`）
- **画像URLパネル**（`pantryUrlPanel`）:「🔍 Googleで画像を検索する」ボタン → `https://www.google.com/search?q={name}+商品&tbm=isch` を開く。URL貼り付け後にプレビュー表示。

### Amazon連携
- `status=amazon` のアイテムには 🔍 ボタン（`searchAmazonItem(name)`）→ Amazonで商品名検索
- `_pantryFilter==='amazon'` 時にバナー表示: 「また買うリスト」へのリンク（`https://www.amazon.co.jp/gp/buyagain`）

### DBエラーハンドリング（ロールバック付き）
`setPantryStatus(id, status)` は楽観的UI更新＋ロールバック方式:
- DB書き込みエラー時に `prevStatus` へ戻す
- `alert()` でユーザーにエラー内容を通知

### 主要関数
```js
renderPantry()              // 描画（フィルター＋あいうえお順）
setPantryStatus(id,status)  // ステータス変更（ロールバック付き）
openAddPantryModal()        // 追加モーダル表示
addPantryItem()             // アイテム追加（モーダルから）
delPantryItem(id)           // アイテム削除（confirm付き）
openEditPantryModal(id)     // 名前編集モーダル表示
savePantryName(id)          // 名前保存
openPantryImgMenu(id)       // 画像アクションシート表示
deletePantryImage(id)       // 画像削除（image_url → null）
openPantryUrlPanel(id)      // URL登録パネル表示
openPantryGoogleSearch()    // Google画像検索を開く
uploadPantryImage(input)    // カメラ写真をStorageにアップロード
searchAmazonItem(name)      // Amazon商品名検索を開く
```

---

## 健康タブ（tab-health）仕様（2026-05 Phase 2）

糖質量×体感（むくみ・だるさ）のマネジメントツール。仕様書: `資料/hidamari_health_spec_v1.md`。
**初回のみ `health_setup.sql` を Supabase SQL Editor で実行**（4テーブル＋RLS＋ベース食3行＋食品マスタ初期データ）。

### 設計の芯
- 目的は「見た目」でなく「体感」。記録コストを最小化。未入力日も咎めない（赤字・警告色なし）。
- ベース食（朝昼夜の定型）を自動加算し、追加で食べた分だけ記録する方式。

### カード構成（縦並び・単一パネル）
1. **今日のサマリー**（`renderHealthSummary`）: 本日の糖質量（大数字）＋快適ゾーンバッジ／体重／体感／7日平均糖質量
2. **今朝の体感**（`renderHealthMorning`）: むくみ・だるさ 1〜5（**1=軽い / 5=強い**、再タップで解除）／お腹3択／体重
3. **追加で食べた**: カード上部に**「よく食べる」ワンタップ追加チップ**（`renderHealthQuick`／favorite食品を画面遷移なく `healthQuickAdd` で数量1即追加）。「＋ ほかのものを追加」で `openHealthFood`→ピッカー：食品マスタを**複数トグル選択**（`_hFoodSel={food_id:数量}`）、選択行に個数チップ（**¼/½/1/2個**＝`HEALTH_QTYS`）、下部ボタンに件数＋合計糖質を表示し`healthAddSelected`で一括 insert。新規食品はその場で登録し自動選択。`healthToggleFood`/`healthSetFoodQty`/`healthUpdateAddBtn`
4. **ベース食**（`renderHealthBase`）: 朝昼夜の糖質量表示＋今日のスキップトグル（食べた/抜き）。`openHealthBase` で carb_g・内容を編集
5. **推移グラフ**（`renderHealthTrend`／タイトル `📈 推移（N日）` は動的）: インラインSVGグラフ（横スクロール）。糖質をゾーン色の棒、体重を折れ線で重ね、170g注意ラインを点線表示。下部に「む（むくみ）/だ（だるさ）」を日ごとの色付き番号ドットで帯表示。`feelColor(n)` で 1=teal→5=coral。`healthDayData(n)` が日次配列を生成。**表示日数Nは「最古の記録日〜今日」を `[14, HEALTH_DAYS(=90)]` でクランプ**（`healthEarliestDate`）。記録が増えるほどグラフも伸びる
   - 開いたとき直近（右端）が見えるよう、描画後に親 `.health-chart-scroll` を `scrollLeft=scrollWidth` で右寄せ
   - 各日に透明な `<rect onclick=healthEditDay(date)>` を重ね、棒・体感ドットどこでもタップでその日の登録に切替（`_hDate` 設定→`renderHealth`→体感カードへスクロール）。選択中の日は列を `var(--accent)` で淡くハイライト＋日付ラベルをアクセント色太字
6. **糖質と体感のつながり**（`renderHealthCorr`）: 前日糖質→翌朝体感の相関。体感記録のある日を前日糖質でソートし中央値で上下半分に分割（`healthCorrPairs`）、各群のむくみ・だるさ平均を2ボックス比較＋差0.4以上で言葉のコメント（`healthCorrPhrase`）。記録4日未満は咎めず待つ空状態メッセージ
   - 描画は `renderHealth` と `renderHealthSummary` の末尾から呼ばれ、体感・体重・スキップ・食事の変更時に自動追従

### さかのぼり入力（2026-05 追加）
- グローバル `_hDate`（空＝今日）が「記録対象日」。`hDate()`＝`_hDate||gt()`、`hCur()`＝対象日のlog、`hLog(date)` ヘルパー
- 体感カードの日付バー（`#hDateBar`）: ◀ / `<input type=date>` / ▶ / 「今日へ」。`hShiftDate(±1)`・`hPickDate()`・`hResetDate()`。min＝`HEALTH_DAYS`(=90)日前・max＝今日
- 対象日が今日でないとき日付バーが琥珀色（`.back`）になり、サマリー・体感・追加食事・ベース食スキップがすべてその日に切り替わる（見出しも `M/D` 表示に）
- 書き込みは `healthUpsert(patch)`（旧 `healthUpsertToday` を対象日対応にリネーム）。食事追加 `healthAddIntake` も `date=hDate()`
- 半月ぶんの体重・だるさ・チートデー（品目から追加）をまとめて遡り登録する用途

### 快適ゾーン（`healthZone(carb)`）
〜70🟢快適 / 〜120🟡通常 / 〜170🟠注意 / 170〜🔴閾値超え（本人の体感で運用しながら調整）

### データ
- `D.hFood`（食品マスタ）/ `D.hBase`（{朝,昼,夜} マップ）/ `D.hDaily`（直近`HEALTH_DAYS`=90日）/ `D.hExtra`（直近90日）
- 日次記録は `date` を一意キーに `upsert(onConflict:'date')`。`healthUpsert(patch)` が局所更新＋DB反映
- 糖質計算: `healthCarbForDate(date)` = ベース（スキップ反映）＋追加分。`healthAvg7()` で7日平均
- **食品マスタ更新は `health_food_update_202606.sql`**（よく食べる8品の差し替え・飲み物/パフェ追加・お酒削除）。過去の `health_extra_intake` は name/carb スナップショットのため、マスタ削除しても記録は残る

### 残（Phase 3 以降）
- 散布図（前日糖質×翌朝体感の点プロット）は今回見送り。相関は中央値2群比較で代替
- リマインダー（未入力日のみ表示するアプリ内カード）・お気に入り編集・食品マスタ本格編集

---

## LINE連携（マステシステム）

### Supabase Edge Function
- ファイル: `supabase/functions/line-webhook/index.ts`（Deno）
- **JWT Verification: Disabled**（LINE→Supabaseのリクエストにはトークンがないため必須設定）
- HMAC-SHA256 でLINE署名検証
- 環境変数: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`（Supabase Dashboard → Edge Functions → Secrets）

### 対応コマンド
- `リスト` / `買い物` / `ある？` / `何がいる` / `買い物ある` → `pantry_items` の `status=needed` を取得して返信
- それ以外 → 使い方案内

### 返信形式
- 欠品画像（最大4枚）を先に送信、テキストリストを最後に送信
- 1メッセージ最大5件（LINE Reply APIの上限）
- テキストリスト末尾に取得日時を JST で `📅 YYYY/MM/DD HH:mm 時点` 形式で表示

---

## 聖域タブ（「くらし」タブ）仕様

サブタブ: 今日 / 週間タスク / 長期タスク / **捨て活ログ** / 設定

- ボトムタブ・ホームカードの「聖域」表記を「くらし」に変更済み
- サブタブバー `.seiiki-tabs` は `position:sticky; top:var(--header-h)` でヘッダー直下に固定
- ルーティン: 毎日リセット。`hk_routine_checks` にチェック記録
- 今日のタスク: `done_date` が今日 or 未完のものを表示。週間タスク（未完）も先頭に自動表示（「週」バッジ付き）
- 週間タスク: `hk_weekly_tasks` テーブル。`last_done_week`（月曜日の YYYY-MM-DD）で完了週を管理
- 一日一捨て: **今日タブには存在しない。すべて「捨て活ログ」タブに集約済み**
- 設定タブ: Gemini API キー・Google カレンダー iCal URL・PIN 設定・全データ消去

---

## 捨て活スタンプカード仕様

### 概要
捨て活ログタブ（`stab-disclog`）の先頭に表示される20枠ポイントカード。

### カード枚数・マイルストーン
```js
const DISCARD_CARD_SIZE = 20;
// posInCard = D.discardLog.length % 20
// crowns    = Math.floor(D.discardLog.length / 20)
```

| 位置 | 報酬レア度 |
|---|---|
| 5個目 | R（★★★） |
| 10個目 | SR（★★★★） |
| 20個目 | SSR（★★★★★）＋カード完了→王冠👑++ |

通常（非マイルストーン）はフルガチャ（C〜SSR）。

### ガチャメッセージ
- `triggerDiscardGacha(itemText)` → `fetchDiscardGachaMsg()` → `showDiscardGachaResult()`
- セージラベルは「セージより」ではなく `「○○」を手放して` 形式

### 捨て活ログ UI
- `renderDiscardLog()`: 同じ日のアイテムを同一行にチップ形式で並べる
- 各チップに × 削除ボタン（`delD(id)`）

---

## デザイン

iro_note の配色に統一（ライトテーマ）:

```css
--bg:#f5f0e8;        /* クリーム背景 */
--bg-card:#faf7f2;   /* カード面 */
--bg-warm:#ede8df;   /* セクション背景 */
--text:#3a3530;
--text-light:#7a7268;
--text-faint:#b0a898;
--accent:#8b7355;    /* ブラウン系アクセント */
--border:#ddd8ce;
--radius:14px; --radius-sm:10px;
```

フォント: Shippori Mincho（タイトル・詩） + Zen Kaku Gothic New（UI）

### 捨て活カラー（ミントグリーン系）

```css
--discard-done:#7EC4C0;
--discard-done-bg:#EAF5F4;
--discard-bar:linear-gradient(90deg,#B0DDD9,#7EC4C0);
```

---

## ヘッダー（2026-05 改修）

1行レイアウト。左に `🕯`（テキストなし、夫に見せるためブランド表記を最小化）、右に日付＋曜日＋祝日バッジ。
フッターの「灯だまり工房」文字も削除し 🕯 のみ。

```js
const HOLIDAYS = { '2026-01-01':'元日', ... };
function updateDate() { /* 毎分更新 */ }
```

---

## Google カレンダー（2カレンダー対応）

| 設定 | localStorage キー | 表示スタイル |
|---|---|---|
| メインカレンダー | `hidamari_ical_url` | `font-weight:600`（太字） |
| ルーティンカレンダー | `hidamari_ical_url2` | `font-weight:400; color:var(--text-light)`（通常） |

- **明日の予定はメインカレンダーのみ表示**
- キャッシュ: `ICAL_CACHE`（メイン）/ `ICAL_CACHE2`（ルーティン）

---

## コーディング規約

- **ミニファイスタイル**: CSS・JS ともにセミコロン区切りで1行にまとめた圧縮記述
- **`esc()` 関数**: HTML エスケープ。ユーザー入力を innerHTML に入れるときは必ず使う
- **`dbw()` 関数**: Supabase 書き込みのエラーハンドリングラッパー
- **`gt()` 関数**: 今日の日付を `YYYY-MM-DD` で返す
- **`getWeekKey()` 関数**: 今週月曜日の日付を `YYYY-MM-DD` で返す

---

## Gemini API（2026-05 更新）

```js
const GEMINI_URL = '...gemini-3-flash-preview:generateContent';      // メイン
const GEMINI_URL_FALLBACK = '...gemini-2.5-flash:generateContent';   // 503時のみ
```

- **`callGemini(prompt)`**: JSON応答を期待する共通関数
- **`callGeminiText(prompt)`**: 単発テキスト生成
- **`system_instruction` フィールドは使わない**（非対応）。先頭の user/model ペアに埋め込む方式
- APIキーは `localStorage['iro_keys'].gemini` に保存（iro_note と共通）

---

## セージメッセージ仕様（2026-05 v2）

### 捨て活ガチャ（`fetchDiscardGachaMsg`）
`callGemini` ではなく直接 `fetch` でプレーンテキストを受け取る実装。
灯だまりの家の一場面（台詞・仕草・空気感が混ざった散文）を1つ返す形式。

### ルーティン完了メッセージ（`fetchRoutineMsg`）
`callGemini` でJSON取得。出力形式:
```json
{"anniversary_name":"","anniversary_desc":"","scene":"（\\n区切り）","rarity":"★の数"}
```

### 禁止ワード（全メッセージ共通）
貴女・潔さ・澄み渡る・輝かせる・証明・断捨離・ふわり・理想の自分に近づいている・確かな変化・軽くなりました・余白・新しい余白・次に大切なものが入ってきます
