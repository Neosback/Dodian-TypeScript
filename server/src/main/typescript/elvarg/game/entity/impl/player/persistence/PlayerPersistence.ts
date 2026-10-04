import type { Player } from "../Player";
import { PlayerSave } from "../persistence/PlayerSave";



export abstract class PlayerPersistence {
    abstract load(username: string): PlayerSave;
    abstract save(player: Player): void;
    abstract exists(username: string): boolean;

    public async flush(): Promise<void> {
        // Default persistence implementations are synchronous.
    }

    public async encryptPassword(plainPassword: string): Promise<string> {
        const { PasswordUtil } = require(
            "../../../../../util/PasswordUtil"
        ) as typeof import("../../../../../util/PasswordUtil");
        const passwordEncrypt: string = await PasswordUtil.generatePasswordHashWithSalt(plainPassword);
        return passwordEncrypt;
    }

    public async checkPassword(password: string, playerSave: PlayerSave): Promise<boolean> {
        const { PasswordUtil } = require(
            "../../../../../util/PasswordUtil"
        ) as typeof import("../../../../../util/PasswordUtil");
        const passwordHashWithSalt = playerSave.getPasswordHashWithSalt();
        const isMatch: boolean = await PasswordUtil.passwordsMatch(password, passwordHashWithSalt);
        return isMatch;
    }
}
