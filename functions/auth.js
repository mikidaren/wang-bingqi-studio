// Cloudflare Pages Function — Decap CMS GitHub OAuth 入口
// 处理用户点击 "Login with GitHub" 后的跳转

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (provider !== 'github') {
    return new Response('Invalid provider', { status: 400 });
  }

  const clientId = env.GITHUB_CLIENT_ID;
  const siteUrl = `${url.protocol}//${url.host}`;

  if (!clientId) {
    return new Response(
      'GITHUB_CLIENT_ID 未配置。请在 Cloudflare Dashboard → 你的 Pages 项目 → Settings → Environment Variables 中添加。',
      { status: 500 }
    );
  }

  // 重定向到 GitHub OAuth 授权页面
  const redirectUri = `${siteUrl}/auth/callback`;
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', 'repo,user');

  return Response.redirect(githubAuthUrl.toString(), 302);
}
