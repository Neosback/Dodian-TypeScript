# Procedural Region Streaming POC

This POC adds a plugin-only server stream for procedurally generated region data.

## Server plugin

File: `plugins/world/ProceduralRegionStream.plugin.js`

Commands:
- `::procregion <regionX> <regionY> [seed]`
- `::procregionhere [seed]`

Both commands require `DEVELOPER` or `OWNER` rights.

## Wire format

Opcode: `12` (server -> client, variable length)

Payload:
1. `u8 type`
2. `u16 requestId`
3. `u32 regionId`
4. `u16 chunkIndex`
5. `u16 chunkCount`
6. `string payload` (newline-terminated)

Packet types:
- `0`: meta JSON
- `1`: data chunk
- `2`: end marker (payload = total json length as string)
- `3`: error string

## Minimal client handler (web client)

Add this inside `Client.readPacket()` as a branch before unknown-packet fallback:

```ts
if (this.opcode === 12) {
    const type = this.incoming.readUnsignedByte();
    const requestId = this.incoming.readUShort();
    const regionId = this.incoming.readInt();
    const chunkIndex = this.incoming.readUShort();
    const chunkCount = this.incoming.readUShort();
    const text = this.incoming.readString();

    const key = `${requestId}:${regionId}`;
    (window as any).__procRegionChunks ??= new Map();
    const store = (window as any).__procRegionChunks;

    if (type === 0) {
        store.set(key, { meta: JSON.parse(text), chunks: new Array(chunkCount).fill("") });
    } else if (type === 1) {
        const entry = store.get(key);
        if (entry && chunkIndex < entry.chunks.length) {
            entry.chunks[chunkIndex] = text;
        }
    } else if (type === 2) {
        const entry = store.get(key);
        if (entry) {
            const json = entry.chunks.join("");
            (window as any).__lastProceduralRegion = JSON.parse(json);
            console.info("[proc-region] received", entry.meta, (window as any).__lastProceduralRegion);
            store.delete(key);
        }
    } else if (type === 3) {
        console.warn("[proc-region] server error", text);
    }

    this.opcode = -1;
    return true;
}
```

## Notes

- This is transport-only scaffolding. It does not yet replace cache map/land file loading.
- Next step is binding decoded arrays to your map runtime (or region override layer) before scene build.
