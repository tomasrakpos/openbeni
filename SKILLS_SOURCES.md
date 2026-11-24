# Skills Sources & Attribution

Last updated: **2026-11-20**

All external skills in `/skills/<skill-name>/` are imported **unmodified** from their upstream repositories after verifying each repository's README, real file tree, and license.
Non-commercial or non-redistributable skills, executable browser/host tools without an approved sandbox, and built-in third-party routers are excluded.

## Priority Order & Known Conflicts (`website`)

1. **`taste-skill` (Priority 1, Core)** and **`impeccable` (Priority 2, Core)** always take precedence.
2. Selective add-ons (`anthropic-frontend-design`, `frontend-ui-standards`, `antigravity-*`, `emil-*`, `react-fe-*`, `designer-*`, `animated-landing-workflow`, `awesome-design-systems`, `threejs-*`, `img2threejs`, `awesome-design-md`) load only when relevant and within the per-request token budget.
3. **Observed overlapping / potentially conflicting directives**:
   - *Aesthetic restraint vs. bold visual direction*: `taste-skill` and `anthropic-frontend-design` encourage distinctive, high-craft art direction, while `frontend-ui-standards`, `antigravity-design-system`, and `react-fe-shadcn` enforce strict tokenized/component conventions. Resolution: `taste-skill` + `impeccable` lead overall direction; component/system standards apply to token discipline and accessibility.
   - *Animation intensity*: `emil-animate` / `antigravity-ui-motion` / `animated-landing-workflow` encourage rich motion choreography, whereas `emil-remove-animations` and `impeccable` caution against gratuitous motion. Resolution: motion skills only load when the user asks for motion/animation/landing craft, always respecting `prefers-reduced-motion`.
   - *Tooling / CLI commands referenced inside upstream SKILL.md*: `impeccable`, `taste-skill`, and `img2threejs` text files mention optional local CLI scripts (`impeccable shot`, `taste-skill/scripts/*`, `img2threejs/forge/*`). Resolution: only their markdown skill content is imported; executable host scripts are excluded and never executed.
   - *Three.js overlap*: Both `CloudAI-X/threejs-skills` (`threejs-*`) and `awesome-gamedev-agent-skills` (`gamedev-threejs-*`) plus `Hack23/game` (`react-threejs-game`) provide Three.js guidance. Resolution: namespaced cleanly without collisions and selected based on `website` vs `game` and React Three Fiber (`@react-three/fiber`) vs vanilla Three.js.

## Imported Skills

Total skills in `/skills`: **149** (66 website, 81 game, 1 chat, 1 deep_thinking).

| Skill Name | Category | Engine / Group | Priority | License | Refs | Date Imported | Source URL |
| --- | --- | --- | ---: | --- | ---: | --- | --- |
| `natural-chat` | `chat` | `core` | 1 | MIT (authored for OpenBeni) | 0 | 2026-11-20 | local://skills/natural-chat/SKILL.md |
| `deep-thinking` | `deep_thinking` | `core` | 1 | MIT (authored for OpenBeni) | 0 | 2026-11-20 | local://skills/deep-thinking/SKILL.md |
| `game-engine` | `game` | `web` | 5 | MIT | 9 | 2026-11-20 | https://github.com/github/awesome-copilot/tree/main/skills/game-engine |
| `react-threejs-game` | `game` | `threejs` | 6 | MIT (declared in SKILL.md frontmatter) | 0 | 2026-11-20 | https://github.com/Hack23/game/tree/main/.github/skills/react-threejs-game |
| `ai-behavior-trees-utility-ai` | `game` | `general` | 10 | Apache-2.0 | 4 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/ai-behavior-trees-utility-ai |
| `audio-design` | `game` | `general` | 11 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/audio-design |
| `camera-systems` | `game` | `general` | 12 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/camera-systems |
| `create-game-assets` | `game` | `general` | 13 | Apache-2.0 | 4 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/create-game-assets |
| `dialogue-systems` | `game` | `general` | 14 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/dialogue-systems |
| `game-ai` | `game` | `general` | 15 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/game-ai |
| `game-feel` | `game` | `general` | 16 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/game-feel |
| `game-ui-ux` | `game` | `general` | 17 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/game-ui-ux |
| `input-systems` | `game` | `general` | 18 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/input-systems |
| `level-design` | `game` | `general` | 19 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/level-design |
| `performance-optimization` | `game` | `general` | 20 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/performance-optimization |
| `physics-tuning` | `game` | `general` | 21 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/physics-tuning |
| `procedural-gen` | `game` | `general` | 22 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/procedural-gen |
| `save-systems` | `game` | `general` | 23 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/save-systems |
| `shader-programming` | `game` | `general` | 24 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/shader-programming |
| `ebitengine-game` | `game` | `ebitengine` | 25 | Apache-2.0 | 15 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/ebitengine/ebitengine-game |
| `card-game` | `game` | `general` | 26 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/card-game |
| `fps-shooter` | `game` | `general` | 27 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/fps-shooter |
| `platformer` | `game` | `general` | 28 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/platformer |
| `puzzle` | `game` | `general` | 29 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/puzzle |
| `roguelike` | `game` | `general` | 30 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/roguelike |
| `rpg` | `game` | `general` | 31 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/rpg |
| `survival-crafting` | `game` | `general` | 32 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/survival-crafting |
| `tower-defense` | `game` | `general` | 33 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/tower-defense |
| `visual-novel` | `game` | `general` | 34 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/genres/visual-novel |
| `godot-2d-movement` | `game` | `godot` | 35 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-2d-movement |
| `godot-3d-essentials` | `game` | `godot` | 36 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-3d-essentials |
| `godot-animation` | `game` | `godot` | 37 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-animation |
| `godot-audio` | `game` | `godot` | 38 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-audio |
| `godot-csharp` | `game` | `godot` | 39 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-csharp |
| `godot-export` | `game` | `godot` | 40 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-export |
| `godot-gdscript` | `game` | `godot` | 41 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-gdscript |
| `godot-gdscript-headless-testing` | `game` | `godot` | 42 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-gdscript-headless-testing |
| `godot-multiplayer` | `game` | `godot` | 43 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-multiplayer |
| `godot-nodes-scenes` | `game` | `godot` | 44 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-nodes-scenes |
| `godot-physics` | `game` | `godot` | 45 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-physics |
| `godot-resources` | `game` | `godot` | 46 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-resources |
| `godot-shaders` | `game` | `godot` | 47 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-shaders |
| `godot-signals-groups` | `game` | `godot` | 48 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-signals-groups |
| `godot-tilemap` | `game` | `godot` | 49 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-tilemap |
| `godot-ui-control` | `game` | `godot` | 50 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-ui-control |
| `bevy-ecs` | `game` | `bevy` | 51 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/bevy-ecs |
| `defold-core` | `game` | `defold` | 52 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/defold-core |
| `love2d-core` | `game` | `love2d` | 53 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/love2d-core |
| `pygame-core` | `game` | `pygame` | 54 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/pygame-core |
| `roblox-characters` | `game` | `roblox` | 55 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-characters |
| `roblox-datastores` | `game` | `roblox` | 56 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-datastores |
| `roblox-luau` | `game` | `roblox` | 57 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-luau |
| `roblox-networking` | `game` | `roblox` | 58 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-networking |
| `roblox-physics` | `game` | `roblox` | 59 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-physics |
| `roblox-simulator-economy` | `game` | `roblox` | 60 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-simulator-economy |
| `roblox-studio-workflow` | `game` | `roblox` | 61 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-studio-workflow |
| `roblox-ui` | `game` | `roblox` | 62 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/other-engines/roblox-ui |
| `unity-animation` | `game` | `unity` | 63 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-animation |
| `unity-build-pipeline` | `game` | `unity` | 64 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-build-pipeline |
| `unity-build-size` | `game` | `unity` | 65 | Apache-2.0 | 5 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-build-size |
| `unity-csharp-scripting` | `game` | `unity` | 66 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-csharp-scripting |
| `unity-input-system` | `game` | `unity` | 67 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-input-system |
| `unity-navmesh` | `game` | `unity` | 68 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-navmesh |
| `unity-physics` | `game` | `unity` | 69 | Apache-2.0 | 2 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-physics |
| `unity-scriptableobjects` | `game` | `unity` | 70 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-scriptableobjects |
| `unity-tilemap-2d` | `game` | `unity` | 71 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unity/unity-tilemap-2d |
| `unreal-behavior-trees` | `game` | `unreal` | 72 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unreal/unreal-behavior-trees |
| `unreal-blueprints` | `game` | `unreal` | 73 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unreal/unreal-blueprints |
| `unreal-cpp-gameplay` | `game` | `unreal` | 74 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unreal/unreal-cpp-gameplay |
| `unreal-enhanced-input` | `game` | `unreal` | 75 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unreal/unreal-enhanced-input |
| `unreal-niagara` | `game` | `unreal` | 76 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unreal/unreal-niagara |
| `unreal-packaging` | `game` | `unreal` | 77 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/unreal/unreal-packaging |
| `phaser-arcade-physics` | `game` | `phaser` | 78 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/web-engines/phaser-arcade-physics |
| `phaser-core` | `game` | `phaser` | 79 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/web-engines/phaser-core |
| `pixijs-rendering` | `game` | `pixijs` | 80 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/web-engines/pixijs-rendering |
| `gamedev-threejs-gltf-loading` | `game` | `threejs` | 81 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/web-engines/threejs-gltf-loading |
| `gamedev-threejs-materials-lighting` | `game` | `threejs` | 82 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/web-engines/threejs-materials-lighting |
| `gamedev-threejs-scene-setup` | `game` | `threejs` | 83 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/web-engines/threejs-scene-setup |
| `game-docs` | `game` | `general` | 84 | Apache-2.0 | 5 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/workflows/game-docs |
| `game-jam` | `game` | `general` | 85 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/workflows/game-jam |
| `itch-publish` | `game` | `general` | 86 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/workflows/itch-publish |
| `prototype-fast` | `game` | `general` | 87 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/workflows/prototype-fast |
| `steam-publish` | `game` | `general` | 88 | Apache-2.0 | 1 | 2026-11-20 | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/workflows/steam-publish |
| `taste-skill` | `website` | `core` | 1 | MIT | 22 | 2026-11-20 | https://github.com/leonxlnx/taste-skill |
| `impeccable` | `website` | `core` | 2 | Apache-2.0 | 50 | 2026-11-20 | https://github.com/pbakaus/impeccable |
| `anthropic-frontend-design` | `website` | `—` | 10 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/anthropics/skills/tree/main/skills/frontend-design |
| `frontend-ui-standards` | `website` | `—` | 12 | MIT | 0 | 2026-11-20 | https://github.com/MaxHan7/frontend-ui-standards-skill |
| `antigravity-frontend-ui-engineering` | `website` | `—` | 13 | MIT (upstream) / CC-BY-4.0 (catalog docs) | 0 | 2026-11-20 | https://github.com/sickn33/antigravity-awesome-skills/tree/main/skills/frontend-ui-engineering |
| `antigravity-design-system` | `website` | `—` | 14 | MIT (upstream) / CC-BY-4.0 (catalog docs) | 1 | 2026-11-20 | https://github.com/sickn33/antigravity-awesome-skills/tree/main/skills/design-system |
| `antigravity-ui-motion` | `website` | `—` | 15 | MIT (upstream) / CC-BY-4.0 (catalog docs) | 0 | 2026-11-20 | https://github.com/sickn33/antigravity-awesome-skills/tree/main/skills/ui-motion |
| `animated-landing-workflow` | `website` | `—` | 16 | MIT | 3 | 2026-11-20 | https://github.com/pato-gonzalez/design-system-stack/tree/main/skills/animated-landing-workflow |
| `awesome-design-systems` | `website` | `—` | 17 | MIT | 5 | 2026-11-20 | https://github.com/pato-gonzalez/design-system-stack/tree/main/skills/awesome-design-systems |
| `emil-design-eng` | `website` | `—` | 18 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng |
| `emil-animate` | `website` | `—` | 19 | MIT | 1 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/animate |
| `emil-animation-performance` | `website` | `—` | 20 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/animation-performance |
| `emil-animation-vocabulary` | `website` | `—` | 21 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/animation-vocabulary |
| `emil-choreograph` | `website` | `—` | 22 | MIT | 1 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/choreograph |
| `emil-gestures` | `website` | `—` | 23 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/gestures |
| `emil-improve-animations` | `website` | `—` | 24 | MIT | 2 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/improve-animations |
| `emil-learn-taste` | `website` | `—` | 25 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/learn-taste |
| `emil-apple-design` | `website` | `—` | 26 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/apple-design |
| `emil-break-ui` | `website` | `—` | 27 | MIT | 1 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/break-ui |
| `emil-pick-ui-library` | `website` | `—` | 28 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/pick-ui-library |
| `emil-prototype` | `website` | `—` | 29 | MIT | 1 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/prototype |
| `emil-review-animations` | `website` | `—` | 30 | MIT | 1 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/review-animations |
| `emil-remove-animations` | `website` | `—` | 31 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/remove-animations |
| `emil-find-animation-opportunities` | `website` | `—` | 32 | MIT | 0 | 2026-11-20 | https://github.com/emilkowalski/skills/tree/main/skills/find-animation-opportunities |
| `react-fe-react` | `website` | `—` | 35 | MIT | 45 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/react |
| `react-fe-tailwind` | `website` | `—` | 36 | MIT | 42 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/tailwind |
| `react-fe-shadcn` | `website` | `—` | 37 | MIT | 44 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/shadcn |
| `react-fe-ui-design` | `website` | `—` | 38 | MIT | 42 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/ui-design |
| `react-fe-web-design-guidelines` | `website` | `—` | 39 | MIT | 0 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/web-design-guidelines |
| `react-fe-nextjs` | `website` | `—` | 40 | MIT | 44 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/nextjs |
| `react-fe-typescript` | `website` | `—` | 41 | MIT | 44 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/typescript |
| `react-fe-vercel-react-best-practices` | `website` | `—` | 42 | MIT | 0 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/vercel-react-best-practices |
| `react-fe-vercel-composition-patterns` | `website` | `—` | 43 | MIT | 0 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/vercel-composition-patterns |
| `react-fe-react-hook-form` | `website` | `—` | 44 | MIT | 45 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/react-hook-form |
| `react-fe-tanstack-query` | `website` | `—` | 45 | MIT | 41 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/tanstack-query |
| `react-fe-feature-arch` | `website` | `—` | 46 | MIT | 42 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/feature-arch |
| `react-fe-zod` | `website` | `—` | 47 | MIT | 46 | 2026-11-20 | https://github.com/Pythoughts-labs/react-frontend-skills/tree/main/skills/zod |
| `designer-accessibility-audit` | `website` | `—` | 50 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/design-systems/skills/accessibility-audit |
| `designer-component-spec` | `website` | `—` | 51 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/design-systems/skills/component-spec |
| `designer-design-token` | `website` | `—` | 52 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/design-systems/skills/design-token |
| `designer-theming-system` | `website` | `—` | 53 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/design-systems/skills/theming-system |
| `designer-pattern-library` | `website` | `—` | 54 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/design-systems/skills/pattern-library |
| `designer-motion-system` | `website` | `—` | 55 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/design-systems/skills/motion-system |
| `designer-form-design` | `website` | `—` | 56 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/interaction-design/skills/form-design |
| `designer-navigation-patterns` | `website` | `—` | 57 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/interaction-design/skills/navigation-patterns |
| `designer-loading-states` | `website` | `—` | 58 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/interaction-design/skills/loading-states |
| `designer-feedback-patterns` | `website` | `—` | 59 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/interaction-design/skills/feedback-patterns |
| `designer-micro-interaction-spec` | `website` | `—` | 60 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/interaction-design/skills/micro-interaction-spec |
| `designer-interfaces-that-feel` | `website` | `—` | 61 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/interaction-design/skills/interfaces-that-feel |
| `designer-heuristic-evaluation` | `website` | `—` | 62 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/prototyping-testing/skills/heuristic-evaluation |
| `designer-ux-writing` | `website` | `—` | 63 | MIT | 0 | 2026-11-20 | https://github.com/Owl-Listener/designer-skills/tree/main/designer-toolkit/skills/ux-writing |
| `threejs-fundamentals` | `website` | `threejs` | 70 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-fundamentals |
| `threejs-geometry` | `website` | `threejs` | 71 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-geometry |
| `threejs-materials` | `website` | `threejs` | 72 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-materials |
| `threejs-lighting` | `website` | `threejs` | 73 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-lighting |
| `threejs-shaders` | `website` | `threejs` | 74 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-shaders |
| `threejs-textures` | `website` | `threejs` | 75 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-textures |
| `threejs-animation` | `website` | `threejs` | 76 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-animation |
| `threejs-interaction` | `website` | `threejs` | 77 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-interaction |
| `threejs-loaders` | `website` | `threejs` | 78 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-loaders |
| `threejs-postprocessing` | `website` | `threejs` | 79 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-postprocessing |
| `threejs-performance` | `website` | `threejs` | 80 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-performance |
| `threejs-asset-pipeline` | `website` | `threejs` | 81 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-asset-pipeline |
| `threejs-react-three-fiber` | `website` | `threejs` | 82 | MIT | 0 | 2026-11-20 | https://github.com/CloudAI-X/threejs-skills/tree/main/skills/threejs-react-three-fiber |
| `img2threejs` | `website` | `threejs` | 85 | Apache-2.0 | 0 | 2026-11-20 | https://github.com/img2threejs/img2threejs |
| `awesome-design-md` | `website` | `—` | 90 | MIT | 84 | 2026-11-20 | https://github.com/VoltAgent/awesome-design-md |

## Skipped Skills & Reasons

| Item / Source | URL | License / Status | Reason Skipped |
| --- | --- | --- | --- |
| `Playwright CLI` | https://github.com/microsoft/playwright-cli | Apache-2.0 | Executable browser automation CLI. Excluded because no approved isolated browser sandbox is configured; host execution is disabled. |
| `TypeUI Design Skills` | https://www.typeui.sh/design-skills | Proprietary / Commercial ToS | Terms of Service (Section 2) explicitly require paid Creative/All-access subscription for downloads and prohibit redistributing TypeUI resources. |
| `awesome-gamedev-agent-skills` built-in router (`router/SKILL.md`) | https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/router | Apache-2.0 | Intentionally skipped per architecture requirement; our own category & engine router handles selection. |
| `react-frontend-skills` (`playwright`, `msw`, `nuqs`, `tdd`, `vitest`) | https://github.com/Pythoughts-labs/react-frontend-skills | MIT | `playwright` skipped (browser automation tool); `msw`/`nuqs`/`tdd`/`vitest` omitted as backend/testing utilities outside core website UI building. |
| `emilkowalski/skills` (`write-swift`, `animate-expo`, `mobile-native`, `ask-emil`, `ask-sonner`) | https://github.com/emilkowalski/skills | MIT | Native iOS/Swift, React Native/Expo, and persona Q&A skills outside web UI scope. |
| `Owl-Listener/designer-skills` (97 of 111 non-UI/ops/research skills) | https://github.com/Owl-Listener/designer-skills | MIT | UX research interview scripts, diary studies, team sprint/org ops excluded to avoid prompt bloat; 14 web UI / design-system / interaction skills imported. |
| `sickn33/antigravity-awesome-skills` (all other ~3,000 skills) | https://github.com/sickn33/antigravity-awesome-skills | MIT / CC-BY-4.0 | Per spec, only `ui-motion`, `design-system`, and `frontend-ui-engineering` were imported. |
| `img2threejs` executable scripts (`bin/`, `forge/`, `scripts/`) | https://github.com/img2threejs/img2threejs | Apache-2.0 | Only `SKILL.md` text skill imported; executable scripts are not imported or auto-executed. |
| `taste-skill` executable scripts & sample binaries (`scripts/`, `assets/`) | https://github.com/leonxlnx/taste-skill | MIT | Only `SKILL.md` and `references/*.md` imported; local Node CLI scripts and binary images excluded. |
| `maxbogo/awesome-ai-tools-for-ui` | https://github.com/maxbogo/awesome-ai-tools-for-ui | No license (index only) | Used strictly as an index to locate upstream repositories; not imported itself. |
