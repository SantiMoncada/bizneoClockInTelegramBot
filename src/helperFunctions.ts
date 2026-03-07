import { JSDOM } from 'jsdom';
import { UserData } from './types';

export function parseJsonCookies(json: any) {
  const cookieEntries = normalizeCookieEntries(json);

  const output = {
    geo: "",
    hcmex: "",
    deviceId: "",
    domain: "",
    expires: 0
  }

  for (const item of cookieEntries) {
    const normalized = normalizeCookieItem(item);
    if (!normalized) continue;

    switch (normalized.name) {
      case "geo":
        output.geo = normalized.value
        break;
      case "_hcmex_key":
        output.hcmex = normalized.value
        output.domain = normalized.domain || output.domain
        output.expires = normalizeExpiration(normalized.expires)
        break;
      case "device_id":
        output.deviceId = normalized.value
        break;
    }
  }

  return output
}

function normalizeCookieEntries(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.cookies)) return json.cookies;
  if (json && json.data && Array.isArray(json.data.cookies)) return json.data.cookies;
  if (json && json.cookieHeader && typeof json.cookieHeader === 'string') return parseCookieHeader(json.cookieHeader);
  if (json && json.cookie && typeof json.cookie === 'string') return parseCookieHeader(json.cookie);
  if (json && json.headers && typeof json.headers.cookie === 'string') return parseCookieHeader(json.headers.cookie);
  if (json && typeof json.Cookie === 'string') return parseCookieHeader(json.Cookie);
  if (json && isPlainObject(json)) {
    const hasLikelyCookieKeys = ['geo', '_hcmex_key', 'device_id'].some((k) => k in json);
    if (hasLikelyCookieKeys) {
      return Object.entries(json).map(([name, value]) => ({
        name,
        value,
        domain: json.domain ?? json.host ?? '',
        expires: json.expirationDate ?? json.expires ?? json.expiry ?? 0
      }));
    }
  }
  return [];
}

function normalizeCookieItem(item: any): { name: string; value: string; domain: string; expires: unknown } | null {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name ?? item.key ?? item.cookieName ?? item.cookie ?? '');
  const value = item.value ?? item.content ?? item.val ?? item.cookieValue;
  if (!name || value === undefined || value === null) return null;

  return {
    name,
    value: String(value),
    domain: String(item.domain ?? item.host ?? item.hostname ?? ''),
    expires: item.expirationDate ?? item.expires ?? item.expiry ?? item.expiresAt ?? 0
  };
}

function parseCookieHeader(cookieHeader: string): Array<{ name: string; value: string; domain: string; expires: number }> {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      const name = idx >= 0 ? part.slice(0, idx).trim() : part.trim();
      const value = idx >= 0 ? part.slice(idx + 1).trim() : '';
      return { name, value, domain: '', expires: 0 };
    })
    .filter((item) => item.name.length > 0);
}

function normalizeExpiration(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Some exports use seconds, others milliseconds.
  return value > 1e12 ? value : value * 1000;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}



export async function getCsrfTokes(data: UserData) {
  const MINIMAL_REQUEST = {
    // Only these 3 cookies are actually needed
    headers: {
      'Cookie': [
        '_hcmex_key=' + data.cookies.hcmex,
        'device_id=' + data.cookies.deviceId,
        'geo=' + data.cookies.geo
      ].join('; ')
    }
  };

  const response = await fetch(`https://${data.cookies.domain}/`, MINIMAL_REQUEST);
  const text = await response.text();
  const dom = new JSDOM(text)
  const document = dom.window.document
  const metaCsrf = document.querySelector('meta[name="csrf"]')?.getAttribute('content') || null;

  const chronoResponse = await fetch(`https://${data.cookies.domain}/chrono/${data.userId}/hub_chrono`, MINIMAL_REQUEST);
  const chronoText = await chronoResponse.text();
  const chronoDom = new JSDOM(chronoText)
  const chronoDocument = chronoDom.window.document;
  const inputCsrf = chronoDocument.querySelector('input[name="_csrf_token"]')?.getAttribute("value") || null;

  return { metaCsrf, inputCsrf }
}
