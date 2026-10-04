import assert from "node:assert/strict";

import type { OverlayCommandExecutor } from "../render/frame/OverlayCommandExecutor";
import type { OverlayDrawCommand } from "../render/frame/OverlayDrawCommand";
import { OverlayManager } from "../ui/devoverlay/OverlayManager";
import {
    type Overlay,
    type OverlayInitArgs,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../ui/devoverlay/Overlay";

type Seen = {
    index: number;
    phase: RenderPhase;
    clipped: boolean;
    rect: [number, number, number, number];
    overlayName: string;
};

const seen: Seen[] = [];

class FakeExecutor implements OverlayCommandExecutor {
    execute(command: OverlayDrawCommand, overlay: Overlay): void {
        seen.push({
            index: command.overlayIndex,
            phase: command.phase,
            clipped: command.clipEnabled,
            rect: [
                command.clipRect.x,
                command.clipRect.y,
                command.clipRect.width,
                command.clipRect.height,
            ],
            overlayName: overlay.constructor.name,
        });
        overlay.draw(command.phase);
    }
}

class FirstOverlay implements Overlay {
    draws: RenderPhase[] = [];
    init(_args: OverlayInitArgs): void {}
    update(_args: OverlayUpdateArgs): void {}
    draw(phase: RenderPhase): void {
        this.draws.push(phase);
    }
    dispose(): void {}
}

class SecondOverlay extends FirstOverlay {}

const first = new FirstOverlay();
const second = new SecondOverlay();
const manager = new OverlayManager(new FakeExecutor());
manager.add(first);
manager.add(second, false);

manager.draw(RenderPhase.PostPresent, { x: 11, y: 22, width: 333, height: 444 });

assert.deepEqual(
    seen.map((entry) => entry.overlayName),
    ["FirstOverlay", "SecondOverlay"],
    "overlay registration order must remain draw order",
);
assert.deepEqual(seen[0], {
    index: 0,
    phase: RenderPhase.PostPresent,
    clipped: true,
    rect: [11, 22, 333, 444],
    overlayName: "FirstOverlay",
});
assert.equal(seen[1].index, 1);
assert.equal(seen[1].clipped, false);
assert.deepEqual(first.draws, [RenderPhase.PostPresent]);
assert.deepEqual(second.draws, [RenderPhase.PostPresent]);

seen.length = 0;
manager.draw(RenderPhase.ToSceneFramebuffer);
assert.equal(seen[0].clipped, false, "no viewport means no clipping command");
assert.equal(seen[0].phase, RenderPhase.ToSceneFramebuffer);

console.log("overlay command scheduling checks passed");
