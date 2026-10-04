// Run with: node server/scripts/indexeddb-persistence-password-smoke.cjs
// Browser-host accounts must never be stored as plaintext; the plugin hashes with
// PBKDF2-HMAC-SHA256 built on createHash because WebContainer's node:crypto throws
// on scrypt. Stub the base persistence so this does not need the whole game graph.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const persistenceDirectory = path.join(__dirname, "../plugins/persistence");
const basePath = path.join(persistenceDirectory, "JsonPlayerPersistence.plugin.js");
class FakeJsonPlayerPersistence {}
require.cache[basePath] = {
  id: basePath,
  filename: basePath,
  loaded: true,
  exports: { JsonPlayerPersistence: FakeJsonPlayerPersistence },
};

const { IndexedDbPlayerPersistence } = require(path.join(
  persistenceDirectory,
  "IndexedDbPlayerPersistence.plugin.js"
));
const persistence = new IndexedDbPlayerPersistence();
const saveWith = (hash) => ({ getPasswordHashWithSalt: () => hash });

const stored = persistence.encryptPassword("hunter2");
assert.notEqual(stored, "hunter2");
assert.ok(stored.includes(":"), "stored hash must contain ':' for the login path to verify it");

const [scheme, iterations, salt, hash] = stored.split(":");
assert.equal(scheme, "pbkdf2");
assert.ok(Number(iterations) >= 100000);
assert.equal(
  hash,
  crypto.pbkdf2Sync(Buffer.from("hunter2"), salt, Number(iterations), 32, "sha256").toString("hex")
);

assert.equal(persistence.checkPassword("hunter2", saveWith(stored)), true);
assert.equal(persistence.checkPassword("hunter3", saveWith(stored)), false);
assert.equal(persistence.checkPassword("hunter2", saveWith("")), false);
assert.equal(persistence.checkPassword("hunter2", saveWith("hunter2")), false);
assert.notEqual(persistence.encryptPassword("hunter2"), stored, "each hash must use a fresh salt");

console.log("IndexedDB persistence password smoke checks passed");
