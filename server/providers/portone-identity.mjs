// Official server lookup; no trust in redirect query flags, client DOB, or a Kakao login.
// The caller must persist/lock an unpredictable attempt ID bound to the authenticated user.
async function lookupIdentity({ attempt, actorId, apiSecret, storeId, channelKey, mode, now = Date.now() }, fetchImpl) {
  if (!attempt || attempt.auth_user_id !== actorId || attempt.status !== 'PENDING' || !Number.isFinite(Date.parse(attempt.expires_at)) || Date.parse(attempt.expires_at) <= now) throw new Error('IDENTITY_ATTEMPT_INVALID');
  if (!apiSecret || !storeId || !channelKey || !['LIVE', 'TEST'].includes(mode)) throw new Error('IDENTITY_CONFIGURATION_REQUIRED');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(attempt.id || '')) throw new Error('IDENTITY_ATTEMPT_INVALID');
  const url = new URL('https://api.portone.io/identity-verifications/' + encodeURIComponent(attempt.id));
  url.searchParams.set('storeId', storeId);
  let response;
  try { response = await fetchImpl(url, { redirect: 'manual', headers: { Authorization: 'PortOne ' + apiSecret }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('IDENTITY_PROVIDER_UNAVAILABLE'); }
  if (!response.ok) throw new Error('IDENTITY_NOT_VERIFIED');
  let data;
  try { data = await response.json(); } catch { throw new Error('IDENTITY_NOT_VERIFIED'); }
  if (data.status !== 'VERIFIED' || data.id !== attempt.id || data.channel?.key !== channelKey || data.channel?.type !== mode) throw new Error('IDENTITY_NOT_VERIFIED');
  const verifiedAt = Date.parse(data.verifiedAt);
  const createdAt = Date.parse(attempt.created_at);
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(createdAt) || verifiedAt < createdAt || verifiedAt > now + 60000 || verifiedAt > Date.parse(attempt.expires_at)) throw new Error('IDENTITY_TIMESTAMP_INVALID');
  return data;
}
export async function verifyPortOneIdentity(options, fetchImpl = fetch) {
  const {attempt, actorId, now = Date.now()} = options;
  const data = await lookupIdentity(options, fetchImpl);
  const birthDate = data.verifiedCustomer?.birthDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '')) throw new Error('VERIFIED_BIRTH_DATE_REQUIRED');
  const birth = new Date(birthDate + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0,10) !== birthDate || birth.getTime() > now) throw new Error('VERIFIED_BIRTH_DATE_REQUIRED');
  // Result stays on server. No name/phone/CI/DI is forwarded to a browser.
  // Adult content policy is decided separately; this adapter only verifies DOB provenance.
  return { verificationId: attempt.id, authUserId: actorId, verifiedBirthDate: birthDate, verifiedAt: data.verifiedAt };
}

// Signup proof is deliberately independent of adult eligibility. Never return raw PII.
export async function verifyPortOneAuthor(options, fetchImpl = fetch) {
  const {attempt, storeId, channelKey, mode, pgProvider, identifierType, hmacKey, keyVersion} = options;
  if (attempt?.purpose !== 'AUTHOR_ENROLLMENT' || attempt.store_id !== storeId ||
      attempt.channel_key !== channelKey || attempt.mode !== mode || attempt.pg_provider !== pgProvider ||
      attempt.identifier_type !== identifierType || attempt.key_version !== keyVersion ||
      !['CI','DI'].includes(identifierType) || !/^[a-f0-9]{64}$/i.test(hmacKey || '') ||
      !/^[a-z0-9_-]{1,32}$/i.test(keyVersion || '')) throw new Error('IDENTITY_CONFIGURATION_REQUIRED');
  const data = await lookupIdentity(options, fetchImpl);
  const customer = data.verifiedCustomer;
  const identifier = customer?.[identifierType.toLowerCase()];
  if (data.channel.pgProvider !== pgProvider || typeof customer?.name !== 'string' ||
      !customer.name.trim() || customer.name.length > 200 || /[\x00-\x1f\x7f]/.test(customer.name) ||
      typeof identifier !== 'string' || identifier.length < 8 || identifier.length > 512 ||
      /[\s\x00-\x1f\x7f]/.test(identifier)) throw new Error('AUTHOR_IDENTITY_ATTRIBUTES_REQUIRED');
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(hmacKey.match(/../g), h => parseInt(h,16)),
    {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(
    ['author-person-v1', pgProvider, storeId, identifierType, mode, keyVersion, identifier])));
  return {fingerprint:Array.from(new Uint8Array(bytes), n=>n.toString(16).padStart(2,'0')).join(''),
    verifiedAt:data.verifiedAt};
}
