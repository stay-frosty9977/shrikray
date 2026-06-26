# shrink_ray:reset
# Usage: /function shrink_ray:reset
# Clears jump_boost and resets camera for the executing player.
# Re-equip and use the Size Ray at normal size to fully sync the script state.
effect @s minecraft:jump_boost 1 0 true
camera @s clear
