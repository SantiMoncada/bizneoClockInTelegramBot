/**
 * Browser-compatible Phoenix token parser
 * Works with both Node.js and browsers
 */

interface PhoenixToken {
  _csrf_token?: string;
  locale?: string;
  session_id?: any;
  user_id?: any;
  [key: string]: any;
}

class ETFDecoder {
  private data: Uint8Array;
  private offset: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  decode(): any {
    const tag = this.readByte();

    switch (tag) {
      case 131: // ETF version marker
        return this.decode();
      case 116: // Small tuple (map)
        return this.decodeMap();
      case 109: // Binary/String
        return this.decodeBinary();
      case 98: // Integer
        return this.decodeInteger();
      case 97: // Small integer
        return this.readByte();
      default:
        return null;
    }
  }

  private readByte(): number {
    return this.data[this.offset++];
  }

  private readUInt32BE(): number {
    const value = (this.data[this.offset] << 24) |
      (this.data[this.offset + 1] << 16) |
      (this.data[this.offset + 2] << 8) |
      this.data[this.offset + 3];
    this.offset += 4;
    return value >>> 0; // Convert to unsigned
  }

  private decodeMap(): PhoenixToken {
    const arity = this.readUInt32BE();
    const map: PhoenixToken = {};

    for (let i = 0; i < arity; i++) {
      const key = this.decode();
      const value = this.decode();

      if (typeof key === 'string') {
        map[key] = value;
      }
    }

    return map;
  }

  private decodeBinary(): string {
    const length = this.readUInt32BE();
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;

    // Decode UTF-8
    return new TextDecoder().decode(bytes);
  }

  private decodeInteger(): number {
    const value = (this.data[this.offset] << 24) |
      (this.data[this.offset + 1] << 16) |
      (this.data[this.offset + 2] << 8) |
      this.data[this.offset + 3];
    this.offset += 4;
    return value;
  }
}

/**
 * Base64 decode (browser-compatible)
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // For Node.js
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Parse Phoenix Framework signed token
 */
export function parsePhoenixToken(token: string): PhoenixToken | null {
  try {
    const parts = token.split('.');

    if (parts.length !== 3 || parts[0] !== 'SFMyNTY') {
      throw new Error('Invalid Phoenix token format');
    }

    const data = base64ToUint8Array(parts[1]);
    const decoder = new ETFDecoder(data);

    return decoder.decode();
  } catch (error) {
    console.error('Failed to parse Phoenix token:', error);
    return null;
  }
}

/**
 * Extract CSRF token from Phoenix session cookie
 */
export function extractCSRFToken(cookieValue: string): string | null {
  const data = parsePhoenixToken(cookieValue);
  return data?._csrf_token || null;
}

// Example usage:
// const csrf = extractCSRFToken(document.cookie.split('_hcmex_key=')[1].split(';')[0]);
// console.log('CSRF:', csrf);
