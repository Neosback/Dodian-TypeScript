import { LostCityMidiId } from "./LostCityAudioIds";
import * as fs from "fs";
import * as path from "path";

type MusicData = {
    regions: Record<number, number[]>;
};

const MUSIC_DATA: MusicData = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.resolve("data/definitions/music-data.json"), "utf8"));
    } catch (error) {
        console.warn("[music] failed to load region music", error);
        return { regions: {} };
    }
})();

export class Music {
    public static readonly SCAPE_RUNE = LostCityMidiId.SCAPE_MAIN;
    public static readonly OLD_THEME = LostCityMidiId.THEME;
    public static readonly HWEEN_THEME = LostCityMidiId.SPOOKY2;
    public static readonly XMAS_THEME = LostCityMidiId.SEA_SHANTY_XMAS;
    public static readonly FARMING_THEME = LostCityMidiId.GARDEN;
    public static readonly HUNTER_THEME = LostCityMidiId.HUNTING;
    public static readonly SUMMON_THEME = 457;

    public static readonly QUEST_COMPLETE_JINGLES: ReadonlyArray<number> = [
        LostCityMidiId.QUEST_COMPLETE_1,
        LostCityMidiId.QUEST_COMPLETE_2,
        LostCityMidiId.QUEST_COMPLETE_3,
    ];

    public static forRegion(regionId: number): number | undefined {
        return MUSIC_DATA.regions[regionId]?.[0];
    }
}
