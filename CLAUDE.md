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
| news | 📰 | tab-news | ニュース（RSS フィード） |
| wish | ✨ | tab-wish | ウィッシュリスト |
| shop | 🛒 | tab-shop | 買い物リスト＋台所在庫 |

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
| `pantry_items` | 台所在庫（name, status: in_stock/needed, image_url, updated_by: app/line） |
| `techo_rss_feeds` | ニュースフィード定義（name, url, cat） |

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
2カラム（今日・明日）。タップで時間推移トグル。傘マーク（降水確率 40%以上）を表示。
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
`homeShopSummary`。未チェックアイテム名を `・` 区切りで最大5件表示。

---

## ウィッシュリスト仕様（2026-05 改修）

- **カテゴリ機能廃止**：WISH_CATS / WISH_CAT_COLORS 削除。追加時カテゴリ選択なし（DB には 'その他' 固定保存）
- **カードタップでGoogle検索**：`searchWish(e, title)` → `window.open('https://www.google.com/search?q='+encodeURIComponent(title), '_blank')`
- memo フィールドが URL の場合は 🔗 アイコンを表示（タップは検索に統一）
- ストライプ色：欲しいもの＝`var(--accent)`、やった！＝`var(--border)`
- ○ / × ボタンは横並び（`wish-actions` flex-direction: row）
- 細長い付箋スタイル（padding 小さめ、margin-bottom:5px）

---

## 台所在庫（マステシステム）仕様（2026-05 新規）

### 概要
買い物タブ（tab-shop）下部の `.pantry-section` に実装。
物理マステ運用（冷蔵庫にマステを貼る）のデジタル補助。

### UI
- 欠品アイテムをリスト上部にソートして表示
- ステータスバッジタップ（`togPantry(id)`）で `needed` ↔ `in_stock` 切り替え
- **✏️ボタン**: アイテム名インライン編集（`startEditPantry(id)` → `savePantryName(id)`）
- **画像なし時**: 📷（カメラ撮影）・🔗（URLパネル）の2ボタン
- **画像あり時（サムネイル）**: タップでアクションシート（`openPantryImgMenu`）が開く
  - 📷 カメラで撮り直す
  - 🔗 URLで変更する（`openPantryUrlPanel`）
  - 🗑 画像を削除する（`deletePantryImage`）
- **画像URLパネル**（`pantryUrlPanel`）:「🔍 Googleで画像を検索する」ボタン → `https://www.google.com/search?q={name}+商品&tbm=isch` を開く。URL貼り付け後にプレビュー表示。

### 主要関数
```js
renderPantry()          // 描画（欠品→在庫の順）
togPantry(id)           // ステータストグル
addPantryItem()         // アイテム追加
delPantryItem(id)       // アイテム削除（confirm付き）
startEditPantry(id)     // 名前インライン編集開始
savePantryName(id)      // 名前保存
openPantryImgMenu(id)   // 画像アクションシート表示
deletePantryImage(id)   // 画像削除（image_url → null）
openPantryUrlPanel(id)  // URL登録パネル表示
openPantryGoogleSearch()// Google画像検索を開く
uploadPantryImage(input)// カメラ写真をStorageにアップロード
```

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
