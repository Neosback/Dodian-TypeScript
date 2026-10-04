import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export class PasswordUtil {
    public static async generatePasswordHashWithSalt(password: string): Promise<string> {
        const salt = randomBytes(16).toString("hex");
        const hash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

        return `${salt}:${hash.toString("hex")}`;
    }

    public static async passwordsMatch(plainTextPassword: string, passwordHashWithSalt: string): Promise<boolean> {
        const [salt, hashHex] = passwordHashWithSalt.split(":");
        if (!/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{128}$/i.test(hashHex)) return false;

        const hash = Buffer.from(hashHex, "hex");
        const candidate = (await scryptAsync(plainTextPassword, salt, hash.length)) as Buffer;

        return candidate.length === hash.length && timingSafeEqual(candidate, hash);
    }
}
