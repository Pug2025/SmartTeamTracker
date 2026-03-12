// api/_auth.js
// Shared Firebase ID token verification for API endpoints.
// Verifies tokens using Google's public JWKS keys (no Firebase Admin SDK needed).

const FIREBASE_PROJECT_ID = 'smart-team-tracker';
const JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const TOKEN_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

// Cache public keys for 1 hour (per Vercel function lifetime, this resets on cold start anyway)
let _cachedKeys = null;
let _cachedAt = 0;
const KEY_CACHE_MS = 60 * 60 * 1000;

async function fetchPublicKeys() {
  const now = Date.now();
  if (_cachedKeys && (now - _cachedAt) < KEY_CACHE_MS) return _cachedKeys;

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Failed to fetch Firebase public keys');
  _cachedKeys = await res.json();
  _cachedAt = now;
  return _cachedKeys;
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  return { header, payload };
}

async function importPublicKey(pemCert) {
  // Extract base64 from PEM
  const b64 = pemCert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const binary = atob(b64);
  const bytes = new Uint8Array([...binary].map(c => c.charCodeAt(0)));

  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function importX509Key(pemCert) {
  // For X.509 certs we need to extract the public key via SubjectPublicKeyInfo.
  // Node 18+ and Vercel Edge support crypto.subtle with X.509 via SPKI.
  // We'll parse the cert to get the SPKI portion.

  const b64 = pemCert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  // Use Node.js crypto to extract public key from X.509 cert
  const { X509Certificate } = await import('node:crypto');
  const cert = new X509Certificate(pemCert);
  const publicKeyPem = cert.publicKey.export({ type: 'spki', format: 'pem' });

  const spkiB64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');

  const spkiBytes = new Uint8Array([...atob(spkiB64)].map(c => c.charCodeAt(0)));

  return crypto.subtle.importKey(
    'spki',
    spkiBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/**
 * Verify a Firebase ID token and return the decoded payload (with uid).
 * Throws on invalid/expired tokens.
 */
export async function verifyFirebaseToken(idToken) {
  const { header, payload } = decodeJwtPayload(idToken);

  // Validate claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error('Token expired');
  if (payload.iat > now + 60) throw new Error('Token issued in the future');
  if (payload.iss !== TOKEN_ISSUER) throw new Error('Invalid issuer');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('Invalid audience');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Missing subject');

  // Verify signature
  const keys = await fetchPublicKeys();
  const kid = header.kid;
  if (!kid || !keys[kid]) throw new Error('Unknown key ID');

  const key = await importX509Key(keys[kid]);

  const parts = idToken.split('.');
  const signedData = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const signature = base64UrlDecode(parts[2]);

  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) throw new Error('Invalid signature');

  return payload;
}

/**
 * Extract and verify the uid from an Authorization header.
 * Returns { uid } on success, or sends a 401 response and returns null.
 *
 * For guest users (no auth header), returns { uid: null } — callers decide
 * whether to allow or reject guest requests.
 */
export async function authenticateRequest(req, res) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token — guest mode
    return { uid: null };
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyFirebaseToken(token);
    return { uid: payload.sub };
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized', message: err.message });
    return null;
  }
}
