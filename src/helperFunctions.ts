import { JSDOM } from 'jsdom';
import { UserData } from './types';

export function parseJsonCookies(json: any) {
  const output = {
    geo: "",
    hcmex: "",
    deviceId: "",
    domain: "",
    expires: 0
  }

  for (const item of json) {
    switch (item.name) {
      case "geo":
        output.geo = item.value
        break;
      case "_hcmex_key":
        output.hcmex = item.value
        output.domain = item.domain
        output.expires = parseFloat(item.expirationDate) * 1000
        break;
      case "device_id":
        output.deviceId = item.value
        break;
    }
  }
  return output
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
