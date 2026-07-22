# Authoring Tiles in VS Code

Write custom brain tiles in TypeScript using **VS Code for the Web**. The Mindcraft extension connects your editor to the micro:bit simulator so new sensors and actuators appear as tiles in the Brain Editor as you code.

## Setup

### 1. Install the extension

1. Open [vscode.dev](https://vscode.dev)
2. Switch to the Extensions panel
3. Search for **mindcraft** and install it

### 2. Start the bridge

1. In the Dev Panel, turn on the **VS Code Bridge** toggle
2. Once it connects, copy the **join code** to your clipboard

### 3. Connect

1. Back in vscode.dev, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run `Mindcraft: Connect`
3. Paste the **join code** and press Enter

TypeScript files will now sync between the editor and the simulator. Edits hot-reload immediately -- save a file and the updated tile is ready to use.

## Tips

- Use `Create New Sensor` or `Create New Actuator` to scaffold an empty tile.
- Once paired, the connection persists and reconnects automatically. A new join code is only needed if either side is manually disconnected.
