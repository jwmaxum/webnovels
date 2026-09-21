// Official server lookup; no trust in redirect query flags, client DOB, or a Kakao login.
// The caller must persist/lock an unpredictable attempt ID bound to the authenticated user.
export async function verifyPortOneIdentity({ attempt, actorId, apiSecret, storeId, channelKey, mode, now = Date.now() }, fetchImpl = fetch) {
  if (!attempt || attempt.auth_user_id !== actorId || attempt.status !== 'PENDING' || !Number.isFinite(Date.parse(attempt.expires_at)) || Date.parse(attempt.expires_at) <= now) throw new Error('IDENTITY_ATTEMPT_INVALID');
  if (!apiSecret || !storeId || !channelKey || !['LIVE', 'TEST'].includes(mode)) throw new Error('IDENTITY_CONFIGURATION_REQUIRED');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(attempt.id || '')) throw new Error('IDENTITY_ATTEMPT_INVALID');
  const url = new URL('https://api.portone.io/identity-verifications/' + encodeURIComponent(attempt.id));
  url.searchParams.set('storeId', storeId);
  let response;
  try { response = await fetchImpl(url, { headers: { Authorization: 'PortOne ' + apiSecret }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('IDENTITY_PROVIDER_UNAVAILABLE'); }
  if (!response.ok) throw new Error('IDENTITY_NOT_VERIFIED');
  let data;
  try { data = await response.json(); } catch { throw new Error('IDENTITY_NOT_VERIFIED'); }
  if (data.status !== 'VERIFIED' || data.id !== attempt.id || data.channel?.key !== channelKey || data.channel?.type !== mode) throw new Error('IDENTITY_NOT_VERIFIED');
  const birthDate = data.verifiedCustomer?.birthDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '')) throw new Error('VERIFIED_BIRTH_DATE_REQUIRED');
  const birth = new Date(birthDate + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0,10) !== birthDate || birth.getTime() > now) throw new Error('VERIFIED_BIRTH_DATE_REQUIRED');
  const verifiedAt = Date.parse(data.verifiedAt);
  const createdAt = Date.parse(attempt.created_at);
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(createdAt) || verifiedAt < createdAt || verifiedAt > now + 60000) throw new Error('IDENTITY_TIMESTAMP_INVALID');
  // Result stays on server. No name/phone/CI/DI is forwarded to a browser.
  // Adult content policy is decided separately; this adapter only verifies DOB provenance.
  return { verificationId: attempt.id, authUserId: actorId, verifiedBirthDate: birthDate, verifiedAt: data.verifiedAt };
}
