/* Reserve the on-flash .mcprogram region for the micro:bit v2.
 *
 * Defines no SECTIONS, so it supplements the CODAL nRF52833 linker script
 * without changing the firmware layout: it names the region bounds for the
 * boot path (cpp/codal/on-flash-region.h) and the build's metadata emitter.
 *
 * Start is the firmware's flash end (the LMA end of .data, loaded after the
 * FLASH-resident sections at __etext) rounded up to a 4 KiB erase page, so the
 * region begins on a page boundary right after the firmware. End is fixed at
 * 0x73000: CODAL carves the flash above it (MICROBIT_APP_REGION_END =
 * bootloader - 4*0x1000) at runtime for its scratch/key-value/FDS pages. The
 * region holds no firmware bytes, so an un-patched device reads 0xff there. The
 * ASSERT keeps a growing firmware from squeezing out the region.
 */

PROVIDE(__mcprogram_region_start = ALIGN(__etext + SIZEOF(.data), 0x1000));
PROVIDE(__mcprogram_region_end   = 0x00073000);

ASSERT(__mcprogram_region_start + 0x1000 <= __mcprogram_region_end,
       "mindcraft: firmware image leaves no room for the .mcprogram region");
