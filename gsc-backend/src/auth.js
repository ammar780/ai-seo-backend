// src/auth.js
// OAuth 2.0 flow + token resolution.

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];
let cachedTokens = null;

export function getRedirectUri() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error('APP_URL env var required (set to your backend Railway URL)');
  // Strip trailing slashes and whitespace defensively
  return appUrl.trim().replace(/\/+$/, '') + '/api/auth/callback';
}

export function getOAuthClient() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars required');
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export function isAuthorized() {
  if (process.env.MOCK_GSC === 'true') return true;
  return Boolean(process.env.GOOGLE_REFRESH_TOKEN || cachedTokens);
}

export function buildAuthUrl() {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function handleCallback(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  cachedTokens = tokens;
  return tokens;
}

export function getAuthorizedClient() {
  const client = getOAuthClient();
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }
  if (cachedTokens) {
    client.setCredentials(cachedTokens);
    client.on('tokens', (newTokens) => {
      cachedTokens = { ...cachedTokens, ...newTokens };
    });
    return client;
  }
  throw new Error('Not authorized');
}
