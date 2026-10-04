const VENGEANCE_TIME_LIMIT_VARBIT = 2451;

const cooldownStates = new WeakMap();

function syncCooldown(player, force = false) {
  const timer = player.getVengeanceTimer?.();
  const active = Math.max(0, Number(timer?.secondsRemaining?.() ?? 0)) > 0;

  if (!force && cooldownStates.get(player) === active) {
    return;
  }

  cooldownStates.set(player, active);
  player.getPacketSender().sendVarbit(VENGEANCE_TIME_LIMIT_VARBIT, active ? 1 : 0);
}

module.exports = {
  name: "Vengeance Timer",
  register(api) {
    api.onPlayerLogin(({ player }) => syncCooldown(player, true));
    api.onPlayerProcess(({ player }) => syncCooldown(player));
    api.onPlayerLogout(({ player }) => cooldownStates.delete(player));
  },
};
