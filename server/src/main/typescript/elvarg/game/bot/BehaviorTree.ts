import { Player } from "../entity/impl/player/Player";

export type BehaviorStatus = "success" | "failure" | "running";

export type BotContext = {
  player: Player;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  nowMs: number;
};

export interface BehaviorNode {
  tick(context: BotContext): BehaviorStatus;
}

export class SelectorNode implements BehaviorNode {
  constructor(private readonly children: BehaviorNode[]) {}

  tick(context: BotContext): BehaviorStatus {
    for (const child of this.children) {
      const result = child.tick(context);
      if (result !== "failure") {
        return result;
      }
    }
    return "failure";
  }
}

export class SequenceNode implements BehaviorNode {
  constructor(private readonly children: BehaviorNode[]) {}

  tick(context: BotContext): BehaviorStatus {
    for (const child of this.children) {
      const result = child.tick(context);
      if (result !== "success") {
        return result;
      }
    }
    return "success";
  }
}

export class ConditionNode implements BehaviorNode {
  constructor(private readonly predicate: (context: BotContext) => boolean) {}

  tick(context: BotContext): BehaviorStatus {
    return this.predicate(context) ? "success" : "failure";
  }
}

export class ActionNode implements BehaviorNode {
  constructor(private readonly action: (context: BotContext) => BehaviorStatus) {}

  tick(context: BotContext): BehaviorStatus {
    return this.action(context);
  }
}

export class CooldownNode implements BehaviorNode {
  private nextAllowedAt = 0;

  constructor(
    private readonly cooldownMs: number,
    private readonly child: BehaviorNode,
    initialDelayMs = 0
  ) {
    this.nextAllowedAt = Date.now() + Math.max(0, initialDelayMs);
  }

  tick(context: BotContext): BehaviorStatus {
    if (context.nowMs < this.nextAllowedAt) {
      return "failure";
    }

    const result = this.child.tick(context);
    if (result === "success") {
      this.nextAllowedAt = context.nowMs + this.cooldownMs;
    }
    return result;
  }
}

export class BotController {
  constructor(
    private readonly player: Player,
    private readonly spawnX: number,
    private readonly spawnY: number,
    private readonly spawnZ: number,
    private readonly root: BehaviorNode
  ) {}

  tick(nowMs: number): BehaviorStatus {
    return this.root.tick({
      player: this.player,
      spawnX: this.spawnX,
      spawnY: this.spawnY,
      spawnZ: this.spawnZ,
      nowMs,
    });
  }
}
