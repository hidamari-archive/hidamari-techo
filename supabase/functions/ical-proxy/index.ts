// 灯だまり手帖 — iCal 中継（corsproxy.io の代わりに自前で取得する）
// ことはさんのカレンダーの中身を第三者サーバに通さないための小さなプロキシ。
// 安全のため Google カレンダーのホストのみ許可（オープンプロキシ化を防ぐ）。

const ALLOW_HOSTS = ['calendar.google.com', 'www.google.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const target = new URL(req.url).searchParams.get('url') ?? ''
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return new Response('bad url', { status: 400, headers: CORS })
  }

  if (parsed.protocol !== 'https:' || !ALLOW_HOSTS.includes(parsed.hostname)) {
    return new Response('forbidden host', { status: 403, headers: CORS })
  }

  try {
    const r = await fetch(parsed.toString(), { headers: { 'User-Agent': 'hidamari-techo' } })
    const text = await r.text()
    return new Response(text, {
      status: r.ok ? 200 : 502,
      headers: { ...CORS, 'Content-Type': 'text/calendar; charset=utf-8' },
    })
  } catch {
    return new Response('fetch failed', { status: 502, headers: CORS })
  }
})
