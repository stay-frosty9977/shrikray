import { world, system } from "@minecraft/server";

// --- Config ---
const ITEM_ID         = "shrink_ray:size_ray";
const MIN_SCALE       = 0.2;
const MAX_SCALE       = 3.0;
const NORMAL_SCALE    = 1.0;
const STEP            = 0.2;

// Scoreboard objective used by reset.mcfunction to signal a full reset.
const RESET_OBJECTIVE = "shrink_ray_reset";

const playerScales = new Map();

// --- Helpers ---
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(n) { return Math.round(n * 10) / 10; }

// --- Core: apply a scale to a player ---
function applyScale(player, scale) {
  const scaleComp = player.getComponent("minecraft:scale");
  if (!scaleComp) {
    player.sendMessage("§cError: scale component not found.");
    return;
  }
  scaleComp.value = scale;
  playerScales.set(player.name, scale);
}

// --- Full reset ---
function resetPlayer(player) {
  applyScale(player, NORMAL_SCALE);
  playerScales.delete(player.name);
  player.sendMessage("§aSize reset to normal.");
}

// --- Scoreboard reset signal ---
function ensureResetObjective() {
  try {
    world.scoreboard.addObjective(RESET_OBJECTIVE, "dummy");
  } catch {
    // Already exists.
  }
}

function startResetPoller() {
  system.runInterval(() => {
    const objective = world.scoreboard.getObjective(RESET_OBJECTIVE);
    if (!objective) return;

    for (const player of world.getAllPlayers()) {
      let score;
      try {
        score = objective.getScore(player.scoreboardIdentity);
      } catch {
        continue;
      }
      if (score === 1) {
        objective.setScore(player.scoreboardIdentity, 0);
        resetPlayer(player);
      }
    }
  }, 1);
}

system.run(() => {
  ensureResetObjective();
  startResetPoller();
});

// --- Right-click handler ---
world.beforeEvents.itemUse.subscribe((event) => {
  const { source: player, itemStack } = event;
  if (itemStack.typeId !== ITEM_ID) return;

  const isSneaking   = player.isSneaking;
  const currentScale = playerScales.get(player.name) ?? NORMAL_SCALE;
  const newScale     = round1(
    clamp(currentScale + (isSneaking ? -STEP : STEP), MIN_SCALE, MAX_SCALE)
  );

  system.run(() => {
    applyScale(player, newScale);

    if (newScale === currentScale) {
      player.sendMessage(`§eAlready at ${isSneaking ? "minimum" : "maximum"} size!`);
    } else {
      const dir = isSneaking ? "§bShrinking" : "§6Growing";
      player.sendMessage(`${dir}§r  ${buildBar(newScale)}  §f${Math.round(newScale * 100)}%`);
    }
  });
});

// --- Visual feedback bar ---
function buildBar(scale) {
  const total  = 10;
  const filled = Math.round(((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * total);
  return "§a" + "█".repeat(filled) + "§8" + "█".repeat(total - filled);
}

// --- Restore scale on respawn ---
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) {
    const saved = playerScales.get(player.name);
    if (saved !== undefined && saved !== NORMAL_SCALE) {
      system.run(() => {
        applyScale(player, saved);
        player.sendMessage(`§7Your size (§f${Math.round(saved * 100)}%§7) was restored.`);
      });
    }
  }
});

// --- Cleanup on leave ---
world.afterEvents.playerLeave.subscribe(({ playerName }) => {
  playerScales.delete(playerName);
});
