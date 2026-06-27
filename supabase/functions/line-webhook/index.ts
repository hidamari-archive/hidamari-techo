import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const KEYWORDS = ['リスト', '買い物', 'ある？', '何がいる', '買い物ある']
const IMG_KEYWORDS = ['画像']
// 「買った／購入／ゲット」等で欠品→在庫ありに戻す
const BOUGHT_RE = /買っ|買え|購入|ゲット/
const ALL_RE = /全部|ぜんぶ|すべて|全て/
// 品名照合用：（）内・数量/単位を落として核を取り出す
function normName(s: string): string {
  return s.replace(/（.*?）|\(.*?\)/g, '').replace(/[0-9０-９]+(個|本|袋|パック|枚|ml|ｍｌ|L|ℓ|g|ｇ|kg)?/g, '').trim()
}

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  let binary = ''
  new Uint8Array(signed).forEach(b => binary += String.fromCharCode(b))
  return btoa(binary) === signature
}

async function sendReply(replyToken: string, messages: object[], token: string) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 })
  }

  const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET') ?? ''
  const accessToken   = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''

  const body      = await req.text()
  const signature = req.headers.get('x-line-signature') ?? ''

  if (!await verifySignature(body, signature, channelSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const events = JSON.parse(body).events ?? []

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue

    const text: string       = event.message.text
    const replyToken: string = event.replyToken

    if (text.trim() === 'マイID' || text.trim() === 'ID') {
      const uid = event.source?.userId ?? '(取得できませんでした)'
      await sendReply(replyToken, [{ type: 'text', text: `あなたの LINE userId:\n${uid}\n\nこれを Supabase の Secret「LINE_TARGET_USER_ID」に設定すると、セージのリマインダーが届きます。` }], accessToken)
      continue
    }

    if (BOUGHT_RE.test(text)) {
      const { data: needed } = await db
        .from('pantry_items')
        .select('id, name')
        .eq('status', 'needed')
        .order('name')

      if (!needed || needed.length === 0) {
        await sendReply(replyToken, [{ type: 'text', text: 'いま欠品はないみたいだよ。ありがとう！🛒' }], accessToken)
        continue
      }

      const all = ALL_RE.test(text)
      const matched = all
        ? needed
        : needed.filter((it: any) => {
            const core = normName(it.name)
            return text.includes(it.name) || (core.length > 0 && text.includes(core))
          })

      if (matched.length === 0) {
        await sendReply(replyToken, [{ type: 'text', text: 'どれを買ったか分からなかった…🙏\n「牛乳 買った」みたいに品名を入れて送ってね。\nぜんぶなら「全部買った」でOK！' }], accessToken)
        continue
      }

      const ids = matched.map((m: any) => m.id)
      const { error } = await db
        .from('pantry_items')
        .update({ status: 'in_stock', updated_by: 'line' })
        .in('id', ids)

      if (error) {
        await sendReply(replyToken, [{ type: 'text', text: '⚠️ うまく更新できなかったみたい…もう一度試してみてね' }], accessToken)
        continue
      }

      const names = matched.map((m: any) => m.name).join('・')
      await sendReply(replyToken, [{ type: 'text', text: `✅ ${names} を在庫ありにしたよ！\nお買い物ありがとう 🛒` }], accessToken)
    } else if (KEYWORDS.some(k => text.includes(k))) {
      const { data: items } = await db
        .from('pantry_items')
        .select('name, image_url, priority')
        .eq('status', 'needed')
        .order('name')

      const messages: object[] = []

      if (!items || items.length === 0) {
        messages.push({ type: 'text', text: '✅ 今は買い物なしだよ！' })
      } else {
        const priOrder: Record<string, number> = { urgent: 0, normal: 1, low: 2 }
        const sorted = [...items].sort((a: any, b: any) => (priOrder[a.priority || 'normal'] ?? 1) - (priOrder[b.priority || 'normal'] ?? 1))
        const now = new Date()
        const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
        const ts = `${jst.getFullYear()}/${String(jst.getMonth()+1).padStart(2,'0')}/${String(jst.getDate()).padStart(2,'0')} ${String(jst.getHours()).padStart(2,'0')}:${String(jst.getMinutes()).padStart(2,'0')} 時点`
        const list = sorted.map((i: any) => {
          const p = i.priority || 'normal'
          const mark = p === 'urgent' ? '🔥' : p === 'low' ? '💤' : '・'
          return `${mark} ${i.name}`
        }).join('\n')
        const hasImg = sorted.some((i: any) => i.image_url)
        const imgHint = hasImg ? '\n\n📷 商品画像を見るには「〇〇の画像」と送ってね' : ''
        const textMsg = { type: 'text', text: `🛒 買い物リスト\n\n${list}\n\n計 ${items.length}点\n📅 ${ts}${imgHint}` }

        messages.push(textMsg)
      }

      await sendReply(replyToken, messages, accessToken)
    } else if (text.includes('画像')) {
      const keyword = text.replace(/の?画像/g, '').trim()
      let query = db.from('pantry_items').select('name, image_url').eq('status', 'needed').not('image_url', 'is', null)
      if (keyword) query = query.ilike('name', `%${keyword}%`)
      const { data: items } = await query.order('name')

      const messages: object[] = []
      if (!items || items.length === 0) {
        messages.push({ type: 'text', text: keyword ? `📷「${keyword}」に一致する画像はないよ` : '📷 画像が登録されている欠品はないよ' })
      } else {
        const imgs = items.slice(0, 4)
        for (const item of imgs) {
          const url = (item.image_url as string).split('?')[0]
          messages.push({ type: 'image', originalContentUrl: url, previewImageUrl: url })
        }
        if (items.length > 4) {
          messages.push({ type: 'text', text: `他 ${items.length - 4}件の画像あり` })
        }
      }
      await sendReply(replyToken, messages, accessToken)
    } else {
      await sendReply(replyToken, [
        { type: 'text', text: '買い物リストを見るには「リスト」と送ってね 🛒' }
      ], accessToken)
    }
  }

  return new Response('OK', { status: 200 })
})
