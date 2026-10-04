import { World } from "../../../game/World";
import { CombatSpells } from "../../../game/content/combat/magic/CombatSpells";

export class MagicOnPlayerPacketListener {
  public static cast(player: any, playerIndex: number, spellId: number): boolean {
    if (!player || player.getHitpoints() <= 0) {
      return false;
    }

    if (playerIndex < 0 || playerIndex >= World.getPlayers().capacityReturn()) {
      return false;
    }
    if (spellId < 0) {
      return false;
    }

    const attacked = World.getPlayers().get(playerIndex);

    if (!attacked || attacked === player) {
      player.getMovementQueue().reset();
      return false;
    }

    if (attacked.getHitpoints() <= 0) {
      player.getMovementQueue().reset();
      return false;
    }

    const spell = CombatSpells.getCombatSpell(spellId);

    if (!spell) {
      player.getMovementQueue().reset();
      return false;
    }

    if (!spell.canCastOnTarget(player, attacked)) {
      player.getMovementQueue().reset();
      return false;
    }

    player.getCombat().castSpellOn(attacked, spell);
    return true;
  }
}
