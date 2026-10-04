import { Misc } from "../../../../util/Misc";
import { Player } from "../../../entity/impl/player/Player";

export abstract class Dialogue {
    private index: number;

    constructor(index: number) {
        this.index = index;
    }

    protected static sendChatText(player: Player, text: string, textUid: number, continueUid: number): void {
        // Cache script 600: if_settextalign(horizontal, vertical, lineHeight, widget).
        const SET_TEXT_ALIGN = 600;
        const PAUSE_BUTTON = 1;
        const lines = Misc.wrapText(text, 53).slice(0, 4);
        const lineHeight = lines.length === 2 ? 28 : lines.length === 3 ? 20 : 16;
        player.getPacketSender()
            .sendString(lines.join("<br>"), textUid)
            .sendClientScript(SET_TEXT_ALIGN, 1, 1, lineHeight, textUid)
            .sendString("Click here to continue", continueUid)
            .sendInterfaceFlagsRange(continueUid, -1, -1, PAUSE_BUTTON);
    }

    abstract send(player: Player);

    getIndex(): number {
        return this.index;
    }

}
