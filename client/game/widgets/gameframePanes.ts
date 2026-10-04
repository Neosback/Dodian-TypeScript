import type { EnumTypeLoader } from "../../rs/config/enumtype/EnumTypeLoader";

/**
 * Server gameframe mounts address their target by the OSRS-stretch (161) child.
 * The other gameframe layouts have their own children, related to the standard
 * ones by the cache's pane-redirect enums - the same enums script 914 uses to
 * switch tabs per layout. Keeping mounts 161-based lets the server keep one
 * mount table for every layout.
 */
export const STANDARD_GAMEFRAME_ROOT = 161;

const PANE_REDIRECT_ENUM_BY_ROOT: Readonly<Record<number, number>> = {
    [STANDARD_GAMEFRAME_ROOT]: 1130,
    164: 1131,
    165: 1132,
    548: 1129,
};

/**
 * Standard (161) child -> child in `root`, or undefined when the root has no
 * redirect table. Entries mapped to -1 have no equivalent component and must
 * not be mounted.
 */
export function loadGameframePaneRedirect(
    enumLoader: EnumTypeLoader | undefined,
    root: number,
): Map<number, number> | undefined {
    const enumId = PANE_REDIRECT_ENUM_BY_ROOT[root | 0];
    if (enumId === undefined) return undefined;

    const enumType = enumLoader?.load(enumId);
    if (!enumType?.keys?.length || !enumType.intValues?.length) return undefined;

    const redirect = new Map<number, number>();
    for (let i = 0; i < enumType.keys.length; i++) {
        const key = enumType.keys[i] | 0;
        if (((key >>> 16) & 0xffff) !== STANDARD_GAMEFRAME_ROOT) continue;
        const value = (enumType.intValues[i] ?? -1) | 0;
        redirect.set(key & 0xffff, value < 0 ? -1 : value & 0xffff);
    }
    return redirect;
}
