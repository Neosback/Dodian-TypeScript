const { resolveBotNodeContext } = require("../context/BotNodeContext");

class BotReadyConditionNode {
  constructor(botStatesByName, options = {}) {
    this.botStatesByName = botStatesByName;
    this.requiredMode = options.requiredMode ?? null;
    this.requireNotBusy = options.requireNotBusy ?? true;
    this.requireNotInCombat = options.requireNotInCombat ?? true;
    this.requireNoTraversalTransition =
      options.requireNoTraversalTransition ?? true;
  }

  tick(context) {
    return resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.requiredMode,
      requireNotBusy: this.requireNotBusy,
      requireNotInCombat: this.requireNotInCombat,
      requireNoTraversalTransition: this.requireNoTraversalTransition,
    })
      ? "success"
      : "failure";
  }
}

module.exports = {
  BotReadyConditionNode,
};
