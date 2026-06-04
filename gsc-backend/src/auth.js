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
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars required');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri());
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
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
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
