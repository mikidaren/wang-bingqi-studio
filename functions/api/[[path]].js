// The original workbench now uses fixed generation routes under /category/project/design/.
export function onRequest() {
  return Response.json({ error: '请刷新项目页面后继续设计。' }, {
    status: 410,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}