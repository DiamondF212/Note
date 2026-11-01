/* Cifratura con WebCrypto: PBKDF2 (SHA-256) + AES-GCM 256. Tutto avviene sul dispositivo. */
(function (N) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64(buf) {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const ITER = 250000;

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter || ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJSON(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }

  async function decryptJSON(key, p) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.ct));
    return JSON.parse(dec.decode(pt));
  }

  /* Crea i metadati di un "caveau": sale casuale + verificatore cifrato per controllare la password. */
  async function createVault(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, ITER);
    const verifier = await encryptJSON(key, { ok: 'vault' });
    return { meta: { salt: b64(salt), iter: ITER, verifier }, key };
  }

  /* Restituisce la chiave se la password è corretta, altrimenti null. */
  async function openVault(meta, password) {
    try {
      const key = await deriveKey(password, unb64(meta.salt), meta.iter);
      const v = await decryptJSON(key, meta.verifier);
      return v && v.ok === 'vault' ? key : null;
    } catch (e) {
      return null;
    }
  }

  /* Cifra/decifra un intero oggetto con una password (usato per i backup). */
  async function sealWithPassword(password, obj) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, ITER);
    const p = await encryptJSON(key, obj);
    return { salt: b64(salt), iter: ITER, iv: p.iv, ct: p.ct };
  }
  async function unsealWithPassword(password, sealed) {
    const key = await deriveKey(password, unb64(sealed.salt), sealed.iter);
    return decryptJSON(key, sealed);
  }

  N.crypto = { deriveKey, encryptJSON, decryptJSON, createVault, openVault, sealWithPassword, unsealWithPassword, b64, unb64 };
})((window.N = window.N || {}));
