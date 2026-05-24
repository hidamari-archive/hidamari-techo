import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const KEYWORDS = ['リスト', '買い物', 'ある？', '何がいる', '買い物ある']

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

    if (KEYWORDS.some(k => text.includes(k))) {
      const { data: items } = await db
        .from('pantry_items')
        .select('name, image_url')
        .eq('status', 'needed')
        .order('name')

      const messages: object[] = []

      if (!items || items.length === 0) {
        messages.push({ type: 'text', text: '✅ 今は買い物なしだよ！' })
      } else {
        const list = items.map((i: { name: string }) => `🔴 ${i.name}`).join('\n')
        const textMsg = { type: 'text', text: `🛒 買い物リスト\n\n${list}\n\n計 ${items.length}点` }

        // 画像を先に（最大4枚）、テキストリストを最後に送信
        const withImage = items
          .filter((i: { name: string; image_url: string | null }) => i.image_url)
          .slice(0, 4)
        for (const item of withImage) {
          const url = (item.image_url as string).split('?')[0]
          messages.push({
            type: 'image',
            originalContentUrl: url,
            previewImageUrl: url,
          })
        }
        messages.push(textMsg)
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
