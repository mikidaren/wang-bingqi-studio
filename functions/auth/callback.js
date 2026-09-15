// Cloudflare Pages Function — Decap CMS GitHub OAuth 回调
// 处理 GitHub 授权后的回调，交换 code 换取 access token
//
// ⚠️ 凭据必须走环境变量，禁止硬编码。
//    2026-09-15：本文件原有明文 client secret，随 public 仓库推送而泄露，已外置。
//    配置位置：Cloudflare Dashboard → Workers & Pages → wang-bingqi-studio
//             → Settings → Variables and Secrets
//      · GITHUB_CLIENT_ID      普通变量
//      · GITHUB_CLIENT_SECRET  **Secret 类型**
//    先配置好再部署，否则登录会返回 500。

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(
      'GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 未配置。请在 Cloudflare Dashboard → ' +
      'Workers & Pages → wang-bingqi-studio → Settings → Variables and Secrets 中添加' +
      '（GITHUB_CLIENT_SECRET 请用 Secret 类型）。',
      { status: 500 }
    );
  }

  const siteUrl = `${url.protocol}//${url.host}`;

  try {
    // 交换 access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${siteUrl}/auth/callback`,
      }),
    });

    const data = await tokenResponse.json();

    if (data.error) {
      return new Response(`OAuth Error: ${data.error_description || data.error}`, { status: 400 });
    }

    const accessToken = data.access_token;

    // 返回 HTML 页面，通过 postMessage 将 token 传回 Decap CMS
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>GitHub Auth — Redirecting</title>
</head>
<body>
  <p>正在登录…</p>
  <script>
    (function() {
      function receiveMessage(event) {
        if (event.data === 'authorizing:github') {
          window.opener.postMessage(
            'authorization:github:${accessToken}:${siteUrl}',
            event.origin
          );
          window.close();
        }
      }
      window.addEventListener('message', receiveMessage, false);
      window.opener.postMessage('authorizing:github', '*');
    })();
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  } catch (err) {
    return new Response(`OAuth Error: ${err.message}`, { status: 500 });
  }
}
