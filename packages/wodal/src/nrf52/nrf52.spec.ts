import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NRF52FlashManager } from "./nrf52-flash-manager";
import { NRF52Serial } from "./nrf52-serial";

describe("NRF52Serial", () => {
  it("wraps transmitted and received data to bytes", () => {
    const serial = new NRF52Serial();

    assert.equal(serial.send([0, 255, 256, -1]), 4);
    assert.deepEqual(serial.drainTx(), [0, 255, 0, 255]);

    assert.equal(serial.receive([511, -2]), 2);
    assert.equal(serial.readByte(), 255);
    assert.equal(serial.readByte(), 254);
    assert.equal(serial.readByte(), undefined);
  });
});

describe("NRF52FlashManager", () => {
  it("writes, reads, and clips at flash bounds", () => {
    const flash = new NRF52FlashManager(8, 4);

    assert.equal(flash.write(6, new Uint8Array([1, 2, 3])), 2);
    assert.deepEqual(Array.from(flash.read(4, 10)), [255, 255, 1, 2]);
  });

  it("erases a page to 0xff", () => {
    const flash = new NRF52FlashManager(8, 4);

    flash.write(0, new Uint8Array([1, 2, 3, 4, 5]));
    flash.erasePage(0);

    assert.deepEqual(Array.from(flash.read(0, 8)), [255, 255, 255, 255, 5, 255, 255, 255]);
  });
});
