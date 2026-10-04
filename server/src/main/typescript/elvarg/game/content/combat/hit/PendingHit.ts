import { CombatFactory } from "../CombatFactory";
import { HitDamage } from "./HitDamage";
import { CombatType } from "../CombatType";
import { CombatMethod } from "../method/CombatMethod";
import { Mobile } from "../../../entity/impl/Mobile";
import type { Player } from "../../../entity/impl/player/Player";
import { AccuracyFormulasDpsCalc } from "../formula/AccuracyFormulasDpsCalc";
import { HitMask } from "./HitMask";
import { ServerPerf } from "../../../../util/ServerPerf";
import { ArceuusSpells } from "../magic/ArceuusSpells";
import { PluginManager } from "../../../../plugins/PluginManager";

type PendingHitConfig = {
    delay?: number;
    handleAfterHitEffects?: boolean;
    hitAmount?: number;
    rollAccuracy?: boolean;
};

export class PendingHit {
    private attacker: Mobile;
    private target: Mobile;
    private method: CombatMethod;
    private combatType: CombatType;
    private hits: HitDamage[];
    private totalDamage = 0;
    private readonly delay: number;
    private accurate: boolean;
    private handleAfterHitEffects: boolean;

    constructor(attacker: Mobile, target: Mobile, method: CombatMethod, delayOrConfig?: number | PendingHitConfig, handleAfterHitEffects?: boolean) {
        this.attacker = attacker;
        this.target = target;
        this.method = method;
        this.combatType = method.type();

        let resolvedDelay = 0;
        let resolvedHandleAfterHitEffects = true;
        let resolvedHitAmount = 1;
        let resolvedRollAccuracy = true;

        if (typeof delayOrConfig === "number") {
            resolvedDelay = delayOrConfig;
            if (typeof handleAfterHitEffects === "boolean") {
                resolvedHandleAfterHitEffects = handleAfterHitEffects;
            }
        } else if (delayOrConfig && typeof delayOrConfig === "object") {
            if (Number.isInteger(delayOrConfig.delay)) {
                resolvedDelay = delayOrConfig.delay as number;
            }
            if (typeof delayOrConfig.handleAfterHitEffects === "boolean") {
                resolvedHandleAfterHitEffects = delayOrConfig.handleAfterHitEffects;
            }
            if (Number.isInteger(delayOrConfig.hitAmount) && (delayOrConfig.hitAmount as number) > 0) {
                resolvedHitAmount = delayOrConfig.hitAmount as number;
            }
            if (typeof delayOrConfig.rollAccuracy === "boolean") {
                resolvedRollAccuracy = delayOrConfig.rollAccuracy;
            }
        }

        this.hits = this.prepareHits(resolvedHitAmount, resolvedRollAccuracy);
        this.delay = Math.max(0, resolvedDelay);
        this.handleAfterHitEffects = resolvedHandleAfterHitEffects;
    }

    public getAttacker(): Mobile {
        return this.attacker;
    }

    public getTarget(): Mobile {
        return this.target;
    }

    public getCombatMethod(): CombatMethod {
        return this.method;
    }

    public getHits(): HitDamage[] {
        return this.hits;
    }

    public getDelay(): number {
        return this.delay;
    }

    public getTotalDamage(): number {
        return this.totalDamage;
    }

    public isAccurate(): boolean {
        return this.accurate;
    }

    public setTotalDamage(damage: number): void {
        for (let hit of this.hits) {
            hit.setDamage(damage);
        }
        this.updateTotalDamage();
    }

    public setHandleAfterHitEffects(handleAfterHitEffects: boolean): PendingHit {
        this.handleAfterHitEffects = handleAfterHitEffects;
        return this;
    }

    public getHandleAfterHitEffects(): boolean {
        return this.handleAfterHitEffects;
    }

    private prepareHits(hitAmount: number, rollAccuracy: boolean): HitDamage[] {
        // Check the hit amounts.
        if (hitAmount > 4) {
            throw new Error(
                "Illegal number of hits! The maximum number of hits per turn is 4.");
        } else if (hitAmount < 0) {
            throw new Error(
                "Illegal number of hits! The minimum number of hits per turn is 0.");
        }

        if (this.attacker == null || this.target == null) {
            return null;
        }

        this.totalDamage = 0;

        // Damage is capped to the HP the target had when the blow was rolled, the
        // way LostCity does it (min(randominc(maxhit), stat(hitpoints))). This is
        // what makes tick-eating work: healing after the roll but before the hit
        // lands leaves the already-capped damage non-lethal. It also keeps XP
        // honest, since XP is awarded from this total at swing time rather than
        // from an uncapped overkill roll.
        let remaining = Math.max(0, this.target.getHitpoints());
        const capToRemaining = (damage: HitDamage): HitDamage => {
            if (damage.getDamage() > remaining) {
                damage.setDamage(remaining);
            }
            remaining -= damage.getDamage();
            return damage;
        };

        if (hitAmount === 1) {
            const roll = { attacker: this.attacker, target: this.target, combatType: this.combatType, forceAccurate: false, bypassProtectionPrayer: false };
            PluginManager.emitCombatHitRoll(roll);
            this.accurate = roll.forceAccurate || !rollAccuracy || ServerPerf.measurePhase(
                "combat.process.method_hits.roll_accuracy",
                () => AccuracyFormulasDpsCalc.rollAccuracy(
                    this.attacker,
                    this.target,
                    this.combatType
                )
            );
            const damage: HitDamage = this.accurate
                ? ServerPerf.measurePhase(
                    "combat.process.method_hits.damage",
                    () => CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, roll.bypassProtectionPrayer)
                )
                : new HitDamage(0, HitMask.BLUE);
            if (this.accurate && this.attacker.isPlayer() && this.target.isPlayer()) {
                ArceuusSpells.applyCorruption(this.attacker.getAsPlayer(), this.target.getAsPlayer());
            }
            ServerPerf.measurePhase(
                "combat.process.method_hits.extra_rolls",
                () => CombatFactory.applyExtraHitRolls(
                    this.attacker,
                    this.target,
                    this.combatType,
                    damage,
                    this.accurate,
                    this.method
                )
            );
            capToRemaining(damage);
            this.totalDamage = damage.getDamage();
            return [damage];
        }

        let hits: HitDamage[] = new Array(hitAmount);
        for (let i = 0; i < hits.length; i++) {
            const roll = { attacker: this.attacker, target: this.target, combatType: this.combatType, forceAccurate: false, bypassProtectionPrayer: false };
            PluginManager.emitCombatHitRoll(roll);
            this.accurate = roll.forceAccurate || !rollAccuracy || ServerPerf.measurePhase(
                "combat.process.method_hits.roll_accuracy",
                () => AccuracyFormulasDpsCalc.rollAccuracy(this.attacker, this.target, this.combatType)
            );
            let damage: HitDamage = this.accurate ? ServerPerf.measurePhase(
                "combat.process.method_hits.damage",
                () => CombatFactory.getHitDamage(this.attacker, this.target, this.combatType, roll.bypassProtectionPrayer)
            ) : new HitDamage(0, HitMask.BLUE);
            if (this.accurate && this.attacker.isPlayer() && this.target.isPlayer()) {
                ArceuusSpells.applyCorruption(this.attacker.getAsPlayer(), this.target.getAsPlayer());
            }
            ServerPerf.measurePhase(
                "combat.process.method_hits.extra_rolls",
                () => CombatFactory.applyExtraHitRolls(
                    this.attacker,
                    this.target,
                    this.combatType,
                    damage,
                    this.accurate,
                    this.method
                )
            );
            capToRemaining(damage);
            this.totalDamage += damage.getDamage();
            hits[i] = damage;
        }
        return hits;
    }

    public updateTotalDamage() {
        this.totalDamage = 0;
        for (let i = 0; i < this.hits.length; i++) {
            this.totalDamage += this.hits[i].getDamage();
        }
    }

    public getSkills(): number[] {
        if (this.attacker.isNpc()) {
            return new Array();
        }
        return (this.attacker as Player).getFightType().getStyle().skill(this.combatType);
    }

    public getCombatType(): CombatType {
        return this.combatType;
    }
}    
