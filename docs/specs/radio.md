# Spec: radio

Radio is a **builtin micro:bit service** - the nRF52 2.4 GHz packet radio - exposed across the three
standard surfaces (Tiles / Device API / Simulator). It is a **core** micro:bit capability like the
buttons and the display, **not** a chassis peripheral: a robot library *consumes* radio but does not
define it. Radio is **bidirectional** - a **send** actuator (deterministic output) and a **receive**
sensor (event-driven external input).

The first motivating consumer is a **wireless controller link**: a handheld brain reads its own
controls over `gpio` and **sends** them; a robot brain **receives** them and drives its chassis over
`i2c`. (The controller's button/joystick reads are ordinary `gpio`; the radio layer is the brain's,
not the controller board's.)

## The two halves and their stances

Radio follows the standard device stance (see `docs/specs/microbit-context.md`):

- **Send is a sync actuator** - a port write with no lease and no await. The brain emits a packet on
  the current group and continues the same think.
- **Receive is a poll sensor** - it drains a device-side **receive buffer** of recently arrived
  packets each think, poll-derived like the buttons (not bus-driven): packets land enqueue-only into
  the host loop and the sensor reads them on the next `think()`, the same single-entry discipline
  buttons use. Unlike a button, it delivers each packet as an **event value** when it fires rather
  than exposing a persistent level (see Receive).

## The radio as a service (device state)

The device holds:

- **group** (0-255), **transmit power** (0-7), and **frequency band** (0-83) - radio configuration.
  Both ends of a link must agree on the group (and band, if changed from the default).
- A bounded **receive ring buffer** (depth 4, matching CODAL's `MICROBIT_RADIO_MAXIMUM_RX_BUFFERS`)
  holding the most recent packets in arrival order, each tagged with a **monotonic sequence number**
  and carrying its payload, type, group, RSSI, and sender metadata (serial number, system time).
  Overflow overwrites the oldest. The ring is a transient **delivery** buffer - drained by the
  receive callsites (see Receive) - **not** a persistent, queryable "last value": a packet is
  delivered when a sensor fires and is never retained as a level.

## Wire format (MakeCode interop - the on-air contract)

Radio mirrors the **MakeCode radio packet format** byte-for-byte, so a Mindcraft brain and a MakeCode
program on the same group interoperate seamlessly (the motivating case: a MakeCode-flashed controller
talking to a Mindcraft robot, or vice versa). The format is copied from `pxt-common-packages`
`libs/radio`; this section is the eternal contract.

Each datagram payload (inside CODAL's 4-byte frame header) is:

    | packet type (1 byte) | system time (u32 LE) | serial number (u32 LE) | typed payload |

The fixed prefix is 9 bytes (`PACKET_PREFIX_LENGTH`); the frame is 32 bytes
(`RADIO_MAX_PACKET_SIZE`), so the typed payload is at most 20 bytes. **Packet types:**

| type | id | payload |
| ---- | -- | ------- |
| NUMBER | 0 | an Int32LE at offset 9 |
| VALUE | 1 | an Int32LE at offset 9, then a length-prefixed name string at offset 13 |
| STRING | 2 | a length-prefixed UTF-8 string at offset 9 |
| BUFFER | 3 | a length-prefixed byte buffer at offset 9 (payload <= 19 bytes) |
| DOUBLE | 4 | a Float64LE at offset 9 |
| DOUBLE_VALUE | 5 | a Float64LE at offset 9, then a length-prefixed name string at offset 17 |

- **Number encoding follows MakeCode:** an integer value sends as NUMBER / VALUE (Int32LE); a
  non-integer sends as DOUBLE / DOUBLE_VALUE (Float64LE). The integer-vs-non-integer predicate is
  MakeCode's `value === (value | 0)`. Names are length-prefixed UTF-8, truncated; **both VALUE and
  DOUBLE_VALUE names are capped at 8 bytes** (MakeCode caps both, not just DOUBLE_VALUE).
- **Metadata:** the **system time** is the sender's running time; the **serial number** is the
  sender's device serial, or 0 unless the sender enabled transmit-serial. Both, plus the **RSSI**, are
  carried on the received packet (see Receive).
- **f32 boundary nuance.** Mindcraft numbers are f32 but the wire carries Int32 or Float64: a received
  Float64 narrows to f32, and an Int32 above 2^24 cannot round-trip through f32. The conversion happens
  at the radio boundary; the micro:bit-v2 section pins it. (For the controller-state consumer - small
  integers and short strings - this never bites.)

## Send (actuator)

A sync actuator: the brain emits one packet on the current group. The payload forms are the
**MakeCode-compatible typed packets** (see Wire format), so a MakeCode receiver decodes them and vice
versa:

- a **Number** (NUMBER if integral, DOUBLE otherwise),
- a **String**,
- a **name + Number value pair** (VALUE / DOUBLE_VALUE - a short name plus a number, the workhorse for
  control state, e.g. `"x"` -> joystick X), and
- a **Buffer** (BUFFER - a length-prefixed byte payload, <= 19 bytes).

**Beyond MakeCode - the raw escape hatch (Device API).** For custom protocols, `ctx.microbit.radio`
also exposes a **raw datagram send** that transmits a Buffer as the datagram payload with **no**
MakeCode prefix (no type / time / serial), plus a matching **raw receive** (see Receive / Device API).
Raw users own the entire byte layout. Caveat: raw packets share the group with framed ones, and a
MakeCode receiver reads a raw packet's first byte as a packet type - use a separate group (or a
deliberately compatible first byte) when mixing raw and framed traffic.

A **boolean** has no wire type of its own: it is sent as a NUMBER `0` / `1`, so a sent boolean is
received as a number (`1` / `0`) by `radio receive number`. There is no boolean receive form.

On device, send is **synchronous** (CODAL `datagram.send` blocks until transmission completes); for
parity it is a deterministic port write. Over-long payloads narrow per the target (the micro:bit-v2
section pins the rule).

Trace: `port radio send group <g> <typed-payload>`.

## Receive (poll sensor over a buffered ring)

Receive is **external input**, modeled on the button sensor (poll-derived, page-scoped) but reading
from the **receive ring buffer** and delivering each packet as an **event value, not a level**. The
design matches MakeCode's receive reliability: every locally received packet is delivered once, in
arrival order, across all kinds, bounded by a depth-4 buffer; lossy only on the air or on overflow.

- **Arrival.** Packets land enqueue-only into the ring (depth 4), in order, each with a monotonic
  sequence number; the host loop applies them between thinks. Overflow overwrites the oldest.
- **Cursors are reader-owned; the host holds no Device-API receive cursor.** Each packet carries a
  monotonic **sequence number**. A reader tracks "where I have read up to" and asks for packets with
  sequence greater than that. The receive **tiles** have the host manage this per-callsite for them
  (host-actions get a callSiteId + context on both VMs, so each tile callsite has its own cursor, the
  generalization of the button sensor's per-callsite last-seen counter). **User code (the Device API)
  manages its own cursor explicitly** - it passes its last-seen sequence in and stores the new one
  itself; the host keeps no cursor for it (see Surfaces / Device API). A reader more than 4 behind
  loses the overwritten packets (best-effort, the CODAL overflow behavior) and resumes from the oldest
  still present; because sequence numbers are exposed, a Device-API reader can detect that gap.
- **Non-consuming, so every observer fires.** A cursor read does not evict; the ring evicts only by
  overflow. So two receive sensors on a page, each with its own cursor, both see every packet (exactly
  as two button tiles both see one press). A shared consuming queue would force a consume-owner
  question; the per-callsite cursor avoids it.
- **Page enter arms each callsite's cursor to the ring head** - a freshly entered page reads only
  packets that arrive *after* it is active, never a stale packet that landed while another page was
  running.
- **The value is delivered, not held.** When a sensor fires, the packet's value **is** its result -
  the WHEN-result, reaching the DO via `__whenResult` or an explicit value slot (the same convention
  as `scroll`, see `docs/specs/display.md`). The ring is a transient delivery buffer, not a queryable
  "last value": a brain that needs a value later captures it into a rule variable when it fires.
- **Drain policy (per surface).**
  - **Tile: one packet per think.** The "message received" sensor fires once per think and delivers
    the oldest unread packet (cursor advances by one). Each firing is one packet with its value -
    clean WHEN/DO ergonomics. A depth-4 ring absorbs a per-frame burst; the cost versus MakeCode is up
    to ~16 ms/packet latency when more than one packet waits.
  - **Device API: user-managed cursor.** `receive(since)` returns *all* packets in the ring with
    sequence greater than `since` (a batch), with no per-packet latency. There is **no host cursor** -
    the caller passes its last-seen sequence and records the new one from the batch (each `RadioPacket`
    carries its `seq`). `currentSeq()` reads the current head so a caller can arm its cursor to "from
    now" (the user-code analog of the tiles' page-enter arming). Because the cursor lives in user code,
    every independent consumer gets its own non-consuming cursor for free, and the cpp "sync
    host-functions get no execution context" constraint is moot - `receive(since)` is a stateless
    filter (the cursor is an argument), byte-identical on both VMs.

The receive **tiles are typed** - `radio receive number` and `radio receive string` (full design in
Surfaces). Each is a per-callsite cursor over the shared ring that delivers the next packet **of its
type**, skipping past packets of other types (which the other-typed sensors pick up via their own
cursors). So each typed sensor drains one packet of its type per think, self-filtering, both kinds
fully delivered, both-fire preserved. `radio receive number` matches NUMBER / DOUBLE packets (bare
numbers), **not** VALUE / DOUBLE_VALUE pairs - matching MakeCode's separate handlers. Each receive
tile also exposes the packet's **signal strength** (RSSI) as an output tile alongside its `received value` (see
`docs/specs/sensor-output-tiles.md`). Value-pairs, buffers, raw payloads, and the remaining metadata
(sender serial, system time) are read on the **Device API** (the richer surface the chassis examples
consume), not the tiles.

A received **falsy** value (the number 0, the empty string) fires the receive tile only because these
tiles are **presence-gated** (`docs/specs/value-sensor-presence-gate.md`): they carry the
`PresenceGated` capability, so a bare receive-sensor WHEN gates on packet presence (non-nil) rather
than on the value's truthiness. Without that capability a received 0 / "" would be dropped by the
truthiness gate.

**Determinism:** received packets are **injected as input** at specific ticks in a golden schedule -
the same mechanism as injected button presses. The ring's enqueue order, overflow eviction, and each
callsite's cursor advance are deterministic functions of that schedule, so both VMs consume the
identical sequence and byte-match the trace (including a callsite that overflows and snaps forward).

## Config (setup)

`setGroup(0-255)` is both the **`set radio group`** tile and a Device-API call; `setTransmitPower(0-7)`
and `setFrequencyBand(0-83)` are **Device-API only** (no tiles). There is no global one-time init in
user code, so configuration is an explicit call the brain makes (typically on page enter). There is
**no group-read surface** - a brain that wants to remember its group keeps it in a variable. A
brain-editor-only brain runs on the defaults (group 0, power 6, band 7) unless it sets the group; the
first consumers need only **group**.

## Determinism and the simulator's virtual radio

Two distinct paths, deliberately separated:

- **Single-device parity (goldens).** Received packets are injected input on a fixed schedule; send
  is a deterministic port write. Both VMs (the wodal oracle and the C++ mirror) replay the identical
  injected schedule and byte-match the observable trace. The C++ VM is single-device - it never
  routes between devices; it consumes injected packets.
- **Multi-instance sim (interactive).** The microbit-sim runs many device instances and carries a
  `SharedMedium` broker. A send from one instance enqueues the packet into every **other** registered
  instance on the **same group**; each receiving instance's ring picks it up on its next think
  (enqueue-on-send, poll-on-receive - the same single-entry discipline as buttons). This
  cross-instance routing **reuses the same "inject a received packet" path** the goldens use, so it
  is deterministic within the sim's lockstep tick loop. It is a convenience for live multi-device
  play and is **off the single-device parity path** (there is no C++ multi-instance equivalent).

## Surfaces

- **Tiles** (the simple brain-editor subset; richer forms are Device-API only):
  - **`radio send`** actuator - one **optional anonymous value** slot accepting a String, Number, or
    Boolean. With no argument it falls back to the rule's WHEN-result (`__whenResult`), the same
    convention as `scroll`. The value to send is the explicit argument if present, else the
    WHEN-result; if it is a String / Number / Boolean it is sent (a Boolean as a Number `0`/`1`);
    otherwise nothing is sent (a silent no-op, like `scroll`'s non-erroring fallback). The slot is an
    any-typed slot gated at runtime, so the same gate covers both the explicit value and the
    WHEN-result. The group is device config, not an argument.
  - **`radio receive number`** and **`radio receive string`** sensors - typed event sensors, each
    delivering the next packet of its type from the receive ring (see Receive); the received value is
    the sensor's result.
  - **`set radio group`** actuator - sets the device group (0-255).

  That is the whole primary tile surface - four tiles - plus the receive sensors' auto-derived output
  tiles (`received value` + `signal strength`; see `docs/specs/sensor-output-tiles.md`). There is **no
  group-read tile** (a brain that wants to remember its group stores it in a variable), **no power /
  band config tile** (Device-API only), and **no output tile for sender serial / system time / raw
  Buffer** (those remain Device-API only).
- **Device API (`ctx.microbit.radio`).** Send (MakeCode-framed): `sendNumber` / `sendString` /
  `sendValue(name, value)` / `sendBuffer`. Send (raw, beyond MakeCode): `sendRawBuffer(buffer)` - the
  datagram payload with no prefix. Receive (user-managed cursor; see Receive):
  - `receive(since)` returns a `RadioPacket[]` of all ring packets with `seq > since`. The caller owns
    the cursor: pass the last-seen sequence, then record the new one (`batch[batch.length - 1].seq`).
    There is no no-argument drain and no host cursor.
  - `currentSeq()` returns the current head sequence (the most recent packet's `seq`, or 0 if none),
    so a caller can arm its cursor to "from now" (e.g. on page entry) and ignore packets already in
    the ring.
  - **Sequence numbers start at 1; `0` is the reserved "before any packet" sentinel - never a valid
    packet `seq`.** This is required by the exclusive `> since` floor: a fresh caller arming
    `cursor = currentSeq()` (which is 0 when empty), or just defaulting `cursor = 0`, must still
    receive the first packet, so the first packet is `seq 1` (`1 > 0`). A packet numbered 0 would be
    excluded by `receive(0)` and lost.
  - Each `RadioPacket` is a value-struct with fields `seq`, `type`, `value`, `name`, `text`, `buffer`,
    `rssi`, `serial`, `time` (the sequence, the typed value, the value-pair name, the string payload,
    the raw payload Buffer, and the metadata).

  Config: `setGroup` / `setTransmitPower` / `setFrequencyBand`.
- **Simulator.** No radio-specific UI. Each instance's group is set by its brain (`set radio group` /
  `setGroup`), so there is nothing a panel needs to control. The simulator's value is the
  **multi-instance virtual ether** (`SharedMedium`): a send from one instance is delivered to every
  other instance on the same group, into the recipient's receive ring via the same injection path the
  goldens use. Two running brains (one sending, one receiving) demonstrate it directly. (An earlier
  draft proposed a group selector / inject control / sent-packet log; dropped - the group is brain-set
  and a peer instance's send is the packet source, so a panel has nothing to show.) The ether delivers
  the sender's typed packet directly (the wire encode/decode round-trip is lossless and byte-tested
  separately, so re-encoding between two simulated micro:bits would add nothing); since there is no
  real RF, the received metadata is synthetic - RSSI, sender serial, and time are stamped to fixed
  defaults, so in the simulator every sender appears as serial 0.

## micro:bit-v2 target

The concrete fill-in:

- **ABI anchors (assigned by the wodal build; cpp mirrors).**
  - Field: `MicroBitField.Radio = 8` (count 8 -> 9; appended last, position == id).
  - Type-atoms: `Radio = 1032`, `RadioPacket = 1033`, `RadioPacketList = 1034` (count 8 -> 11).
    `RadioPacketList` is the target-owned list type for `receive()`'s `RadioPacket[]` (`addListType`
    requires its own atom id).
  - Host-fn block 1057-1070: `RadioSendNumber 1057`, `RadioSendString 1058`, `RadioSendValue 1059`,
    `RadioSendBuffer 1060`, `RadioSendRawBuffer 1061`, `RadioSetGroup 1062`, `RadioSetTransmitPower
    1063`, `RadioSetFrequencyBand 1064`, `RadioReceive 1065` (`receive(since)`), `ActuatorRadioSend
    1066`, `SensorRadioReceiveNumber 1067`, `SensorRadioReceiveString 1068`, `ActuatorSetRadioGroup
    1069`, `RadioCurrentSeq 1070` (`currentSeq()`). `RadioReceive` takes a `since` argument and there
    is no no-argument drain; the `RadioPacket` struct carries a `seq` field. (The wodal build assigned
    1057-1069 for the original port-global drain; the user-managed-cursor revision changes
    `RadioReceive`'s signature and appends `RadioCurrentSeq 1070`.)
  - Action block: `RadioSend 1032`, `RadioReceiveNumber 1033`, `RadioReceiveString 1034`,
    `SetRadioGroup 1035`.
  - The registry index lives in `docs/specs/microbit-context.md`.
- **Ranges + caps.** group 0-255 (default 0); transmit power 0-7 (default 6); frequency band 0-83
  (default 7; channel at `2400 + band` MHz). Frame 32 bytes, 9-byte MakeCode prefix, typed payload
  <= 20 (BUFFER <= 19, VALUE and DOUBLE_VALUE names <= 8); over-long strings / buffers **truncate**.
  RSSI is the last packet's signal strength in -dBm (CODAL `getRSSI`). The send trace token is pinned
  in `docs/specs/contracts/observable-trace.md`.
- **CODAL backing.** `MicroBitRadio` - `setGroup` / `setTransmitPower` / `setFrequencyBand`,
  `datagram.send` / `datagram.recv`, `getRSSI`. Each host-loop tick, before think, the loop **drains
  `datagram.recv()` until empty** into the receive ring (enqueue-only; the VM reads the ring on the
  next think). Drain the datagram queue directly - do NOT gate on `dataReady()`: that counts the
  radio-level RX queue, but CODAL's `idleCallback` moves packets into the separate datagram queue, so
  `dataReady()` reads 0 by poll time and the packets strand (this matches MakeCode's `readRawPacket`,
  which never checks `dataReady`). The ring depth mirrors `MICROBIT_RADIO_MAXIMUM_RX_BUFFERS` (4).

## CODAL radio capability coverage

Per the full-surface-design principle, the whole `MicroBitRadio` capability set is accounted for; what
is built is a subset, with each gap marked composable / designed-out / deferred.

- **Shipped:** group / power / band config; MakeCode-framed send + **buffered receive** (depth-4 ring,
  in-order, each-once) of number / string / value / buffer; the **raw datagram** send + receive
  (Device-API escape hatch); RSSI, sender serial, and system-time metadata on the received packet.
- **Composable / designed out:** the CODAL **eventbus** radio bridge (`MicroBitRadioEvent`
  `listen` / `ignore` - transparent device-event propagation between micro:bits) is a distinct
  feature, not the data path; not surfaced.
- **Designed but not built (genuine capabilities):**
  - **Per-name value addressing** - a device-held map keeping the latest value for each `name`, so a
    receiver could read several named axes without draining the ring itself. Deferred: it reintroduces
    held device state, and the buffered ring already delivers every named packet in order. Revisit only
    if a consumer must read named axes by random access rather than from the stream.

## Conformance

- The wodal microbit module is the oracle; the C++ target mirrors it. Send is byte-matched via the
  `port radio send ...` trace line; receive is byte-matched by replaying an injected packet schedule
  (the button-press injection pattern) and comparing the receive sensor's action-result lines. Both
  VMs read the same injected schedule and produce byte-identical traces.
- The multi-instance virtual ether (`SharedMedium`) is a simulator feature, off the single-device
  parity path; it routes through the same injection entry point the goldens use.

## Open questions

1. ~~**RX model.**~~ RESOLVED: a depth-4 receive ring (matching MakeCode's receive reliability - every
   packet delivered once, in order, all kinds, bounded buffer, best-effort on overflow). Tiles drain
   one packet per think via host-managed per-callsite cursors. The **Device API uses a user-managed
   cursor** - `receive(since)` (a stateless filter) + `currentSeq()` + a `seq` on each packet; there is
   no host cursor and no no-argument drain. Supersedes both the earlier latest-wins single-slot call
   and the interim port-global drain cursor.
2. **Value-pair name addressing.** Deferred (see CODAL coverage): the ring delivers every named packet
   in order, so a receiver demuxes by name from the stream; a device-held per-name map is revisited
   only if random-access named reads are needed.
3. ~~**MakeCode interop.**~~ RESOLVED: mirror MakeCode's packet format byte-for-byte (Wire format),
   plus a raw-datagram escape hatch on the Device API for going beyond it.
4. ~~**Payload caps + narrowing.**~~ RESOLVED by mirroring MakeCode: caps per Wire format (32-byte
   frame, 9-byte prefix, payload <= 20, BUFFER <= 19, DOUBLE_VALUE name <= 8); over-long strings /
   buffers **truncate** (MakeCode's behavior), they do not error.
5. ~~**Metadata surface.**~~ RESOLVED via sensor output tiles (`docs/specs/sensor-output-tiles.md`):
   each receive tile exposes its packet's **value** and **signal strength** (RSSI) as named output
   tiles the brain can wire downstream, in addition to the value delivered through `__whenResult`.
   Sender serial, system time, and the raw Buffer remain **Device-API only** (no output tile). A
   packet **name** is not surfaced here - names exist only on `VALUE` / `DOUBLE_VALUE` (named numbers),
   not on `STRING` packets; surfacing `received name` awaits a value-pair receive form (a separate enhancement).
6. ~~**Config scope.**~~ RESOLVED: group is the **`set radio group`** tile + Device-API;
   `setTransmitPower` / `setFrequencyBand` are **Device-API only** (no tiles). No group-read surface -
   a brain remembers its group in a variable. Defaults are MakeCode/CODAL's (group 0, power 6, band 7).
