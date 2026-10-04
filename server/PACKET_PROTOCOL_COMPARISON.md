# Packet protocol comparison: Elvarg Web Server, xRSPS, and OpenRune

**Snapshot:** 2026-08-11  
**OpenRune source:** `d3f10edd1a754b045d9fd9f7710775161b1c047b` (RSProt dependencies: revision 240; default server configuration: revision 233)

## Result

| Scope | Elvarg packets | xRSPS packets | Opcode + declared-frame-length parity | OpenRune numeric comparison |
| --- | ---: | ---: | --- | --- |
| Application ingress | 33 | 33 | 33/33 exact | Unavailable: OpenRune source revision conflict |
| Native game-action ingress | 55 | 55 | 55/55 exact | Unavailable: OpenRune source revision conflict |
| Server egress | 72 | 72 | 72/72 exact | Unavailable: OpenRune source revision conflict |
| **Total** | **160** | **160** | **160/160 exact** | See OpenRune boundary below |

Elvarg and xRSPS have no enumerated opcode or declared frame-length differences in these three packet families.

`V1` means a variable payload with a one-byte length prefix; `V2` means a variable payload with a two-byte length prefix. A fixed frame is shown as its payload byte count.

## Scope and source files

| Family | Elvarg source | xRSPS source |
| --- | --- | --- |
| Application ingress | `elvarg-web-server/src/main/typescript/elvarg/net/protocol/ClientPackets.ts` | `xrsps-typescript/client/common/packets/ClientPacketId.ts` |
| Native game-action ingress | `elvarg-web-server/src/main/typescript/elvarg/net/protocol/NativeClientPackets.ts` | `xrsps-typescript/client/common/network/ClientPacketId.ts` |
| Server egress | `elvarg-web-server/src/main/typescript/elvarg/net/protocol/ServerPackets.ts` | `xrsps-typescript/client/common/packets/ServerPacketId.ts` |

This is an ID/declared-size audit. It deliberately does **not** claim byte-order or field-layout parity: those must be checked in the matching encoder/decoder for a specific failing packet.

## OpenRune boundary

OpenRune is not a third copy of either TypeScript opcode enum. Its network factory delegates game protocol encoding and decoding to RSProt, then registers typed message consumers. Its version catalog pins `net.rsprot:osrs-240-api` and `net.rsprot:osrs-240-shared`, but its default server configuration is revision 233. Its startup check requires equality, so this checked OpenRune snapshot cannot start with its generated default configuration until that revision conflict is reconciled.

| Area | OpenRune source evidence | Comparison result |
| --- | --- | --- |
| Protocol ownership | `api/net/.../rsprot/NetworkFactory.kt` extends RSProt's `AbstractNetworkServiceFactory` | Opcode table is generated/owned by RSProt, not a local enum |
| Pinned codec revision | `gradle/libs.versions.toml` depends on `net.rsprot:osrs-240-api` and `net.rsprot:osrs-240-shared` | A revision-240 RSProt map is required for exact IDs |
| Default configuration revision | `ServerConfigLoader.kt` sets `revision = 233` | Conflicts with the revision-240 dependencies |
| Revision lock | `api/net/.../rsprot/NetworkScript.kt` checks `RSProtConstants.REVISION == config.revision` | The default source configuration fails its own startup guard |
| Inbound registration | `api/net/.../rsprot/provider/MessageConsumerProvider.kt` registers typed consumers | Semantic coverage exists for movement, interface ops, entity ops, modal close, and resumed dialogs |
| Outbound messages | OpenRune queues RSProt `OutgoingGameMessage` classes | No local fixed packet-ID table to line up with Elvarg/xRSPS |
| Application WebSocket protocol | No equivalent in OpenRune's game-protocol path | Elvarg/xRSPS custom application packets are intentionally not comparable |

† **RSProt** in the packet tables means OpenRune may support the concept, but this repository does not expose a fixed numeric opcode and declared length for a valid 1:1 comparison. The checked source also pins RSProt revision 240 while defaulting the game config to revision 233. It is not a claim that the packet is unsupported.

## OpenRune semantic inbound coverage

| Packet family | OpenRune typed messages registered |
| --- | --- |
| Interface actions | `If3Button`, `IfButtonD`, `IfButtonT`, `IfScriptTrigger`, `IfSubOp` |
| Movement and UI state | `MoveGameClick`, `MoveMinimapClick`, `ClickWorldMap`, `WindowStatus`, `CloseModal` |
| Location interactions | `OpLocV2`, `OpLocT`, `OpLoc6` |
| NPC interactions | `OpNpcV2`, `OpNpcT`, `OpNpc6` |
| Ground-item interactions | `OpObjV2`, `OpObj6` |
| Player interactions | `OpPlayer`, `OpPlayerT` |
| Dialogues | `ResumePauseButton`, `ResumePCountDialog`, `ResumePNameDialog`, `ResumePStringDialog`, `ResumePObjDialog` |
| Chat and social | public/private message, friends, ignores, chat-filter settings |

## Complete packet tables

### Application ingress (custom WebSocket binary)

| Packet | Elvarg ID / frame | xRSPS ID / frame | Elvarg ↔ xRSPS | OpenRune |
| --- | --- | --- | --- | --- |
| `TRADE_ACTION` | 180 / V1 | 180 / V1 | Exact | RSProt† |
| `CHAT` | 190 / V1 | 190 / V1 | Exact | RSProt† |
| `VARP_TRANSMIT` | 191 / 6 | 191 / 6 | Exact | RSProt† |
| `RESUME_COUNTDIALOG` | 192 / 4 | 192 / 4 | Exact | RSProt† |
| `RESUME_NAMEDIALOG` | 193 / V1 | 193 / V1 | Exact | RSProt† |
| `RESUME_STRINGDIALOG` | 194 / V1 | 194 / V1 | Exact | RSProt† |
| `MAP_EDIT` | 195 / V1 | 195 / V1 | Exact | RSProt† |
| `HELLO` | 200 / V1 | 200 / V1 | Exact | RSProt† |
| `PING` | 201 / 4 | 201 / 4 | Exact | RSProt† |
| `HANDSHAKE` | 202 / V1 | 202 / V1 | Exact | RSProt† |
| `LOGOUT` | 203 / 0 | 203 / 0 | Exact | RSProt† |
| `LOGIN` | 204 / V2 | 204 / V2 | Exact | RSProt† |
| `WALK` | 210 / 5 | 210 / 5 | Exact | RSProt† |
| `FACE` | 211 / V1 | 211 / V1 | Exact | RSProt† |
| `TELEPORT` | 212 / 5 | 212 / 5 | Exact | RSProt† |
| `PATHFIND` | 213 / V1 | 213 / V1 | Exact | RSProt† |
| `LOC_INTERACT` | 231 / V1 | 231 / V1 | Exact | RSProt† |
| `GROUND_ITEM_ACTION` | 232 / V1 | 232 / V1 | Exact | RSProt† |
| `INTERACT` | 233 / V1 | 233 / V1 | Exact | RSProt† |
| `INTERACT_STOP` | 234 / 0 | 234 / 0 | Exact | RSProt† |
| `INVENTORY_USE` | 240 / V1 | 240 / V1 | Exact | RSProt† |
| `INVENTORY_USE_ON` | 241 / V1 | 241 / V1 | Exact | RSProt† |
| `INVENTORY_MOVE` | 242 / 4 | 242 / 4 | Exact | RSProt† |
| `BANK_DEPOSIT_INVENTORY` | 243 / 0 | 243 / 0 | Exact | RSProt† |
| `BANK_DEPOSIT_EQUIPMENT` | 244 / 0 | 244 / 0 | Exact | RSProt† |
| `BANK_MOVE` | 245 / V1 | 245 / V1 | Exact | RSProt† |
| `ITEM_SPAWNER_SEARCH` | 246 / V1 | 246 / V1 | Exact | RSProt† |
| `WIDGET` | 250 / V1 | 250 / V1 | Exact | RSProt† |
| `WIDGET_ACTION` | 251 / V1 | 251 / V1 | Exact | RSProt† |
| `RESUME_PAUSEBUTTON` | 252 / 6 | 252 / 6 | Exact | RSProt† |
| `IF_BUTTOND` | 253 / 16 | 253 / 16 | Exact | RSProt† |
| `EMOTE` | 254 / 3 | 254 / 3 | Exact | RSProt† |
| `DEBUG` | 255 / V2 | 255 / V2 | Exact | RSProt† |

### Native game-action ingress

| Packet | Elvarg ID / frame | xRSPS ID / frame | Elvarg ↔ xRSPS | OpenRune |
| --- | --- | --- | --- | --- |
| `IF_BUTTOND` | 1 / 16 | 1 / 16 | Exact | RSProt† |
| `OPLOC_T` | 2 / 15 | 2 / 15 | Exact | RSProt† |
| `OPPLAYER5` | 6 / 3 | 6 / 3 | Exact | RSProt† |
| `EXAMINE_NPC` | 9 / 2 | 9 / 2 | Exact | RSProt† |
| `OPPLAYER7` | 10 / 3 | 10 / 3 | Exact | RSProt† |
| `IF_BUTTON6` | 11 / 8 | 11 / 8 | Exact | RSProt† |
| `OPNPC2` | 12 / 3 | 12 / 3 | Exact | RSProt† |
| `IF_BUTTON` | 13 / 4 | 13 / 4 | Exact | RSProt† |
| `IF_BUTTON7` | 14 / 8 | 14 / 8 | Exact | RSProt† |
| `MOVE_GAMECLICK` | 16 / 7 | 16 / 7 | Exact | RSProt† |
| `IF_BUTTON8` | 19 / 8 | 19 / 8 | Exact | RSProt† |
| `IF_BUTTON9` | 20 / 8 | 20 / 8 | Exact | RSProt† |
| `OPPLAYER8` | 21 / 3 | 21 / 3 | Exact | RSProt† |
| `IF_BUTTON1` | 23 / 8 | 23 / 8 | Exact | RSProt† |
| `IF_BUTTON2` | 25 / 8 | 25 / 8 | Exact | RSProt† |
| `OPLOC2` | 28 / 7 | 28 / 7 | Exact | RSProt† |
| `IF_TRIGGEROPLOCAL` | 30 / V2 | 30 / V2 | Exact | RSProt† |
| `IF_BUTTON3` | 31 / 8 | 31 / 8 | Exact | RSProt† |
| `OPPLAYER_T` | 32 / 11 | 32 / 11 | Exact | RSProt† |
| `OPNPC3` | 34 / 3 | 34 / 3 | Exact | RSProt† |
| `OPNPC_U` | 36 / 11 | 36 / 11 | Exact | RSProt† |
| `APPEARANCE_SET` | 37 / 13 | 37 / 13 | Exact | RSProt† |
| `OPLOC4` | 38 / 7 | 38 / 7 | Exact | RSProt† |
| `OPLOC3` | 42 / 7 | 42 / 7 | Exact | RSProt† |
| `OPOBJ2` | 43 / 7 | 43 / 7 | Exact | RSProt† |
| `OPPLAYER1` | 44 / 3 | 44 / 3 | Exact | RSProt† |
| `OPPLAYER2` | 45 / 3 | 45 / 3 | Exact | RSProt† |
| `OPPLAYER3` | 46 / 3 | 46 / 3 | Exact | RSProt† |
| `OPPLAYER6` | 48 / 3 | 48 / 3 | Exact | RSProt† |
| `OPNPC5` | 50 / 3 | 50 / 3 | Exact | RSProt† |
| `OPLOC5` | 51 / 7 | 51 / 7 | Exact | RSProt† |
| `IF_CLOSE` | 55 / 0 | 55 / 0 | Exact | RSProt† |
| `OPOBJ4` | 56 / 7 | 56 / 7 | Exact | RSProt† |
| `OPNPC1` | 57 / 3 | 57 / 3 | Exact | RSProt† |
| `RESUME_PAUSEBUTTON` | 62 / 6 | 62 / 6 | Exact | RSProt† |
| `IF_BUTTON4` | 63 / 8 | 63 / 8 | Exact | RSProt† |
| `OPPLAYER_U` | 65 / 11 | 65 / 11 | Exact | RSProt† |
| `IF_BUTTON5` | 69 / 8 | 69 / 8 | Exact | RSProt† |
| `OPNPC4` | 70 / 3 | 70 / 3 | Exact | RSProt† |
| `OPPLAYER4` | 73 / 3 | 73 / 3 | Exact | RSProt† |
| `OPNPC_T` | 75 / 11 | 75 / 11 | Exact | RSProt† |
| `OPNPC1_ALT` | 76 / 3 | 76 / 3 | Exact | RSProt† |
| `OPOBJ_U` | 79 / 15 | 79 / 15 | Exact | RSProt† |
| `OPOBJ5` | 82 / 7 | 82 / 7 | Exact | RSProt† |
| `IF_BUTTON10` | 84 / 8 | 84 / 8 | Exact | RSProt† |
| `EXAMINE_LOC` | 85 / 2 | 85 / 2 | Exact | RSProt† |
| `OPLOCU` | 86 / 15 | 86 / 15 | Exact | RSProt† |
| `IF_BUTTON_SUB` | 89 / 10 | 89 / 10 | Exact | RSProt† |
| `IF_BUTTONT` | 90 / 16 | 90 / 16 | Exact | RSProt† |
| `OPLOC_T_ALT` | 94 / 15 | 94 / 15 | Exact | RSProt† |
| `OPLOC1` | 96 / 7 | 96 / 7 | Exact | RSProt† |
| `OPOBJ1` | 102 / 7 | 102 / 7 | Exact | RSProt† |
| `OPOBJ3` | 103 / 7 | 103 / 7 | Exact | RSProt† |
| `EXAMINE_OBJ` | 104 / 6 | 104 / 6 | Exact | RSProt† |
| `WORLD_MAP_CLICK` | 105 / 4 | 105 / 4 | Exact | RSProt† |

### Server egress (custom WebSocket binary)

| Packet | Elvarg ID / frame | xRSPS ID / frame | Elvarg ↔ xRSPS | OpenRune |
| --- | --- | --- | --- | --- |
| `WELCOME` | 0 / 8 | 0 / 8 | Exact | RSProt† |
| `TICK` | 1 / 8 | 1 / 8 | Exact | RSProt† |
| `HANDSHAKE` | 2 / V1 | 2 / V1 | Exact | RSProt† |
| `LOGIN_RESPONSE` | 3 / V1 | 3 / V1 | Exact | RSProt† |
| `LOGOUT_RESPONSE` | 4 / V1 | 4 / V1 | Exact | RSProt† |
| `PATH_RESPONSE` | 5 / V1 | 5 / V1 | Exact | RSProt† |
| `PLAYER_SYNC` | 20 / V2 | 20 / V2 | Exact | RSProt† |
| `NPC_INFO` | 21 / V2 | 21 / V2 | Exact | RSProt† |
| `ANIM` | 22 / 22 | 22 / 22 | Exact | RSProt† |
| `VARP_SMALL` | 40 / 3 | 40 / 3 | Exact | RSProt† |
| `VARP_LARGE` | 41 / 6 | 41 / 6 | Exact | RSProt† |
| `VARBIT` | 42 / 6 | 42 / 6 | Exact | RSProt† |
| `VARP_BATCH` | 43 / V1 | 43 / V1 | Exact | RSProt† |
| `INVENTORY_SNAPSHOT` | 50 / V2 | 50 / V2 | Exact | RSProt† |
| `INVENTORY_SLOT` | 51 / V1 | 51 / V1 | Exact | RSProt† |
| `BANK_SNAPSHOT` | 52 / V2 | 52 / V2 | Exact | RSProt† |
| `BANK_SLOT` | 53 / V1 | 53 / V1 | Exact | RSProt† |
| `GROUND_ITEMS` | 54 / V2 | 54 / V2 | Exact | RSProt† |
| `GROUND_ITEMS_DELTA` | 55 / V2 | 55 / V2 | Exact | RSProt† |
| `SKILLS_SNAPSHOT` | 70 / V1 | 70 / V1 | Exact | RSProt† |
| `SKILLS_DELTA` | 71 / V1 | 71 / V1 | Exact | RSProt† |
| `COMBAT_STATE` | 80 / V1 | 80 / V1 | Exact | RSProt† |
| `RUN_ENERGY` | 81 / 2 | 81 / 2 | Exact | RSProt† |
| `HITSPLAT` | 82 / V1 | 82 / V1 | Exact | RSProt† |
| `SPOT_ANIM` | 83 / V1 | 83 / V1 | Exact | RSProt† |
| `PROJECTILES` | 84 / V2 | 84 / V2 | Exact | RSProt† |
| `SPELL_RESULT` | 85 / V2 | 85 / V2 | Exact | RSProt† |
| `DEBUG_PACKET` | 86 / V2 | 86 / V2 | Exact | RSProt† |
| `DESTINATION` | 87 / 4 | 87 / 4 | Exact | RSProt† |
| `WIDGET_OPEN` | 100 / 3 | 100 / 3 | Exact | RSProt† |
| `WIDGET_CLOSE` | 101 / 2 | 101 / 2 | Exact | RSProt† |
| `WIDGET_SET_ROOT` | 102 / 2 | 102 / 2 | Exact | RSProt† |
| `WIDGET_OPEN_SUB` | 103 / V2 | 103 / V2 | Exact | RSProt† |
| `WIDGET_CLOSE_SUB` | 104 / 4 | 104 / 4 | Exact | RSProt† |
| `WIDGET_SET_TEXT` | 105 / V2 | 105 / V2 | Exact | RSProt† |
| `WIDGET_SET_HIDDEN` | 106 / 5 | 106 / 5 | Exact | RSProt† |
| `WIDGET_SET_ITEM` | 107 / 10 | 107 / 10 | Exact | RSProt† |
| `WIDGET_SET_NPC_HEAD` | 108 / 6 | 108 / 6 | Exact | RSProt† |
| `WIDGET_SET_FLAGS_RANGE` | 109 / 12 | 109 / 12 | Exact | RSProt† |
| `WIDGET_RUN_SCRIPT` | 110 / V2 | 110 / V2 | Exact | RSProt† |
| `WIDGET_SET_FLAGS` | 111 / 8 | 111 / 8 | Exact | RSProt† |
| `WIDGET_SET_ANIMATION` | 114 / 6 | 114 / 6 | Exact | RSProt† |
| `WIDGET_SET_PLAYER_HEAD` | 115 / 4 | 115 / 4 | Exact | RSProt† |
| `WIDGET_SET_QUEST_LIST` | 116 / V2 | 116 / V2 | Exact | RSProt† |
| `CHAT_MESSAGE` | 120 / V1 | 120 / V1 | Exact | RSProt† |
| `LOC_CHANGE` | 130 / V1 | 130 / V1 | Exact | RSProt† |
| `SOUND` | 131 / V1 | 131 / V1 | Exact | RSProt† |
| `PLAY_JINGLE` | 132 / 5 | 132 / 5 | Exact | RSProt† |
| `PLAY_SONG` | 133 / 10 | 133 / 10 | Exact | RSProt† |
| `LOC_ADD_CHANGE` | 134 / V1 | 134 / V1 | Exact | RSProt† |
| `LOC_DEL` | 135 / V1 | 135 / V1 | Exact | RSProt† |
| `LOC_ANIM` | 136 / 10 | 136 / 10 | Exact | RSProt† |
| `REBUILD_REGION` | 140 / V2 | 140 / V2 | Exact | RSProt† |
| `REBUILD_NORMAL` | 141 / V2 | 141 / V2 | Exact | RSProt† |
| `REBUILD_WORLDENTITY` | 142 / V2 | 142 / V2 | Exact | RSProt† |
| `WORLDENTITY_INFO` | 143 / V1 | 143 / V1 | Exact | RSProt† |
| `SHOP_OPEN` | 150 / V2 | 150 / V2 | Exact | RSProt† |
| `SHOP_SLOT` | 151 / V1 | 151 / V1 | Exact | RSProt† |
| `SHOP_CLOSE` | 152 / 0 | 152 / 0 | Exact | RSProt† |
| `SHOP_MODE` | 153 / V1 | 153 / V1 | Exact | RSProt† |
| `TRADE_REQUEST` | 154 / V1 | 154 / V1 | Exact | RSProt† |
| `TRADE_OPEN` | 155 / V2 | 155 / V2 | Exact | RSProt† |
| `TRADE_UPDATE` | 156 / V2 | 156 / V2 | Exact | RSProt† |
| `TRADE_CLOSE` | 157 / V1 | 157 / V1 | Exact | RSProt† |
| `RUN_CLIENT_SCRIPT` | 170 / V2 | 170 / V2 | Exact | RSProt† |
| `SMITHING_OPEN` | 180 / V2 | 180 / V2 | Exact | RSProt† |
| `SMITHING_MODE` | 181 / 5 | 181 / 5 | Exact | RSProt† |
| `SMITHING_CLOSE` | 182 / 0 | 182 / 0 | Exact | RSProt† |
| `COLLECTION_LOG_SNAPSHOT` | 190 / V2 | 190 / V2 | Exact | RSProt† |
| `NOTIFICATION` | 200 / V1 | 200 / V1 | Exact | RSProt† |
| `GAMEMODE_DATA` | 210 / V2 | 210 / V2 | Exact | RSProt† |
| `DEBUG` | 250 / V2 | 250 / V2 | Exact | RSProt† |

## Practical reading

- For the Elvarg/xRSPS path, changing a listed ID or frame length is a protocol regression; this report verifies none currently differ.
- A bank, widget, or sidebar failure can still exist with this table fully green: it is more likely in decoder field transforms, packet routing, UI lifecycle, or server action handling than in these constants.
- To make OpenRune numeric comparisons actionable, first reconcile OpenRune's `240` RSProt dependencies with its `233` default configuration, then run all three systems against the **same cache/RSProt revision** and export RSProt's generated incoming and outgoing opcode map for that revision.
