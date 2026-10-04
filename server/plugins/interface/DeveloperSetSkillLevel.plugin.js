const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { CombatFactory } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const Presets = require("../modes/pvp/Presets");

const MIN_LEVEL = 1;
const MAX_LEVEL = 99;
const DENIAL_MESSAGE_COOLDOWN_MS = 1000;
const denialMessageUntil = new WeakMap();
const SKILLS_TAB_GROUP_ID = 320;
const SKILLS_TAB_COMBAT_SKILLS = new Map([
  [1, Skill.ATTACK],
  [2, Skill.STRENGTH],
  [3, Skill.DEFENCE],
  [4, Skill.RANGED],
  [5, Skill.PRAYER],
  [6, Skill.MAGIC],
  [9, Skill.HITPOINTS],
]);

function isDeveloper(player) {
  return player?.getRights?.()?.getId?.() === 4;
}

function minimumLevel(skill) {
  return skill === Skill.HITPOINTS ? 10 : MIN_LEVEL;
}

function isValidLevel(skill, value) {
  return Number.isInteger(value) && value >= minimumLevel(skill) && value <= MAX_LEVEL;
}

function deny(player, message) {
  const now = Date.now();
  if (now >= (denialMessageUntil.get(player) ?? 0)) {
    player.sendMessage(message);
    denialMessageUntil.set(player, now + DENIAL_MESSAGE_COOLDOWN_MS);
  }
  return false;
}

function canSetPresetStats(player, skill) {
  if (!skill.canSetLevel()) {
    return deny(player, "You can only set combat stats.");
  }
  const hasGear = player
    .getEquipment()
    .getItems()
    .some((item) => item?.getId?.() > 0 && item?.getAmount?.() > 0);
  if (hasGear) {
    return deny(player, "You must remove all of your gear to set stats.");
  }
  if (Wilderness.isIn(player)) {
    return deny(player, "You cannot set stats in the Wilderness.");
  }
  if (CombatFactory.inCombat(player)) {
    return deny(player, "You cannot set stats while in combat.");
  }
  if (player.busy()) {
    return deny(player, "You cannot set stats while busy.");
  }
  return true;
}

function promptForLevel(player, skill, publicPresetSetting) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({
    execute: (amount) => {
      const level = Number(amount);
      if (!isValidLevel(skill, level)) {
        player.sendMessage(
          `Invalid level. Please enter a level from ${minimumLevel(skill)} to ${MAX_LEVEL}.`
        );
        return;
      }
      if (publicPresetSetting && !canSetPresetStats(player, skill)) {
        return;
      }
      player.getSkillManager().setLevel(skill, level);
    },
  });
  player
    .getPacketSender()
    .sendEnterAmountPrompt(
      publicPresetSetting
        ? `Set ${skill.getName()} Level (${minimumLevel(skill)}-${MAX_LEVEL})`
        : `Enter desired level (${minimumLevel(skill)}-${MAX_LEVEL}).`
    );
  return true;
}

function handleSkillClick(player, buttonId, groupId, childId) {
  const skill =
    Number(groupId) === SKILLS_TAB_GROUP_ID
      ? SKILLS_TAB_COMBAT_SKILLS.get(Number(childId))
      : Skill.forButton(Number(buttonId));
  if (!skill) {
    return false;
  }

  const numericButtonId = Number(buttonId);
  if (!Number.isInteger(numericButtonId)) {
    return false;
  }

  if (isDeveloper(player)) {
    return promptForLevel(player, skill, false);
  }

  if (!Presets.isEnabled()) {
    player.getPacketSender().sendMessage("Setting skill levels requires enabled presets.");
    return true;
  }
  return canSetPresetStats(player, skill) && promptForLevel(player, skill, true);
}

module.exports = {
  name: "DeveloperSetSkillLevel",
  register(api) {
    api.onButtonClick((event) => {
      if (handleSkillClick(event.player, event.buttonId)) {
        event.handled = true;
      }
    });

    api.onInterfaceActionClick((event) => {
      if (handleSkillClick(event.player, event.buttonId, event.groupId, event.childId)) {
        event.handled = true;
      }
    });
  },
};
