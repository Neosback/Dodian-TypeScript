# Setup Guide

Get xRSPS running locally in a few minutes.

The repository contains **`client/`**, **`server/`**, and **`docs/`** packages. The root commands install and run the server and client for you.

## Prerequisites

| Tool                                                | Version      | Why                                |
| --------------------------------------------------- | ------------ | ---------------------------------- |
| [Node.js](https://nodejs.org/)                      | v22.16+      | Runtime for both client and server |
| [Yarn](https://classic.yarnpkg.com/en/docs/install) | v1 (Classic) | Package manager                    |
| [Git](https://git-scm.com/)                         | Any recent   | Clone the repo                     |

::: tip Node Version
Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage Node versions easily:

```bash
nvm install 22
nvm use 22
```

:::

## 1. Clone the Repository

```bash
git clone https://github.com/xrsps/xrsps-typescript.git
cd xrsps-typescript
```

## 2. Set Up the Server and Client

```bash
yarn setup
```

This installs the root command runner, server dependencies, and client dependencies, downloads the required OSRS cache, then builds the collision cache.

## 3. Start the Server and Client

```bash
yarn start
```

This starts both processes in the same terminal. Press `Ctrl+C` to stop them.

To start only the game server:

```bash
yarn server
```

To start only the web client:

```bash
yarn client
```

::: info
The collision build can take a few minutes during the initial `yarn setup`. It reads the game cache and writes collision data to `server/cache/collision/`.
:::

## Server Startup

The server will:

1. Automatically download the OSRS cache if it hasn't been fetched yet (`server/caches/`)
2. Load collision data, spells, and game scripts
3. Start a WebSocket server on `0.0.0.0:43594`

You should see log output confirming the server is ready.

By default, the server runs the **vanilla** gamemode. To run a different gamemode:

```bash
# Environment variable
GAMEMODE=leagues-v yarn start

# Or set it in server/config.json
{ "gamemode": "leagues-v" }
```

## Client Startup

This launches the React dev server (usually on `http://localhost:3000`). Your browser should open automatically. The client will also download the cache on first run if needed.

## You're In

Log in with a username and a password of 8 to 20 characters. The first successful login registers that username; later logins must use the same password.

### Account registration and legacy characters

New account registration is enabled by default. Set `ALLOW_ACCOUNT_REGISTRATION=false` when you want to stop new usernames from being registered.

When upgrading a server that already has `player-state.json` character saves but no account passwords, temporarily start the server with:

```bash
cd server
ALLOW_LEGACY_ACCOUNT_CLAIM=true yarn start
```

This lets each legacy username assign a password on its next login. Disable the option again after the migration window so another person cannot claim an unclaimed character name. Existing `accounts.json` password hashes are imported automatically and do not require this option.

---

## Troubleshooting

### Cache download hangs or fails

The cache is downloaded from the [OpenRS2 Archive](https://archive.openrs2.org/). If it stalls:

- Check your internet connection
- Delete the `server/caches/` folder and try again
- The target cache version is defined in `server/target.txt`

### `yarn build-collision` is slow

This is expected on first run. Subsequent runs are fast because results are cached in `server/cache/collision/`.

### Port 43594 already in use

Another instance of the server is likely running. Kill it or change the port in the server config.

### Client shows a blank screen

- Make sure the server is running first
- Check the browser console for WebSocket connection errors
- Ensure the cache download completed (check `server/caches/` folder)

### Node version errors

Ensure you're on Node v22.16+:

```bash
node -v
```

---

## Useful Commands

Run the first three commands from the repository root. Package-specific maintenance commands can still be run from their package directory.

| Command | Description |
| ------- | ----------- |
| `yarn setup` | Install the server and client and build collision data |
| `yarn start` | Start the game server and web client together |
| `yarn server` | Start only the game server |
| `yarn client` | Start only the web client |
| `cd server && yarn ensure-cache` | Manually download the OSRS cache |
| `cd client && yarn typecheck` | Typecheck the client |
| `cd server && yarn typecheck` | Typecheck the server |
