const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const BURY_ANIMATION = new Animation(827);
const BURY_DELAY_MS = 1000;

const BONES = new Map([
  [ItemIds.BONES, 5],
  [ItemIds.BAT_BONES, 6],
  [ItemIds.WOLF_BONES, 6],
  [ItemIds.BIG_BONES, 15],
  [ItemIds.BABYDRAGON_BONES, 30],
  [ItemIds.JOGRE_BONES, 15],
  [ItemIds.ZOGRE_BONES, 23],
  [ItemIds.LONG_BONE, 15],
  [ItemIds.CURVED_BONE, 15],
  [ItemIds.SHAIKAHAN_BONES, 25],
  [ItemIds.DRAGON_BONES, 72],
  [ItemIds.FAYRG_BONES, 84],
  [ItemIds.RAURG_BONES, 96],
  [ItemIds.OURG_BONES, 140],
  [ItemIds.DAGANNOTH_BONES, 125],
  [ItemIds.WYVERN_BONES_2, 72],
  [ItemIds.LAVA_DRAGON_BONES, 85],
]);

module.exports = {
  name: "Prayer",
  register(api) {
    api.onItemFirstAction((event) => {
      const { player, itemId, slot } = event;
      const xp = BONES.get(itemId);
      if (!xp) {
        return false;
      }

      if (!player.getClickDelay().elapsedTime(BURY_DELAY_MS)) {
        return true;
      }

      player.getSkillManager().stopSkillable();
      player.getPacketSender().sendInterfaceRemoval();
      player.performAnimation(BURY_ANIMATION);
      Sounds.sendSound(player, Sound.BURY_BONES);
      player.sendMessage("You dig a hole in the ground..");
      player.getInventory().deleteAtSlot(slot, 1);
      setTimeout(() => {
        const name = ItemDefinition.forId(itemId).getName();
        player.sendMessage(`..and bury the ${name}.`);
        player.getSkillManager().addExperiences(Skill.PRAYER, xp);
      }, BURY_DELAY_MS);
      player.getClickDelay().reset();
      return true;
    });

    api.log("registered", { buryableBones: BONES.size });
  },
};
