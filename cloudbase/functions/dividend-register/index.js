'use strict';

const crypto = require('node:crypto');
const CloudBase = require('@cloudbase/manager-node');

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function inviteMatches(candidate) {
  const expectedHex = String(process.env.DIVIDEND_INVITE_SHA256 || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = sha256(candidate);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validPassword(password) {
  if (password.length < 8 || password.length > 32 || !/^[A-Za-z0-9]/.test(password)) return false;
  const kinds = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[()!@#$%^&*|?><_-]/.test(password),
  ].filter(Boolean).length;
  return kinds >= 3;
}

function isDuplicate(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`;
  return /duplicate|already|exist|重复|已存在/i.test(text);
}

function isLimitExceeded(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`;
  return /LimitExceeded|limit exceeded|quota|达到.*限制|达到.*上限/i.test(text);
}

function requestPayload(event) {
  if (event && typeof event.body === 'string') {
    try {
      const parsed = JSON.parse(event.body);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (event && event.body && typeof event.body === 'object') return event.body;
  return event && typeof event === 'object' ? event : {};
}

function isHttpRequest(event) {
  return Boolean(event && (
    event.httpMethod ||
    event.requestContext ||
    event.headers ||
    Object.prototype.hasOwnProperty.call(event, 'body')
  ));
}

function reply(event, payload, statusCode = 200) {
  if (!isHttpRequest(event)) return payload;
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

exports.main = async (event = {}) => {
  const input = requestPayload(event);
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const inviteCode = typeof input.inviteCode === 'string' ? input.inviteCode.trim() : '';

  if (!USERNAME_PATTERN.test(username)) {
    return reply(event, { ok: false, code: 'INVALID_USERNAME' }, 400);
  }
  if (!validPassword(password)) {
    return reply(event, { ok: false, code: 'INVALID_PASSWORD' }, 400);
  }
  if (!inviteMatches(inviteCode)) {
    return reply(event, { ok: false, code: 'INVALID_INVITE' }, 403);
  }

  try {
    const manager = CloudBase.init({
      envId: process.env.DIVIDEND_ENV_ID,
      region: process.env.TENCENTCLOUD_REGION || 'ap-shanghai',
    });
    await manager.user.createUser({
      name: username,
      password,
      type: 'internalUser',
      userStatus: 'ACTIVE',
      nickName: username,
      description: 'Dividend Tracker 邀请注册用户',
    });
    return reply(event, { ok: true }, 201);
  } catch (error) {
    console.error('create user failed', error && error.code ? error.code : 'UNKNOWN');
    const duplicate = isDuplicate(error);
    const limitExceeded = isLimitExceeded(error);
    return reply(
      event,
      { ok: false, code: duplicate ? 'ACCOUNT_EXISTS' : limitExceeded ? 'LIMIT_EXCEEDED' : 'CREATE_FAILED' },
      duplicate ? 409 : limitExceeded ? 429 : 500,
    );
  }
};
