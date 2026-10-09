// Shared by the private offline page and the authoritative file finalizer.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContentReviewSession = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const fail = code => { throw Error('WORKBENCH_' + code); };
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...expected].sort().join('|');
  const decisionKeys = ['episodeId','sourceDigest','decision','reviewerRef','evidenceRef','rightsEvidence','imageEvidence','selectedSourceSha256'];
  function evidence(value) {
    if (!keys(value, ['file','bytes','sha256']) || typeof value.file !== 'string' || !value.file || value.file.length > 1024 ||
      /[\\\x00-\x1f\x7f:]/.test(value.file) || value.file.startsWith('/') ||
      value.file.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)) ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 16 * 1024 * 1024 || !digest(value.sha256)) fail('INVALID_EVIDENCE');
    return {file:value.file, bytes:value.bytes, sha256:value.sha256};
  }
  function pending(row) {
    return {episodeId:row.episodeId,sourceDigest:row.sourceDigest,decision:'PENDING',reviewerRef:null,evidenceRef:null,
      rightsEvidence:null,imageEvidence:null,selectedSourceSha256:null};
  }
  function validateDecision(row, input) {
    if (!keys(input, decisionKeys) || input.episodeId !== row.episodeId || input.sourceDigest !== row.sourceDigest ||
      !['PENDING','HOLD','USE_EPISODES','USE_EPISODE_CONTENTS'].includes(input.decision) ||
      !(input.reviewerRef === null || typeof input.reviewerRef === 'string' && input.reviewerRef.length <= 200) ||
      !(input.evidenceRef === null || typeof input.evidenceRef === 'string' && input.evidenceRef.length <= 500) ||
      !(input.selectedSourceSha256 === null || digest(input.selectedSourceSha256))) fail('INVALID_DECISION');
    const result = {...input};
    for (const key of ['rightsEvidence','imageEvidence']) if (result[key] !== null) result[key] = evidence(result[key]);
    if (result.decision === 'PENDING') {
      if (result.reviewerRef !== null || result.evidenceRef !== null || result.rightsEvidence !== null ||
        result.imageEvidence !== null || result.selectedSourceSha256 !== null) fail('PENDING_MUST_BE_EMPTY');
      return result;
    }
    if (!result.reviewerRef || result.reviewerRef.trim().length < 3 || !result.evidenceRef || result.evidenceRef.trim().length < 10) fail('REVIEWER_EVIDENCE_REQUIRED');
    if (result.decision === 'HOLD') {
      if (result.rightsEvidence !== null || result.imageEvidence !== null || result.selectedSourceSha256 !== null) fail('HOLD_MUST_NOT_SELECT_SOURCE');
      return result;
    }
    const option = row.options.find(option => option.decision === result.decision);
    if (!option || option.blockedReasons.length) fail('SOURCE_BLOCKED');
    if (result.selectedSourceSha256 !== option.sha256) fail('SELECTED_SOURCE_MISMATCH');
    if (!result.rightsEvidence || row.contentType === 'WEBTOON' && !result.imageEvidence) fail('RIGHTS_IMAGE_EVIDENCE_REQUIRED');
    return result;
  }
  function session(model, decisions) {
    return {format:'webnovels-content-review-session-v1',snapshotSha256:model.snapshotSha256,
      packetSha256:model.packetSha256,workbenchSha256:model.workbenchSha256,decisions};
  }
  function validateSession(model, input) {
    if (!keys(input, ['format','snapshotSha256','packetSha256','workbenchSha256','decisions']) ||
      input.format !== 'webnovels-content-review-session-v1' || !Array.isArray(input.decisions) || input.decisions.length > model.entries.length) fail('INVALID_SESSION');
    if (input.snapshotSha256 !== model.snapshotSha256 || input.packetSha256 !== model.packetSha256 || input.workbenchSha256 !== model.workbenchSha256) fail('STALE_SESSION');
    const rows = new Map(model.entries.map(row => [row.episodeId,row])), seen = new Set();
    const decisions = input.decisions.map(input => {
      if (!input || !rows.has(input.episodeId) || seen.has(input.episodeId)) fail('UNKNOWN_DUPLICATE_EPISODE');
      seen.add(input.episodeId);
      return validateDecision(rows.get(input.episodeId), input);
    });
    return session(model, decisions);
  }
  return {evidence,pending,validateDecision,session,validateSession};
});
