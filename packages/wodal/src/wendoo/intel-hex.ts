/**
 * A minimal Intel HEX writer: enough to splice a block of bytes into an existing
 * firmware hex at an absolute flash address. Environment-agnostic: no Node or
 * DOM APIs.
 *
 * The emitted records use the conventional 16-byte data record, uppercase hex
 * digits, and standard checksums. The same inputs always produce identical
 * output.
 */

/** Bytes of payload carried by each emitted data record. */
const DATA_RECORD_LENGTH = 16;

/** Intel HEX record type for a data record. */
const RECORD_TYPE_DATA = 0x00;

/** Intel HEX record type for an Extended Linear Address (sets address bits 16-31). */
const RECORD_TYPE_EXTENDED_LINEAR_ADDRESS = 0x04;

function toHex2(value: number): string {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Encode one Intel HEX record from a 16-bit address, a record type, and its
 * data bytes, appending the standard two's-complement checksum.
 */
function encodeRecord(address16: number, recordType: number, data: Uint8Array): string {
  const head = [data.length, (address16 >>> 8) & 0xff, address16 & 0xff, recordType];
  let sum = head[0] + head[1] + head[2] + head[3];
  let body = "";
  for (const byte of data) {
    sum += byte;
    body += toHex2(byte);
  }
  const checksum = (0x100 - (sum & 0xff)) & 0xff;
  return `:${toHex2(head[0])}${toHex2(head[1])}${toHex2(head[2])}${toHex2(head[3])}${body}${toHex2(checksum)}`;
}

function extendedLinearAddressRecord(upper16: number): string {
  return encodeRecord(
    0x0000,
    RECORD_TYPE_EXTENDED_LINEAR_ADDRESS,
    Uint8Array.of((upper16 >>> 8) & 0xff, upper16 & 0xff)
  );
}

/**
 * Encode `bytes` as Intel HEX data records placed at absolute byte address
 * `baseAddress`. An Extended Linear Address record precedes the first data
 * record and is re-emitted on each 64 KiB boundary the address crosses, fully
 * specifying every data record's address independent of earlier records.
 *
 * `baseAddress` must be 16-byte aligned.
 */
export function encodeDataRecords(baseAddress: number, bytes: Uint8Array): string[] {
  const records: string[] = [];
  let currentUpper = -1;
  for (let offset = 0; offset < bytes.length; offset += DATA_RECORD_LENGTH) {
    const address = baseAddress + offset;
    const upper = (address >>> 16) & 0xffff;
    if (upper !== currentUpper) {
      records.push(extendedLinearAddressRecord(upper));
      currentUpper = upper;
    }
    const end = Math.min(offset + DATA_RECORD_LENGTH, bytes.length);
    records.push(encodeRecord(address & 0xffff, RECORD_TYPE_DATA, bytes.subarray(offset, end)));
  }
  return records;
}

/**
 * Insert `records` immediately before the end-of-file record of `hexText`,
 * leaving every existing record untouched and in order. The line ending of the
 * input is preserved (CRLF if present, otherwise LF). Throws if the input has
 * no end-of-file record.
 */
export function spliceRecordsBeforeEof(hexText: string, records: string[]): string {
  const eol = hexText.includes("\r\n") ? "\r\n" : "\n";
  const eofPattern = /:00000001FF/gi;
  let eofIndex = -1;
  let match: RegExpExecArray | null = eofPattern.exec(hexText);
  while (match !== null) {
    eofIndex = match.index;
    match = eofPattern.exec(hexText);
  }
  if (eofIndex < 0) {
    throw new Error("firmware hex has no end-of-file record");
  }
  const prefix = hexText.slice(0, eofIndex);
  const suffix = hexText.slice(eofIndex);
  return prefix + records.join(eol) + eol + suffix;
}
