import { handleRequest } from './router.ts'

Deno.serve(async (request: Request): Promise<Response> => {
  try {
    return await handleRequest(request)
  } catch {
    return new Response(JSON.stringify({ detail: '服务器内部错误，请稍后重试' }), {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
})
