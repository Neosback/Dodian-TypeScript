import { CombatType } from "./CombatType";
import { Skill } from "../../model/Skill";
export abstract class FightStyle {
    static ACCURATE = new class extends FightStyle {
        skill(type: CombatType) {
            return type === CombatType.RANGED ? [Skill.RANGED.getIndex()] : [Skill.ATTACK.getIndex()];
        }
    }

    static AGGRESSIVE = new class extends FightStyle {
        skill(type: CombatType) {
            return type === CombatType.RANGED ? [Skill.RANGED.getIndex()] : [Skill.STRENGTH.getIndex()];
        }
    }

    static DEFENSIVE = new class extends FightStyle {
        skill(type: CombatType) {
            // Defensive combat styles split XP into offence + defence for ranged/magic.
            // Melee defensive remains defence-only.
            return type === CombatType.RANGED
                ? [Skill.RANGED.getIndex(), Skill.DEFENCE.getIndex()]
                : type === CombatType.MAGIC
                    ? [Skill.MAGIC.getIndex(), Skill.DEFENCE.getIndex()]
                : [Skill.DEFENCE.getIndex()];
        }
    }

    static CONTROLLED = new class extends FightStyle {
        skill() {
            return [Skill.ATTACK.getIndex(), Skill.STRENGTH.getIndex(), Skill.DEFENCE.getIndex()];
        }
    }

    abstract skill(type: CombatType): number[];
}
