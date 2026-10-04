import { MeleeCombatMethod } from "../MeleeCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { Graphic } from "../../../../../model/Graphic";
import { Priority } from "../../../../../model/Priority";
import { PendingHit } from "../../../hit/PendingHit";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { CombatSpecial } from "../../../CombatSpecial";
import { GraphicHeight } from "../../../../../model/GraphicHeight";
import { Sound } from "../../../../../Sound";
import { Sounds } from "../../../../../Sounds";
import { Player } from '../../../../../entity/impl/player/Player';
export class AbyssalWhipCombatMethod extends MeleeCombatMethod {
    private static readonly ANIMATION = new Animation(1658);
    private static readonly GRAPHIC = new Graphic(341, GraphicHeight.HIGH);

    start(character: Mobile, target: Mobile) {
        CombatSpecial.drain(character, CombatSpecial.ABYSSAL_WHIP.getDrainAmount());
        character.performAnimation(AbyssalWhipCombatMethod.ANIMATION);
        Sounds.sendSound(character, Sound.WHIP_SPECIAL);
    }

    handleAfterHitEffects(hit: PendingHit) {
        if (!hit.isAccurate()) {
            return;
        }

        const target = hit.getTarget();
        if (target.getHitpoints() <= 0) {
            return;
        }
        target.performGraphic(AbyssalWhipCombatMethod.GRAPHIC);

        // OSRS: in PvP, Energy Drain transfers 10% of the target's run energy to the attacker.
        if (target.isPlayer() && hit.getAttacker().isPlayer()) {
            const attacker = hit.getAttacker() as Player;
            const player = target as Player;
            const transferAmount = Math.floor(player.getRunEnergy() * 0.1);

            player.setRunEnergy(Math.max(0, player.getRunEnergy() - transferAmount));
            player.getPacketSender().sendRunEnergy();
            player.sendMessage("You feel drained!");

            if (player.getRunEnergy() === 0) {
                player.setRunning(false);
                player.getPacketSender().sendRunStatus();
            }

            attacker.setRunEnergy(Math.min(100, attacker.getRunEnergy() + transferAmount));
            attacker.getPacketSender().sendRunEnergy();
        }
    }
}
