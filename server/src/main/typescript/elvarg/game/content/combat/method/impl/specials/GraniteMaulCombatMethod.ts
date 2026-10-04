import { MeleeCombatMethod } from "../MeleeCombatMethod";
import { Animation } from "../../../../../model/Animation";
import { Graphic } from "../../../../../model/Graphic";
import { Mobile } from "../../../../../entity/impl/Mobile";
import { GraphicHeight } from "../../../../../model/GraphicHeight";
import { Sounds } from "../../../../../Sounds";

export class GraniteMaulCombatMethod extends MeleeCombatMethod {
    private static ANIMATION = new Animation(1667);
    private static GRAPHIC = new Graphic(340, GraphicHeight.HIGH);
    start(character: Mobile, target: Mobile): void {
        character.performAnimation(GraniteMaulCombatMethod.ANIMATION);
        character.performGraphic(GraniteMaulCombatMethod.GRAPHIC);
        Sounds.sendSound(character, character.getAttackSound());
    }
}
    
