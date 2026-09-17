import { createHash } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const providers = {
  google: { issuer: ['https://accounts.google.com', 'accounts.google.com'], authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', keys: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { issuer: 'https://appleid.apple.com', authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', keys: 'https://appleid.apple.com/auth/keys' },
};

export async function verifyIdentityToken(provider, token, { clientId, nonce, keys }) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: providers[provider].issuer, audience: clientId, algorithms: ['RS256'],
    requiredClaims: ['sub', 'iat', 'exp', 'nonce'], maxTokenAge: '10m', clockTolerance: 5,
  });
  if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new Error('Invalid identity');
  if ((payload.azp && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error('Invalid authorized party');
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  const email = verified && typeof payload.email === 'string' && payload.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ? payload.email.toLowerCase() : null;
  const name = typeof payload.name === 'string' ? payload.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) : '';
  return { subject: payload.sub, email, name: name || (provider === 'apple' ? 'Conta Apple' : 'Conta Google') };
}

// Secrets stay on the API. The Android app receives only an authorization URL.
export function createOAuthProviders(env = process.env) {
  const settings = {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    apple: { clientId: env.APPLE_CLIENT_ID, teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY },
  };
  const result = {};
  for (const [provider, config] of Object.entries(settings)) {
    if (!Object.values(config).every(value => typeof value === 'string' && value.trim())) continue;
    const endpoints = providers[provider];
    const keys = createRemoteJWKSet(new URL(endpoints.keys), { timeoutDuration: 5000 });
    result[provider] = {
      authorizationUrl({ state, nonce, redirectUri, verifier }) {
        const url = new URL(endpoints.authorize);
        const params = { client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: provider === 'google' ? 'openid email profile' : 'email', state, nonce };
        if (provider === 'google') Object.assign(params, { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
        else params.response_mode = 'form_post';
        url.search = new URLSearchParams(params).toString();
        return url.href;
      },
      async exchange({ code, nonce, redirectUri, verifier }) {
        let clientSecret = config.clientSecret;
        if (provider === 'apple') {
          const key = await importPKCS8(config.privateKey.replaceAll('\\n', '\n'), 'ES256');
          clientSecret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: config.keyId }).setIssuer(config.teamId).setAudience('https://appleid.apple.com').setSubject(config.clientId).setIssuedAt().setExpirationTime('5m').sign(key);
        }
        const body = new URLSearchParams({ client_id: config.clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
        if (provider === 'google') body.set('code_verifier', verifier);
        const response = await fetch(endpoints.token, { method: 'POST', body, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Provider rejected authorization');
        const tokens = await response.json();
        return verifyIdentityToken(provider, tokens.id_token, { clientId: config.clientId, nonce, keys });
      },
    };
  }
  return result;
}
