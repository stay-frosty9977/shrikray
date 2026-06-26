import { world, system } from "@minecraft/server";

// --- Config ---
const ITEM_ID         = "shrink_ray:size_ray";
const MIN_SCALE       = 0.2;
const MAX_SCALE       = 3.0;
const NORMAL_SCALE    = 1.0;
const STEP            = 0.2;

// Player eye height at scale 1.0 (Bedrock default)
const PLAYER_EYE_HEIGHT    = 1.62;
// Default walk speed at scale 1.0
const BASE_MOVE_SPEED      = 0.1;
// Camera follow distance at scale 1.0 (only used in follow_orbit mode)
const BASE_CAMERA_RADIUS   = 3;

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
    // Return to default camera when back to normal size
    player.camera.clear();
    return;
  }

  const eyeOffset = PLAYER_EYE_HEIGHT * scale;

  player.camera.setCamera("minecraft:follow_orbit", {
    entityOffset: { x: 0, y: eyeOffset, z: 0 },
    radius: BASE_CAMERA_RADIUS * Math.max(scale, 0.4),
  });
}

// --- Movement / jump fix ---
// When scaled down the collision box shrinks too, so the default step-height
// becomes a fraction of a block and the player can no longer climb normal
// blocks.  We compensate by:
//   • adjusting walk speed proportionally (tiny players walk slowly; giants fast)
//   • applying jump_boost when small so 1-block heights remain jumpable
//   • clearing the effect when back to normal / large
function applyPhysicsFix(player, scale) {
  // Adjust walk speed
  const moveComp = player.getComponent("minecraft:movement");
  if (moveComp) {
    moveComp.value = BASE_MOVE_SPEED * scale;
  }

  // Remove any previous compensating effects first
  player.removeEffect("minecraft:jump_boost");

  if (scale < NORMAL_SCALE) {
    // At scale s the player's physical height is ~1.8*s blocks.
    // To jump a 1-block step the player needs proportionally more air-time.
    // jump_boost amplifier n adds n extra blocks to jump height.
    // We want to be able to clear a 1-block step from scale 0.2 upward.
    // Formula: amplifier = ceil(1/scale) - 1  (clamped to reasonable range)
    const amplifier = clamp(Math.ceil(1 / scale) - 1, 0, 10);
    // Apply for a very long duration (refreshed on every scale change)
    player.addEffect("minecraft:jump_boost", 20 * 60 * 120, {
      amplifier,
      showParticles: false,
    });
  }
  // No special effect needed when at or above NORMAL_SCALE; vanilla jump
  // height is fine and the player's larger model already benefits from
  // the larger hitbox.
}

// --- Core: apply a new scale ---
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

// --- Restore on respawn ---
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
