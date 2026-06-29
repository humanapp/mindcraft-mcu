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
  non-integer sends as DOUBLE / DOUBLE_VALUE (Float64LE). Names are length-prefixed UTF-8, truncated
  (a DOUBLE_VALUE name is capped at 8 bytes; a VALUE name has more room).
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
- **Per-callsite cursor.** Each receive callsite keeps its own **read cursor** (a sequence number),
  the generalization of the button sensor's per-callsite last-seen counter from a single slot to a
  buffer. A callsite reads packets with sequence greater than its cursor that are still in the ring; a
  cursor that falls more than 4 behind loses the overwritten packets (best-effort, the CODAL overflow
  behavior) and snaps to the oldest still present.
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
  - **Device API: drain-all.** The Device-API receive returns *all* packets new since this callsite's
    cursor (a batch), draining to the head with no per-packet latency - the full MakeCode-fidelity
    path for heavy or no-loss-within-the-window cases.

The receive **tiles are typed** - `radio receive number` and `radio receive string` (full design in
Surfaces). Each is a per-callsite cursor over the shared ring that delivers the next packet **of its
type**, skipping past packets of other types (which the other-typed sensors pick up via their own
cursors). So each typed sensor drains one packet of its type per think, self-filtering, both kinds
fully delivered, both-fire preserved. `radio receive number` matches NUMBER / DOUBLE packets (bare
numbers), **not** VALUE / DOUBLE_VALUE pairs - matching MakeCode's separate handlers. Value-pairs,
buffers, raw payloads, and the metadata (RSSI, sender serial, system time) are read on the **Device
API** (the richer surface the chassis examples consume), not the tiles.

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
  instance on the **same group**; each receiving instance's cache picks it up on its next think
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

  That is the whole tile surface - four tiles. There is **no group-read tile** (a brain that wants to
  remember its group stores it in a variable), **no power / band config tile** (Device-API only), and
  **no metadata tile** (RSSI / serial / time / raw Buffer are Device-API only).
- **Device API (`ctx.microbit.radio`).** Send (MakeCode-framed): `sendNumber` / `sendString` /
  `sendValue(name, value)` / `sendBuffer`. Send (raw, beyond MakeCode): `sendRawBuffer(buffer)` - the
  datagram payload with no prefix. Receive: a per-callsite read over the receive ring - either the
  next unread packet (or nil) or a **drain-all** that returns every packet new since this callsite's
  cursor (a batch). Each returned packet exposes its typed value, its **raw payload Buffer** (for
  custom decoding), and metadata (RSSI, sender serial, system time). Config: `setGroup` /
  `setTransmitPower` / `setFrequencyBand`.
- **Simulator.** A per-instance radio panel: the group selector, an **inject-packet** control (send
  a number / string / value into this instance - the golden-injection path), and a log of packets
  this instance sent; plus the **multi-instance virtual ether** (`SharedMedium`) that routes sends
  between instances on a shared group.

## micro:bit-v2 target

The concrete fill-in:

- **ABI anchors.** A new `MicroBitField.Radio`, appended **last** at the next free field id (and
  `kMicroBitFieldCount` bumped); a `Radio` type-atom; a contiguous **host-function block**
  (send / receive / config) appended from the next free `MicroBitV2HostFuncId`; and a contiguous
  **action-id block** appended from the next free `HostActionId`. The exact numeric ids are assigned
  append-only at build and reconciled into this section (the registry index lives in
  `docs/specs/microbit-context.md`).
- **Ranges + caps.** group 0-255 (default 0); transmit power 0-7 (default 6); frequency band 0-83
  (default 7; channel at `2400 + band` MHz). Frame 32 bytes, 9-byte MakeCode prefix, typed payload
  <= 20 (BUFFER <= 19, DOUBLE_VALUE name <= 8); over-long strings / buffers **truncate**. RSSI is the
  last packet's signal strength in -dBm (CODAL `getRSSI`). The send trace token is pinned in
  `docs/specs/contracts/observable-trace.md`.
- **CODAL backing.** `MicroBitRadio` - `setGroup` / `setTransmitPower` / `setFrequencyBand`,
  `datagram.send` / `datagram.recv`, `dataReady`, `getRSSI`; on `MICROBIT_RADIO_EVT_DATAGRAM` the host
  loop drains CODAL's own 4-deep RX queue into the receive ring (enqueue-only; the VM drains the ring
  on the next think). The ring depth mirrors `MICROBIT_RADIO_MAXIMUM_RX_BUFFERS` (4).

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

1. ~~**RX model.**~~ RESOLVED: a depth-4 receive ring + per-callsite cursor (matching MakeCode's
   receive reliability - every packet delivered once, in order, all kinds, bounded buffer, best-effort
   on overflow); tile drains one packet per think, Device API drains all-new. Supersedes the earlier
   latest-wins single-slot call.
2. **Value-pair name addressing.** Deferred (see CODAL coverage): the ring delivers every named packet
   in order, so a receiver demuxes by name from the stream; a device-held per-name map is revisited
   only if random-access named reads are needed.
3. ~~**MakeCode interop.**~~ RESOLVED: mirror MakeCode's packet format byte-for-byte (Wire format),
   plus a raw-datagram escape hatch on the Device API for going beyond it.
4. ~~**Payload caps + narrowing.**~~ RESOLVED by mirroring MakeCode: caps per Wire format (32-byte
   frame, 9-byte prefix, payload <= 20, BUFFER <= 19, DOUBLE_VALUE name <= 8); over-long strings /
   buffers **truncate** (MakeCode's behavior), they do not error.
5. ~~**Metadata surface.**~~ RESOLVED: receive tiles deliver the **value only**; RSSI / sender serial
   / system time / raw Buffer are **Device-API only**. (A future **sensor output-tiles** capability -
   a sensor exposing several named outputs - is the natural way to wire each packet facet into
   downstream logic; not built or scheduled.)
6. ~~**Config scope.**~~ RESOLVED: group is the **`set radio group`** tile + Device-API;
   `setTransmitPower` / `setFrequencyBand` are **Device-API only** (no tiles). No group-read surface -
   a brain remembers its group in a variable. Defaults are MakeCode/CODAL's (group 0, power 6, band 7).
