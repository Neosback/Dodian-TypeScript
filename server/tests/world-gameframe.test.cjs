// Run after `yarn build`: node --test tests/world-gameframe.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const {
  parseWorldDefinition,
  WorldDefinitionValidationError,
  WORLD_GAMEFRAMES,
} = require('../dist/game/definition/WorldDefinition');

const world = (extra) => ({ spawn: { x: 3222, y: 3219, z: 0 }, zones: [{ tags: [] }], disabledPlugins: [], ...extra });

test('gameframe is optional and left out when absent', () => {
  assert.equal('gameframe' in parseWorldDefinition(world()), false);
});

test('every supported gameframe is accepted', () => {
  for (const gameframe of WORLD_GAMEFRAMES) {
    assert.equal(parseWorldDefinition(world({ gameframe })).gameframe, gameframe);
  }
});

test('an unknown gameframe is rejected', () => {
  assert.throws(() => parseWorldDefinition(world({ gameframe: 'classic-resizable' })), WorldDefinitionValidationError);
});
