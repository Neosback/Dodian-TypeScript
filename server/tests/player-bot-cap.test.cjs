// Run after `yarn build`: node --test tests/player-bot-cap.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MobileList } = require('../dist/game/entity/impl/MobileList');

function stubMobile() {
  return {
    registered: false,
    index: -1,
    isRegistered() { return this.registered; },
    setRegistered(value) { this.registered = value; },
    getIndex() { return this.index; },
    setIndex(value) { this.index = value; },
    onAdd() {},
    onRemove() {},
  };
}

test('bots bypass a host-imposed human player cap while capacity still bounds them', () => {
  // The browser host overrides isFull() to cap human logins only. Bots share the list,
  // so without a bypass they are dumped from the add queue once humans reach the cap.
  const list = new MobileList(16);
  let humans = 0;
  list.isFull = () => humans >= 2;
  humans = 2;
  assert.equal(list.add(stubMobile()), false, 'humans respect the cap');
  assert.equal(list.add(stubMobile(), true), true, 'bots bypass the human cap');
  assert.equal(list.sizeReturn(), 1, 'the bot was actually registered');

  // A bypass must not let the list grow past its real slot capacity.
  const tiny = new MobileList(2);
  tiny.isFull = () => true;
  assert.equal(tiny.add(stubMobile(), true), true);
  assert.equal(tiny.add(stubMobile(), true), true);
  assert.equal(tiny.add(stubMobile(), true), false, 'capacity still bounds bots');
});
