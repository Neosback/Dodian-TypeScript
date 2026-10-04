import { Task } from "../Task";
import { Location } from "../../model/Location";
import { ForceMovement } from "../../model/ForceMovement";
import { Player } from "../../entity/impl/player/Player";
import { TaskType } from "../TaskType";

export class ForceMovementTask extends Task {
    private player: Player;
    private end: Location;
    private start: Location;
    private forceMovement: ForceMovement;

    constructor(player: Player, delay: number, forceM: ForceMovement) {
        super(delay, player as any);
        this.player = player;
        this.start = (forceM.getStart() as any).clone();
        this.end = (forceM.getEnd() as any).clone();
        this.forceMovement = forceM;
    
        player.getCombat().reset();
        player.getMovementQueue().reset();
        player.setForceMovement(forceM);
    }

    public execute() {
        if (this.player.getForceMovement() !== this.forceMovement) {
            this.stop();
            return;
        }
        let x = this.start.getX() + this.end.getX();
        let y = this.start.getY() + this.end.getY();
        // Use moveTo() so completion emits placement/reset semantics that match
        // vanilla protocol expectations for both self and observers.
        // Direct setLocation() caused client/server position drift after ditch crosses.
        this.player.moveTo(
            new (Location as any)(x, y, (this.player.getLocation() as any).getZ())
        );
        this.player.setForceMovement(null);
        this.stop();
    }

    public stop() {
        // If this task is canceled before execute(), clear only the force movement
        // instance that this task owns so we don't leave stale force movement state.
        if (this.player.getForceMovement() === this.forceMovement) {
            this.player.setForceMovement(null);
        }
        super.stop();
    }
}
