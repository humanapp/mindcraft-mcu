import { useState } from "react";
import type { SimulatorInstance } from "@/services/simulator";

/**
 * Per-device ambient light-level control. The slider spans the sensor's 0 (dark)
 * to 255 (bright) range and rests at the device default of 128. Moving it sets
 * the wodal device model's light level directly, which the light-level sensor
 * tile and the `getLightLevel()` device-API method read back.
 */
export function LightLevelSlider({ instance }: { instance: SimulatorInstance }) {
  const [level, setLevel] = useState(() => instance.microbit.display.getLightLevel());

  const onChange = (next: number) => {
    setLevel(next);
    instance.microbit.setLightLevel(next);
  };

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Light
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <input
          type="range"
          data-testid="light-level-slider"
          min={0}
          max={255}
          step={1}
          value={level}
          className="min-w-0 flex-1"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span data-testid="light-level-value" className="w-8 text-right tabular-nums">
          {level}
        </span>
      </span>
    </label>
  );
}
