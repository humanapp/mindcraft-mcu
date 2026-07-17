import {
  CoreControlFlowId,
  CoreHostActions,
  CoreLiteralFactoryId,
  CoreOpId,
  CoreVariableFactoryId,
  mkActuatorTileId,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkOperatorTileId,
  mkSensorTileId,
  mkVariableFactoryTileId,
} from "@mindcraft-lang/core/app";
import type { TileVisual } from "@mindcraft-lang/ui";

/**
 * Display labels for the core tiles microbit-sim ships, keyed by tile id.
 * Host tiles registered by the microbit-v2 module and user tiles from
 * libraries carry their own intrinsic labels and are not listed here.
 */
// biome-ignore format: uniform one-liner-per-entry style
export const tileVisuals = new Map<string, Partial<TileVisual>>([
  // Operators
  [mkOperatorTileId(CoreOpId.And), { label: "AND" }],
  [mkOperatorTileId(CoreOpId.Or), { label: "OR" }],
  [mkOperatorTileId(CoreOpId.Not), { label: "NOT" }],
  [mkOperatorTileId(CoreOpId.Add), { label: "plus" }],
  [mkOperatorTileId(CoreOpId.Subtract), { label: "minus" }],
  [mkOperatorTileId(CoreOpId.Multiply), { label: "multiplied by" }],
  [mkOperatorTileId(CoreOpId.Divide), { label: "divided by" }],
  [mkOperatorTileId(CoreOpId.Negate), { label: "negative" }],
  [mkOperatorTileId(CoreOpId.EqualTo), { label: "equal to" }],
  [mkOperatorTileId(CoreOpId.NotEqualTo), { label: "not equal to" }],
  [mkOperatorTileId(CoreOpId.LessThan), { label: "less than" }],
  [mkOperatorTileId(CoreOpId.LessThanOrEqualTo), { label: "less than or equal to" }],
  [mkOperatorTileId(CoreOpId.GreaterThan), { label: "greater than" }],
  [mkOperatorTileId(CoreOpId.GreaterThanOrEqualTo), { label: "greater than or equal to" }],
  [mkOperatorTileId(CoreOpId.Assign), { label: "gets" }],
  // Control Flow
  [mkControlFlowTileId(CoreControlFlowId.OpenParen), { label: "(" }],
  [mkControlFlowTileId(CoreControlFlowId.CloseParen), { label: ")" }],
  // Variable Factories
  [mkVariableFactoryTileId(CoreVariableFactoryId.Boolean), { label: "create a boolean variable" }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.Number), { label: "create a number variable" }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.String), { label: "create a text variable" }],
  // Literal Factories
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), { label: "create a number tile" }],
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.String), { label: "create a text tile" }],
  // Sensors
  [mkSensorTileId(CoreHostActions.Random.key), { label: "random number" }],
  [mkSensorTileId(CoreHostActions.OnPageEntered.key), { label: "on page entered" }],
  [mkSensorTileId(CoreHostActions.Timeout.key), { label: "timeout" }],
  [mkSensorTileId(CoreHostActions.CurrentPage.key), { label: "current page" }],
  [mkSensorTileId(CoreHostActions.PreviousPage.key), { label: "previous page" }],
  // Actuators
  [mkActuatorTileId(CoreHostActions.SwitchPage.key), { label: "switch page" }],
]);
