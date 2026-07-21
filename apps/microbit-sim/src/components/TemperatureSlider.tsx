import { useState } from "react";
import type { SimulatorInstance } from "@/services/simulator";

/**
 * Per-device ambient temperature control. The slider spans -10 to 50 degrees
 * Celsius and rests at the device default of 21. Moving it sets the wodal device
 * model's temperature directly, which the temperature sensor tile and the
 * `getTemperature()` device-API method read back.
 */
export function TemperatureSlider({ instance }: { instance: SimulatorInstance }) {
  const [temperature, setTemperature] = useState(() => instance.microbit.thermometer.getTemperature());

  const onChange = (next: number) => {
    setTemperature(next);
    instance.microbit.setTemperature(next);
  };

  const units = "°C";

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Temp
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <input
          type="range"
          data-testid="temperature-slider"
          min={-10}
          max={50}
          step={1}
          value={temperature}
          className="min-w-0 flex-1"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span data-testid="temperature-value" className="w-8 text-right tabular-nums">
          {temperature}
          {units}
        </span>
      </span>
    </label>
  );
}
