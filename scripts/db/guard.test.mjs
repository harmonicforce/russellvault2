// Guard tests: every refusal happens inside buildLocalConnection, i.e. before
// any database command is constructed or spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalConnection, ShadowGuardError, validateDbName } from './guard.mjs';

const refused = (env) => assert.throws(() => buildLocalConnection(env), ShadowGuardError);

test('remote PGHOST values are refused', () => {
  refused({ PGHOST: 'db.example.com' });
  refused({ PGHOST: 'db.abcdefghijklmnop.supabase.co' });
  refused({ PGHOST: '10.0.0.5' });
  refused({ PGHOST: '192.168.1.20' });
});

test('non-loopback PGHOSTADDR is refused even with a local PGHOST', () => {
  refused({ PGHOSTADDR: '8.8.8.8' });
  refused({ PGHOST: 'localhost', PGHOSTADDR: '203.0.113.7' });
});

test('service-file indirection is refused', () => {
  refused({ PGSERVICE: 'production' });
  refused({ PGSERVICEFILE: '/tmp/pg_service.conf' });
  refused({ PGSYSCONFDIR: '/tmp/pgconf' });
});

test('malformed and injection-shaped database names are refused', () => {
  refused({ SHADOW_DB_NAME: 'bad-name' });
  refused({ SHADOW_DB_NAME: 'x;drop database postgres' });
  refused({ SHADOW_DB_NAME: 'name"with"quotes' });
  refused({ SHADOW_DB_NAME: 'UpperCase' });
  refused({ SHADOW_DB_NAME: '1starts_with_digit' });
  refused({ SHADOW_DB_NAME: '' });
  refused({ SHADOW_DB_NAME: 'a'.repeat(64) });
  assert.throws(() => validateDbName('x); drop table items; --'), ShadowGuardError);
});

test('invalid PGPORT is refused', () => {
  refused({ PGPORT: 'abc' });
  refused({ PGPORT: '0' });
  refused({ PGPORT: '70000' });
});

test('local hosts and socket paths are accepted with explicit host args', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '/var/run/postgresql']) {
    const conn = buildLocalConnection({ PGHOST: host });
    assert.deepEqual(conn.hostArgs, ['-h', host]);
  }
});

test('no host at all uses the default socket with redirecting vars stripped', () => {
  const conn = buildLocalConnection({ HOME: '/home/x' });
  assert.deepEqual(conn.hostArgs, []);
  assert.ok(!('PGHOST' in conn.env));
  assert.ok(!('PGHOSTADDR' in conn.env));
  assert.ok(!('PGSERVICE' in conn.env));
  assert.ok(!('PGSERVICEFILE' in conn.env));
  assert.ok(!('PGSYSCONFDIR' in conn.env));
  assert.equal(conn.dbName, 'russellvault_shadow');
});

test('loopback PGHOSTADDR alone is used as the explicit host', () => {
  const conn = buildLocalConnection({ PGHOSTADDR: '127.0.0.1' });
  assert.deepEqual(conn.hostArgs, ['-h', '127.0.0.1']);
  assert.ok(!('PGHOSTADDR' in conn.env));
});

test('valid custom database names are accepted', () => {
  const conn = buildLocalConnection({ SHADOW_DB_NAME: 'my_shadow_db2' });
  assert.equal(conn.dbName, 'my_shadow_db2');
});
