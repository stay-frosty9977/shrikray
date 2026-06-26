import { world, system } from "@minecraft/server";

// --- Config ---
const ITEM_ID         = "shrink_ray:size_ray";
const MIN_SCALE       = 0.2;
const MAX_SCALE       = 3.0;
const NORMAL_SCALE    = 1.0;
const STEP            = 0.2;

const PLAYER_EYE_HEIGHT  = 1.62;
const BASE_CAMERA_RADIUS = 3;

// Scoreboard objective used by reset.mcfunction to signal a full reset.
// The function sets the player's score to 1; the script polls and acts on it.
const RESET_OBJECTIVE = "shrink_ray_reset";

const playerScales = new Map();

// --- Helpers ---
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(n) { return Math.round(n * 10) / 10; }

// --- Camera fix ---
// minecraft:scale only changes the rendered model; the camera anchor stays at
// full eye-height.  We correct this by switching to follow_orbit and setting
// entityOffset.y = eye-height * scale so the orbit pivot sits at the player's
// actual (scaled) eye level.
function applyCameraFix(player, scale) {
  if (scale === NORMAL_SCALE) {
    player.camera.clear();
    return;
  }
  player.camera.setCamera("minecraft:follow_orbit", {
    entityOffset: { x: 0, y: PLAYER_EYE_HEIGHT * scale, z: 0 },
    radius: BASE_CAMERA_RADIUS * Math.max(scale, 0.4),
  });
}

// --- Jump fix ---
// minecraft:scale shrinks the collision box, so the step-height also shrinks
// and the player can no longer clear a 1-block step unaided.
// We compensate with jump_boost: amplifier = ceil(1/scale) - 1.
// Movement speed is intentionally left at the vanilla default — touching
// minecraft:movement via script breaks jump entirely for players.
function applyPhysicsFix(player, scale) {
  player.removeEffect("minecraft:jump_boost");

  if (scale < NORMAL_SCALE) {
    const amplifier = clamp(Math.ceil(1 / scale) - 1, 0, 10);
    player.addEffect("minecraft:jump_boost", 20 * 60 * 120, {
      amplifier,
      showParticles: false,
    });
  }
}

// --- Core: apply a scale to a player ---
function applyScale(player, scale) {
  const scaleComp = player.getComponent("minecraft:scale");
  if (!scaleComp) {
    player.sendMessage("§cError: scale component not found.");
    return;
  }
  scaleComp.value = scale;
  playerScales.set(player.name, scale);
  applyCameraFix(player, scale);
  applyPhysicsFix(player, scale);
}

// --- Full reset (scale + camera + effects + internal state) ---
function resetPlayer(player) {
  applyScale(player, NORMAL_SCALE);
  playerScales.delete(player.name);
  player.sendMessage("§aSize reset to normal.");
}

// --- Scoreboard reset signal setup ---
// Creates the objective if it doesn't already exist so reset.mcfunction can
// use it immediately after the pack is first loaded.
function ensureResetObjective() {
  try {
    world.scoreboard.addObjective(RESET_OBJECTIVE, "dummy");
  } catch {
    // Objective already exists — that's fine.
  }
}

// Poll every tick for any player whose reset score was set to 1 by the
// mcfunction, then clear the score and perform a full reset.
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
        // Clear flag first so we don't loop
        objective.setScore(player.scoreboardIdentity, 0);
        resetPlayer(player);
      }
    }
  }, 1);
}

// --- Initialise scoreboard and poller once the world is ready ---
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
