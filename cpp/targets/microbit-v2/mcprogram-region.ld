/* Reserve the on-flash .mcprogram region for the micro:bit v2.
 *
 * Defines no SECTIONS, so it supplements the CODAL nRF52833 linker script
 * without changing the firmware layout: it names the region bounds for the
 * boot path (cpp/codal/on-flash-region.h) and the build's metadata emitter.
 *
 * The region is 0x6B000..0x73000 (32 KiB). It must end at or below 0x73000:
 * CODAL carves the flash above that (MICROBIT_APP_REGION_END = bootloader -
 * 4*0x1000) at runtime for its scratch/key-value/FDS pages. The region holds
 * no firmware bytes, so an un-patched device reads 0xff there. The ASSERT
 * keeps the firmware image from growing into it.
 */

PROVIDE(__mcprogram_region_start = 0x0006B000);
PROVIDE(__mcprogram_region_end   = 0x00073000);

ASSERT(__etext <= 0x0006B000,
       "mindcraft: firmware image overflowed into the .mcprogram flash region");
