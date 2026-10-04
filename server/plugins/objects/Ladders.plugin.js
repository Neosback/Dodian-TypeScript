const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");

const CLIMB_UP = new Animation(828);
const CLIMB_DOWN = new Animation(827);
// Cache animations last 1260ms up and 1160ms down, rounded up to 600ms ticks.
const CLIMB_UP_TICKS = 3;
const CLIMB_DOWN_TICKS = 2;
let TaskManager;

function climb({ player, destination }, animation, ticks) {
  const start = player.getLocation().clone();
  const target = destination.clone();
  player.performAnimation(animation);
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      if (player.getLocation().equals(start)) player.moveTo(target);
      this.stop();
    }
  })());
}

function climbUp(event) {
  climb(event, CLIMB_UP, CLIMB_UP_TICKS);
}

function climbDown(event) {
  climb(event, CLIMB_DOWN, CLIMB_DOWN_TICKS);
}

module.exports = {
  name: "Ladders",
  register(api) {
    TaskManager = api.getTaskManager();
    api.onCustomEvent("ladders:climbUp", climbUp);
    api.onCustomEvent("ladders:climbDown", climbDown);
  },
};
