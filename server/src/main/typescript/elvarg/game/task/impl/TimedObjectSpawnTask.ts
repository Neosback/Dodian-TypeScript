import { GameObject } from "../../entity/impl/object/GameObject";
import { ObjectManager } from "../../entity/impl/object/ObjectManager";
import { Action } from '../../model/Action';
import { Task } from "../Task";
export class TimedObjectSpawnTask extends Task {
    private temp: GameObject;
    private ticks: number;
    private action: Action;
    private progressTick = 0;

    constructor(temp: GameObject, ticks: number, action: Action) {
        super();
        this.temp = temp;
        this.action = action;
        this.ticks = ticks;
    }

    execute() {
        if (this.progressTick === 0) {
            ObjectManager.register(this.temp, true);
        } else if (this.progressTick >= this.ticks) {
            ObjectManager.deregister(this.temp, true);

            if (this.action != null) {
                this.action.execute();
            }

            this.stop();
        }
        this.progressTick++;
    }

    onExecute() {

    }
}
