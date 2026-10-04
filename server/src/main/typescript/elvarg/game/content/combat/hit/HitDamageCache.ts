import { Stopwatch } from "../../../../util/Stopwatch";

export class HitDamageCache {
    private stopwatch: Stopwatch;
    private damage: number;

    constructor(damage: number) {
        this.damage = damage;
        this.stopwatch = new Stopwatch().reset();
    }

    public getDamage(): number {
        return this.damage;
    }

    public incrementDamage(damage: number): void {
        this.damage += damage;
        this.stopwatch.reset();
    }

    public getStopwatch(): number {
        return this.stopwatch.elapsed();
    }
}
