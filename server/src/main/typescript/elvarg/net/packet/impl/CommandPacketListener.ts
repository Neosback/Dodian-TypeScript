// import { Player } from "../../../game/entity/impl/player/Player";
// import { Command } from "../../../game/model/commands/Command";
// import { CommandManager } from "../../../game/model/commands/CommandManager";
import { PluginManager } from "../../../plugins/PluginManager";

export class CommandPacketListener {
  public static execute(player: any, rawCommand: string): void {
    if (player.getHitpoints() <= 0) {
      return;
    }
    const sanitizedCommand = rawCommand.replace(/\u0000/g, " ").trim();
    if (!sanitizedCommand.length) {
      return;
    }
    const parts = sanitizedCommand.split(/\s+/);
    // Accept payload variants like "::item 1351", "/item 1351", and tokens with trailing punctuation.
    const baseToken = parts[0].replace(/^[:/]+/, "");
    const baseMatch = baseToken.match(/^[a-z0-9_]+/i);
    if (!baseMatch) {
      return;
    }
    const baseCommand = baseMatch[0].toLowerCase();
    parts[0] = baseCommand;

    const pluginHandled = PluginManager.emitCommand({
      player,
      raw: sanitizedCommand,
      base: baseCommand,
      parts,
      handled: false,
    });
    if (pluginHandled) {
      return;
    }
    console.warn("[command] unhandled_command", {
      username: player?.getUsername?.() ?? "unknown",
      raw: rawCommand,
      sanitized: sanitizedCommand,
      base: baseCommand,
      parts,
    });

    // let c: Command | undefined = CommandManager.commands.get(parts[0]);
    // if (c) {
    //     if (c.canUse(player)) {
    //         c.execute(player, command, parts);
    //     } else {
    //         // do something if player can't use command
    //     }
    // } else {
    player.sendMessage("This command does not exist. Try ::players.");
    // }
  }
}
