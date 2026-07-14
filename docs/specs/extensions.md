# Extensions

Extensions let a Mindcraft project depend on other Mindcraft projects. An
extension is not a distinct artifact kind: it is an ordinary project, added to
another project as a dependency. Extension support lives in the core project
model; host applications surface it.

## Concepts

- **Project.** The only unit of authorship and packaging. A project carries a
  content manifest holding its display name, semantic version, and its own
  extensions list. The project interchange document (`.mindcraft`) carries the
  manifest data together with the project's files, brains, and `targets`
  section.
- **Extension.** Any project added as a dependency of another project.
- **Host project.** The project whose extensions list names the dependency.
- **Host application.** The app that loads a project, compiles it, and decides
  which parts of each extension's content to surface.

## Identity and namespacing

**An extension's identity is its `<owner>/<repo>` coordinate**: a name in a
namespace Mindcraft defines, independent of how the content is delivered. The
transports below (remote, app-embedded, local) are delivery mechanisms, not
identity schemes -- GitHub is where remote content is fetched from, not what an
identity is; no identity carries a transport prefix. For remotely fetched
content the coordinate mirrors the repository it was fetched from, so its owner
segment is a real, owned GitHub handle and an identity cannot be claimed by
content that does not live there; embedded and local content carry a declared
coordinate under an owner the platform or author controls. A fork is a
different coordinate and therefore a different extension. Two dependents unify
on a shared dependency exactly when they reference the same coordinate.

Every symbol an extension contributes -- types, tiles, Systems, conversions,
and symbols derived from them (accessor tiles, variable factories, output
keys) -- is keyed under its coordinate by its exported binding name:
`<owner>/<repo>::<binding>`. The host project's own symbols are keyed the same
way under the host project's stable store identifier (a GUID). A coordinate
always contains exactly one `/` and a store identifier never takes that shape,
so the two namespaces cannot collide; there is no unprefixed namespace.

A project's public symbol surface is defined by its **entry module**
(`index.ts`): name-keyed declarations (struct types, Systems, classes,
interfaces, aliases) are published exactly when the entry module exports
them, under their entry-exported name -- `<owner>/<repo>::<name>`. Publication
follows the entry, so moving declarations between files never changes a
published symbol's identity, and an author may reorganize source freely
without breaking consumers; renaming a published name is a breaking change,
as renaming a public export is in any ecosystem. A declaration may be
published under exactly one name (publishing one declaration under two
aliases is a compile error). The published surface's type closure must
itself be published: a published type or tile whose fields, parameters, or
results reference an unpublished name-keyed type is a compile error, the
same rule TypeScript's declaration emit applies to exported names using
private ones. A project with no entry module publishes no named symbols.

Everything not published is module-private with ordinary TypeScript
semantics: two files may declare or export the same name without collision,
and private declarations register under a private file-qualified key,
invisible to consuming projects. Tiles (sensors, actuators) do not ride the
entry mechanism: their identity is their persisted id, and an extension's
tiles surface to consumers by existence. Publication gates cross-project
visibility only -- within its own project, every tile and type is fully
available regardless of exports or entry.

A dependency is imported and stored by its **`<owner>/<repo>` coordinate**,
which is its identity, not by a renamable local alias. Host-project and extension code
import from a dependency through the specifier `@ext/<owner>/<repo>` (exactly
the two coordinate segments; a longer path is a deep import and is rejected),
and its installed content lives at `.extensions/<owner>/<repo>/`. The import
specifier is derived from identity: the same extension imports identically in
every project, and two extensions differ in import exactly when they differ in
identity. Identity, saved-brain references, type unification, the import
specifier, and the install path all follow the coordinate -- there is no
separate local name to choose or collide. Renaming or moving a source repository is an
identity migration: fetches under the old name keep working where the hosting
service redirects them, but adopting the new identity is an explicit,
consumer-visible step (see catalog redirects below for the managed form).

## Adding extensions: by reference

An extension is added by reference: the host project's extensions list records
where the dependency comes from, and installation fetches the extension's
source into the host project.

Reference transports:

- **Remote.** A URL to an immutable snapshot of a project repository at a
  tagged commit, served by a CDN (for example a jsDelivr URL naming a GitHub
  repository at a tag). The tag is an exact pin and a pure routing specifier:
  it names what to fetch and carries no other meaning.
- **App-embedded.** Content bundled with the host application, serving the
  application's shipped extensions offline. Each embedded extension declares
  its **canonical `<owner>/<repo>` coordinate** in the application's embed
  record -- under an owner the platform controls -- so the embedded copy and
  any later published copy are the same extension. Embedding is delivery only;
  the identity is the coordinate, and the content installs into `.extensions/`
  exactly like any other dependency -- the bundle is simply the fetch source in
  place of a network download.
- **Local.** Another project in the same project store
  (`local:<project-id>`), serving the author's inner development loop: build
  an extension as an ordinary local project, add it to a host project, and
  iterate without publishing a version. Local extensions appear in the
  extension browser as their own grouping, surfaced at the host
  application's discretion as an advanced feature.

  A project is eligible as a local extension once its declared
  `<owner>/<repo>` coordinate exists as a repository -- an empty stub
  repository suffices, and the ordinary way a repository comes to exist is
  the project's first publish. Creating the repository is the act that
  claims the name: the coordinate is grounded in the same namespace remote content
  mirrors, a local project cannot assume an identity its author does not
  control, and the local mount and any content later published to that
  repository are one extension across its whole life -- the import
  specifier, install path, and registered keys never change from first
  mount to publication. Switching a dependency between a `local:` reference
  and a published reference to the same repository is a change of delivery,
  not of extension. The host application verifies the repository exists
  when offering or adding the project and records the confirmation; a
  mounted dependency is not re-verified.

  A local dependency is **mounted, not installed**: it is never
  snapshotted, carries no pin and no update affordance, and always reflects
  the live source project -- imports resolve directly against its files,
  and edits to it stream into consuming projects through the same recompile
  pipeline as the host project's own code edits. Adding or removing the
  dependency is transactional as usual, and a change to the local
  dependency's own extensions list re-resolves through the normal install
  pipeline (it can introduce new fetched content). Deleting the source
  project leaves consuming projects with an unresolvable dependency,
  surfaced immediately through ordinary diagnostics; a project with local
  dependencies is not self-contained, and exporting or publishing one warns
  accordingly.

Fetched transports install identically and differ only in provenance; the
local transport mounts. A host application may satisfy a fetch from a
machine-local, pre-seeded extension cache before reaching the network. What
the cache holds is a deployment concern -- an application may seed it with
approved catalog extensions, or an administrator may provision a curated
set for offline environments. A cache-satisfied install is an ordinary
install: identity, layout, and compilation are unchanged, and the cache is
a fetch source like the app bundle, not a transport of its own.

A host application may designate **default extensions**: extensions included
in every project's extensions list at creation. A default extension is an
ordinary dependency thereafter. Embedded extension content may be sourced
from the application's own bundle or from a platform package the application
ships with; either way the embed record is the authority for the extension's
canonical origin and version. An
extension's version is read from its installed content's manifest, uniformly
across transports. An installed extension whose manifest lacks a valid
semantic version is warned about at install time and compared as the lowest
version.

Installed extension content **persists in the project store**. A project
never depends on its sources being reachable after installation: an
unreachable source affects only new installs and reinstalls, never an
existing project.

## Mounts and the platform substrate

A **mount** is read-only content -- source files, type declarations, or both
-- presented to a project's file system and compiler by a declared provider.
Mounts are the one mechanism by which content reaches a project from outside
its own files. They have two kinds of provider:

- **Extensions produce mounts through their lifecycle.** A fetched
  extension's installed snapshot is a mount; a local extension is a live
  mount of its source project.
- **Platform layers produce ambient mounts directly.** The core package
  contributes its ambient type declarations, the target package contributes
  the device API declarations, and a host application may contribute its
  own. Ambient mounts have no manifest entry and no lifecycle: they are
  always present, version with the application, and are invisible to
  dependency resolution. The platform's version is expressed through the
  project `targets` section, which is also where extensions declare their
  compatibility with it.

The boundary between the two: content whose implementation is sandboxed
user-code belongs to the extension domain; surfaces implemented by the host
itself (host functions, built-in tiles, native types) are platform
substrate. A platform layer that ships compilable user-code delivers it as a
default embedded extension; its type declarations ride an ambient mount;
its host registrations are not content and have no mount at all.

Symbol namespaces follow the same three-way split: platform symbols keep
their well-known unprefixed identifiers (the shared vocabulary all projects
and extensions unify on -- a host has exactly one platform); the host
project's own symbols are keyed under its store identifier; extension
symbols are keyed under their origin.

## Install layout

Every dependency, regardless of transport, installs its source under an
extensions folder in the host project (`.extensions/<owner>/<repo>/`), each as
a complete project. The transports differ only in how the content is fetched
(bundle read, CDN download, live local binding); installation, layout, and
compilation are identical. The installed tree is read-only and reproducible: it
can be regenerated from the manifest and the project store, so it need not bloat
the saved project. Installed extension content is built by the host project's
local compilation pipeline; there are no prebuilt artifacts.

The installed source is a first-class, inspectable surface: a user reading or
writing code can browse every dependency's source under `.extensions/` to learn
its API, and a debugger can map execution to those real source paths and step
into dependency code. Dependencies are therefore materialized as real files,
not served through a compiler-only view.

## Dependency resolution

Extensions may declare their own extensions; resolution is transitive, and
dependency cycles are rejected. All references are exact pins. A host project
holds at most one instance of any origin. When resolution encounters the same
origin at two different versions, the higher semantic version (from the
installed manifests) is selected and a warning names both requesters; when
the versions are equal but the references differ, the reference nearest the
host project wins and a warning is emitted.

## Installing: transactional, with an outcome report

Installation never edits host-authored files, so it is cleanly transactional
and cleanly reversible. Adding an extension resolves, installs, recompiles
the project (extensions and host code) and re-typechecks its brains, then
compares diagnostics against the pre-install baseline:

- **Improved** -- pre-existing problems resolved -- the install commits and
  the improvement is reported.
- **Unchanged** -- the install commits silently.
- **Worsened** -- the install still commits, and a non-blocking notice names
  the new problems and offers a one-step undo. Keeping the install supports
  multi-step upgrades whose intermediate states are worse than their end
  state; undoing reverts the manifest entries and re-resolves.

A project with pre-existing errors can always add extensions: the gate is the
difference against its own baseline, never a cleanliness requirement. When
the new problems appear only in content that was already failing, the notice
directs attention there rather than blaming the extension. Installation
refuses outright only on mechanics failures -- an unreachable source, an
unparseable manifest, a dependency cycle -- where no coherent state exists to
commit.

Adding an extension whose dependencies require others installs the whole set
as one transaction with one outcome. Updating several extensions together is
likewise a single transaction judged by its end state.

Every fetched dependency in a project's extensions list carries an update
affordance: on demand, the host checks the dependency's transport for a
newer version (a newer tag for remote origins, the catalog for approved
entries) and applies it as an ordinary transactional install with the same
outcome report. Update checks happen on request, not in the background.
Local dependencies have no update affordance -- they are always current.

Installation events -- take-newer resolutions, tie-break warnings, installs,
removals, undos -- are recorded in the project's install log. The log is a
record, not a channel: nothing in it requires action, and where an
application surfaces it is the application's choice.

## Compilation and registration

Installed extensions compile in dependency order, each as its own compilation
root, before the host project's own sources. Registration into the shared
registries uses register-if-absent with origin-namespaced keys, so a project
depended on by several extensions registers once and all dependents see the
same types, tiles, and derived symbols. Removing an extension unregisters its
contributions symmetrically; saved brains that reference a removed
extension's tiles degrade to missing placeholders and the project still loads
and compiles. Compile outcomes are independent of compile history: switching
projects, or changing an extension's resolved version, never lets a previous
resolution's registrations satisfy the next.

Host-project code and extension code import from an extension by its
`<owner>/<repo>` coordinate through a dedicated specifier prefix
(`@ext/<owner>/<repo>`, exactly the two coordinate segments), resolved via
the importing manifest's extensions list to the installed extension's entry
module. Consumers import the published surface only; a longer path is a deep
module import and is rejected. A project's own modules keep ordinary relative
imports.

## Content kinds, targets, and host-app surfacing

A project's content declares its kind. Core defines the manifest schema,
resolution, installation, compilation, and namespacing for all kinds; each
host application chooses which kinds it surfaces and where. Code content --
the TypeScript payload that produces tiles, types, Systems, and conversions
-- is the foundational kind, and extension tile catalogs appear in the host
application's tile picker. Content kinds a host application does not
recognize are ignored gracefully.

An extension is a real project, so beyond its code surface it may bundle
arbitrary payload: demo brains and per-target assets such as sound effects,
bitmaps, tilemaps, animations, 3d objects, and whole scenes. This payload is
opaque to the extension system. The system compiles and indexes the code
surface and resolves declared capabilities; bundled payload passes through
un-interpreted -- it is never validated for shape and is never a reason to
reject or block an extension. The materialized install tree and the host
application's file serving deliver these bytes verbatim for the host
application or target runtime to consume.

A project declares its content in its manifest's `files` list: every source
and asset file the project comprises, at project-relative paths. The list is
authoritative for assembling the project's content. A host application loading
a project as an embedded or dependency extension, and a build packaging a
project for delivery, assemble that content by reading the manifest and loading
exactly the files it names -- never by enumerating another project's files
themselves. A file is thus added to a project by editing only that project's
own manifest, and the addition is seen wherever the project is embedded or
depended on, with no change to the consumer. Code files are compiled and their
published symbols registered; asset and other payload files, which no import
graph reaches, are declared here and carried through opaquely. The manifest is
always part of the project and does not list itself.

Membership is asymmetric. The project's storage is a filesystem and may hold
more than the build: a file present in storage but absent from the list is
simply not part of the build -- a source kept but excluded, an asset not
shipped, a scratch file -- which is valid and never an error. A listed file
absent from storage is the error direction: the build names content it cannot
assemble. A build validates only that direction; it does not object to
unlisted files.

Compatibility between an extension and a host project is determined by the
project `targets` section: an extension is compatible when it declares a
target the host project's platform satisfies, and the extension browser
filters what it offers accordingly. Every extension declares at least one
target; an extension usable on several platforms enumerates each of them --
there is no universal wildcard.

## Catalog and approved extensions

A host application may consume a catalog: a curated document listing
approved extensions with their origins, versions, targets, and redirects.
The catalog's delivery is at the application's discretion -- bundled with
the application, hosted in the application's own repository and fetched at
runtime, or served -- and its integrity rests on the application's trust
root; for a repository-hosted catalog, that root is the repository's
maintainership. Curation may be an ordinary repository workflow: third
parties propose a new extension, or an update to an approved one, as a pull
request against the catalog document, validated mechanically and merged by
the maintainers. The catalog is a trust authority:

- Approval pins exact content: a catalog entry references the approved
  version by commit (or content hash), so what consumers install cannot
  drift from what was reviewed -- integrity beyond the tag pin, immune to
  moved tags and later pushes. Updating an approved extension is a pin bump,
  and reviewing one is reviewing the difference between the two pinned
  states.
- **Redirects** handle source reorganization: a redirect is an
  identity-preserving alias, mapping an old origin to a new one so that
  existing content keyed under the old origin resolves against content
  fetched from the new origin, while new installs use the new origin
  canonically. Redirect chains collapse; cycles are rejected; a redirect may
  only target an origin within the catalog.
- The catalog owns name governance for what it lists.

The community feed -- user-published projects browsed and downloaded from
within an application -- shares the catalog document shape, differing by
curation status.

## Publishing

Publishing is defined by repository state: a published version is the
project's content at the tag `v<version>` on the author's own repository,
with the manifest version authoritative and matching the tag. A published
repository carries the whole project: the manifest's `files` entries
expanded as individual files on disk, and the manifest itself, which
carries everything else the project comprises -- brains and
application-specific content travel inside `mindcraft.json`, preserved
verbatim whether or not the reading application recognizes them. Two surfaces
perform the publish sequence over one shared engine: the web editor's
publish command, for authors whose projects live in an application's
project store and who have no filesystem or git -- it authenticates through
the editor's built-in GitHub authentication provider and performs the
repository operations through the GitHub REST API -- and a command-line
tool that performs the same sequence with ordinary git for authors working
in a repository checkout. A first publish may also claim the extension's
identity:
when the project has no repository yet, the publish command creates it,
records the `<owner>/<repo>` coordinate in the project manifest, and pushes
the initial version -- one gesture that turns an ordinary project into a
published extension. The publish command owns the whole sequence: it bumps
the manifest version (patch, minor, or major), verifies the working tree is
otherwise clean, commits, creates the tag `v<version>` matching the new
manifest version, and pushes the branch and the tag. Every publish bumps the
version. When the project's extensions list contains local origins, the
publish command asks for confirmation first -- a project with local
dependencies may not work for anyone else -- and proceeds only on explicit
consent. Published extension
repositories are public (the CDN transport serves public repositories).

Separately, a host application can offer publishing a project to the
Mindcraft community feed: users submit project snapshots from within the
application and browse and download other users' projects, with no repository
hosting required of the user.

## Security properties

- No code executes at install time. Installation fetches, resolves, and
  registers; nothing in an extension runs until a brain runs.
- Extension code executes as Mindcraft VM bytecode inside the sandbox, under
  the same budgets and host-call surface as the host project's own code. An
  extension has no JavaScript execution in the host page.
- Catalog content-hash pinning, where present, binds an approved version to
  exact bytes independent of the hosting service.
