import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminUser, validSettings, uuid } from '../supabase/functions/_shared/adminPolicy.ts';

test('only server-controlled admin metadata authorizes an operator', () => {
  for (const value of [undefined, null, {}, { role: 'user' }, { is_admin: 'true' }, { user_metadata: { role: 'admin' } }, { admin: true }]) assert.equal(isAdminUser(value), false);
  assert.equal(isAdminUser({ role: 'admin' }), true);
  assert.equal(isAdminUser({ is_admin: true }), true);
});
test('operator inputs reject coercion, invalid quotas, arbitrary keys, and invalid document IDs', () => {
  const settings = { revision: 0, trial_paused: false, guest_ip_daily_limit: 30, guest_global_daily_limit: 1000 };
  assert.equal(validSettings(settings), true);
  for (const extra of [{ revision: -1 }, { trial_paused: 'false' }, { guest_ip_daily_limit: 0 }, { guest_global_daily_limit: 100001 }, { guest_ip_daily_limit: 1.5 }, { guest_ip_daily_limit: '30' }, { admin: true }]) assert.equal(validSettings({ ...settings, ...extra }), false);
  assert.equal(uuid('65f85bf7-a98f-4141-90e5-a65dd18a03c2'), true);
  assert.equal(uuid('../another-user'), false);
});
