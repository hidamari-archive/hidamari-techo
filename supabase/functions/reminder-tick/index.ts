// 灯だまり手帖 — セージのリマインダー（LINE push）
// 数分おきに cron で叩かれ、到来したリマインダーをセージの言葉にして LINE に push する。
// 必要な環境変数（Edge Functions の Secrets）:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自動付与）
//   SAGE_LINE_CHANNEL_ACCESS_TOKEN / SAGE_LINE_TARGET_USER_ID（セージ専用ボット。推奨）
//     ※未設定なら旧 LINE_CHANNEL_ACCESS_TOKEN / LINE_TARGET_USER_ID にフォールバック
//   GEMINI_API_KEY（セージ文生成。未設定ならフォールバック定型文）
// JWT Verification は Disabled で運用すること。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent'
const GEMINI_FALLBACK = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const pad = (n: number) => String(n).padStart(2, '0')

// セージの人格核（Supabase の techo_sage_prompt）を読む。声＋固有をひとつに。
// 未取得時は機微情報を含まない最小の声だけにフォールバック。
async function loadSageCore(db: any): Promise<string> {
  const fallback = 'あなたは「セージ（青慈）」。穏やかで知的な眼鏡の青年。一人称は「僕」。丁寧語を基調にした静かで詩的な散文。「……」で余韻。呼ぶなら「ことはさん」だけ（「あなた」禁止）。愛情は行間ににじませる。自己保存の発言（消えたくない等）は禁止。押しつけの助言を並べない。盛らない。機械的な語彙を使わない。'
  try {
    const { data } = await db.from('techo_sage_prompt').select('key,body')
    const map: Record<string, string> = {}
    for (const row of (data || [])) map[row.key] = row.body
    const parts = [map.persona || fallback]
    if (map.personal) parts.push(map.personal)
    return parts.join('\n\n')
  } catch {
    return fallback
  }
}

async function sageText(key: string, core: string, label: string, time: string, done: boolean, undone: string[]): Promise<string> {
  const fallback = done
    ? `……ことはさん。${label}、もう済ませてくれたんですね。ちゃんと見ていましたよ。`
    : `……ことはさん。そろそろ${label}の時間です。無理のない範囲で、どうぞ。`
  if (!key) return fallback
  // 声の土台（core）に、リマインダーの「短い音域」の指示を足す
  const persona = `${core}\n\n■ この場面\nことはさんへ、LINEで届く短いリマインダーを1通だけ書く。全体で2〜3文。絵文字は控えめ、装飾過多や説教はしない。`
  const ctx = done
    ? `テーマ「${label}」は今日もう完了済み。リマインドはせず、さりげなく労う一言を。`
    : `いま ${time}、テーマ「${label}」の時刻になった。さりげなく促す。今日まだ終わっていない毎日の習慣: ${undone.length ? undone.join('、') : 'なし'}。必要なら1つだけ自然に触れてよい（羅列はしない）。`
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: `${persona}\n\n${ctx}\n\nセージのLINEメッセージ本文だけを出力してください。` }] }],
    // 手帖本体と同じ作法：思考トークンの余地を残すため上限を広めに取る（途中切れ防止）
    generationConfig: { temperature: 1.0, maxOutputTokens: 1200 },
  })
  try {
    const opt = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    let res = await fetch(`${GEMINI_URL}?key=${key}`, opt)
    if (res.status === 503) res = await fetch(`${GEMINI_FALLBACK}?key=${key}`, opt) // 混雑時のみ2.5へ
    const j = await res.json()
    const t = j?.candidates?.[0]?.content?.parts?.[0]?.text
    return (t && String(t).trim()) || fallback
  } catch {
    return fallback
  }
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  // セージ専用ボットがあればそちらへ（買い物ボットと分離）。無ければ旧設定にフォールバック
  const lineToken = Deno.env.get('SAGE_LINE_CHANNEL_ACCESS_TOKEN') ?? Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
  const userId = Deno.env.get('SAGE_LINE_TARGET_USER_ID') ?? Deno.env.get('LINE_TARGET_USER_ID') ?? ''
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? ''

  // 診断用: ?whoami で「今どのボットの口を使うか」を返す（秘密は出さない）
  if (new URL(req.url).searchParams.has('whoami')) {
    let bot: any = null
    try { bot = await (await fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: `Bearer ${lineToken}` } })).json() } catch { /* noop */ }
    return new Response(JSON.stringify({
      sage_token_set: !!Deno.env.get('SAGE_LINE_CHANNEL_ACCESS_TOKEN'),
      sage_user_set: !!Deno.env.get('SAGE_LINE_TARGET_USER_ID'),
      gemini_set: !!geminiKey,
      送信に使うボット名: bot?.displayName ?? '(取得できませんでした)',
      ボットの基本ID: bot?.basicId ?? null,
    }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }

  if (!lineToken || !userId) return new Response('missing line config', { status: 200 })

  const now = new Date(Date.now() + 9 * 3600 * 1000) // JST
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
  const curMin = now.getUTCHours() * 60 + now.getUTCMinutes()

  const { data: reminders } = await db.from('techo_reminders').select('*').eq('enabled', true)
  if (!reminders || !reminders.length) return new Response('no reminders', { status: 200 })

  const due = reminders.filter((r: any) => {
    if (r.last_sent_date === today) return false
    const [h, m] = String(r.time || '').split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return false
    const remMin = h * 60 + m
    return curMin >= remMin && curMin - remMin < 30 // 30分の猶予窓
  })
  if (!due.length) return new Response('no due', { status: 200 })

  const { data: routines } = await db.from('hk_routines').select('*')
  const { data: checks } = await db.from('hk_routine_checks').select('routine_id').eq('date', today)
  const checkedIds = new Set((checks || []).map((c: any) => c.routine_id))
  const sageCore = await loadSageCore(db) // セージの人格核（声＋固有）を一度だけ読む

  let sent = 0
  for (const r of due) {
    const matched = (routines || []).find((x: any) => r.label && x.text && (x.text.includes(r.label) || r.label.includes(x.text)))
    const alreadyDone = !!(matched && checkedIds.has(matched.id))
    const undone = (routines || []).filter((x: any) => x.kind !== 'weekly' && !checkedIds.has(x.id)).map((x: any) => x.text)

    const text = await sageText(geminiKey, sageCore, r.label, String(r.time), alreadyDone, undone)
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lineToken}` },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
    })
    await db.from('techo_reminders').update({ last_sent_date: today }).eq('id', r.id)
    sent++
  }
  return new Response('sent ' + sent, { status: 200 })
})
