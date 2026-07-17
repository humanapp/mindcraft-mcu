/**
 * First byte of a gamepad state packet, discriminating it from all other radio
 * traffic on the group. Shared by the position-to-Buffer encode conversion and
 * the decoder so both agree on the wire format. 0x47 is ASCII 'G'.
 */
export const PACKET_MAGIC = 0x47;
