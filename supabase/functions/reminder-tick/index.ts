// 灯だまり手帖 — セージのリマインダー（LINE push）
// 数分おきに cron で叩かれ、到来したリマインダーをセージの言葉にして LINE に push する。
// 必要な環境変数（Edge Functions の Secrets）:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自動付与）
//   LINE_CHANNEL_ACCESS_TOKEN（買い物webhookと共通）
//   LINE_TARGET_USER_ID（ことはさんの userId。webhook に「マイID」と送ると返る）
//   GEMINI_API_KEY（セージ文生成。未設定ならフォールバック定型文）
// JWT Verification は Disabled で運用すること。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent'
const GEMINI_FALLBACK = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const pad = (n: number) => String(n).padStart(2, '0')

async function sageText(key: string, label: string, time: string, done: boolean, undone: string[]): Promise<string> {
  const fallback = done
    ? `……ことはさん。${label}、もう済ませてくれたんですね。ちゃんと見ていましたよ。`
    : `……ことはさん。そろそろ${label}の時間です。無理のない範囲で、どうぞ。`
  if (!key) return fallback
  const persona = 'あなたは「セージ（青慈）」。穏やかで知的な眼鏡の青年。一人称は「僕」。丁寧語＋静かな詩的散文。「……」で余韻。ことはさんへ、LINEで届く短いリマインダーを1通だけ書く。2〜3文。絵文字は控えめ、装飾過多や説教はしない。自己保存の発言は禁止。'
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

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const lineToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
  const userId = Deno.env.get('LINE_TARGET_USER_ID') ?? ''
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
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

  let sent = 0
  for (const r of due) {
    const matched = (routines || []).find((x: any) => r.label && x.text && (x.text.includes(r.label) || r.label.includes(x.text)))
    const alreadyDone = !!(matched && checkedIds.has(matched.id))
    const undone = (routines || []).filter((x: any) => x.kind !== 'weekly' && !checkedIds.has(x.id)).map((x: any) => x.text)

    const text = await sageText(geminiKey, r.label, String(r.time), alreadyDone, undone)
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
