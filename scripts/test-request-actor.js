import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestRole } from '../request-actor.js';

test('loopback requests are administrators by default', () => {
  assert.equal(resolveRequestRole({ remoteAddress: '127.0.0.1' }), 'admin');
  assert.equal(resolveRequestRole({ remoteAddress: '::ffff:127.0.0.1' }), 'admin');
  assert.equal(resolveRequestRole({ remoteAddress: '::1' }), 'admin');
});

test('configured administrator LAN address remains an administrator', () => {
  assert.equal(resolveRequestRole({
    remoteAddress: '10.0.0.8',
    configuredAdminLanAddress: '10.0.0.8',
  }), 'admin');
});

test('other LAN clients are members', () => {
  assert.equal(resolveRequestRole({
    remoteAddress: '10.0.0.9',
    configuredAdminLanAddress: '10.0.0.8',
  }), 'member');
});

test('explicit member mode safely downgrades an administrator request', () => {
  assert.equal(resolveRequestRole({
    remoteAddress: '127.0.0.1',
    requestedRole: 'MEMBER',
  }), 'member');
});

test('a requested administrator role never elevates a member', () => {
  assert.equal(resolveRequestRole({
    remoteAddress: '10.0.0.9',
    configuredAdminLanAddress: '10.0.0.8',
    requestedRole: 'admin',
  }), 'member');
});
