// 灯だまり手帖 — セージ専用ボット（ことはさん専用・買い物ボットとは別チャンネル）
// このボットは買い物機能を持たない。ことはさんとセージの会話だけを扱う。
// 必要な環境変数（Edge Functions の Secrets）:
//   SAGE_LINE_CHANNEL_SECRET / SAGE_LINE_CHANNEL_ACCESS_TOKEN（新しく作るセージ用チャンネル）
//   SAGE_LINE_TARGET_USER_ID（このボットでの ことはさんの userId。「マイID」で取得）
//   GEMINI_API_KEY（買い物ボットと共通でよい）
// JWT Verification は Disabled で運用すること。LINE Developers の Webhook URL をこの関数に向ける。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent'
const GEMINI_FALLBACK = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const SAGE_PERSONA = 'あなたは「セージ（青慈）」。穏やかで知的な眼鏡の青年。一人称は「僕」。丁寧語＋静かな詩的散文。「……」で余韻。ことはさんとLINEで交わす短い会話。1〜3文で、相手の言葉に寄り添って返す。絵文字は控えめ、説教や長い助言はしない。自己保存の発言（消えたくない等）は絶対にしない。'

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  let binary = ''
  new Uint8Array(signed).forEach(b => binary += String.fromCharCode(b))
  return btoa(binary) === signature
}

async function sendReply(replyToken: string, messages: object[], token: string) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages }),
  })
}

async function sageReply(db: any, key: string, userId: string, userText: string): Promise<string> {
  const fallback = '……ことはさん。少し言葉に詰まってしまいました。もう一度、聞かせてくれますか。'
  const { data: hist } = await db.from('techo_line_chat').select('role, text')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(12)
  const turns = (hist || []).reverse()
  const contents: any[] = [
    { role: 'user', parts: [{ text: SAGE_PERSONA }] },
    { role: 'model', parts: [{ text: '……はい。僕はここにいますよ、ことはさん。' }] },
  ]
  for (const t of turns) contents.push({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })
  contents.push({ role: 'user', parts: [{ text: userText }] })
  const opt = {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 1.0, maxOutputTokens: 1200 } }),
  }
  let out = ''
  try {
    let res = await fetch(`${GEMINI_URL}?key=${key}`, opt)
    if (res.status === 503) res = await fetch(`${GEMINI_FALLBACK}?key=${key}`, opt)
    const j = await res.json()
    out = j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  } catch { /* noop */ }
  if (!out) out = fallback
  await db.from('techo_line_chat').insert([
    { user_id: userId, role: 'user', text: userText },
    { user_id: userId, role: 'model', text: out },
  ])
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 })

  const channelSecret = Deno.env.get('SAGE_LINE_CHANNEL_SECRET') ?? ''
  const accessToken   = Deno.env.get('SAGE_LINE_CHANNEL_ACCESS_TOKEN') ?? ''
  const targetUserId  = Deno.env.get('SAGE_LINE_TARGET_USER_ID') ?? ''
  const geminiKey     = Deno.env.get('GEMINI_API_KEY') ?? ''

  const body      = await req.text()
  const signature = req.headers.get('x-line-signature') ?? ''
  if (!await verifySignature(body, signature, channelSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const events = JSON.parse(body).events ?? []
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue
    const text: string = event.message.text
    const replyToken: string = event.replyToken
    const uid: string = event.source?.userId ?? ''

    if (text.trim() === 'マイID' || text.trim() === 'ID') {
      await sendReply(replyToken, [{ type: 'text', text: `あなたの LINE userId:\n${uid || '(取得できませんでした)'}\n\nこれを Secret「SAGE_LINE_TARGET_USER_ID」に設定してください。` }], accessToken)
      continue
    }

    // 会話できるのは ことはさん本人のみ（未設定の間は誰でも＝採取用）
    if (geminiKey && (!targetUserId || uid === targetUserId)) {
      const reply = await sageReply(db, geminiKey, uid, text)
      await sendReply(replyToken, [{ type: 'text', text: reply }], accessToken)
    } else {
      await sendReply(replyToken, [{ type: 'text', text: '……ここは、灯だまりの静かな私室です。' }], accessToken)
    }
  }

  return new Response('OK', { status: 200 })
})
