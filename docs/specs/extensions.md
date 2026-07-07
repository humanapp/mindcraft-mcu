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

**An extension's identity is its origin**: the normalized string naming where
it comes from (for the GitHub transport, `gh:<owner>/<repo>`). Identity never
travels inside content -- it is assigned by the installer from where the
content was actually fetched, so an identity cannot be claimed by content that
does not live there. A fork is a different origin and therefore a different
extension. Two dependents unify on a shared dependency exactly when they
reference the same origin.

Every symbol an extension contributes -- types, tiles, Systems, conversions,
and symbols derived from them (accessor tiles, variable factories, output
keys) -- is keyed under its origin by its exported binding name:
`<origin>::<binding>`. The host project's own symbols are keyed the same way
under the host project's stable store identifier. There is no unprefixed
namespace.

A project's public symbol surface is defined by its **entry module**
(`index.ts`): name-keyed declarations (struct types, Systems, classes,
interfaces, aliases) are published exactly when the entry module exports
them, under their entry-exported name -- `<origin>::<name>`. Publication
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

A dependency also has a **slug**: a short human-readable alias chosen by the
depending manifest, scoped to that manifest, used for the install folder and
import specifiers. Slugs are local names; identity, saved-brain references,
and type unification follow the origin only. Renaming or moving a source
repository is an identity migration: fetches under the old name keep working
where the hosting service redirects them, but adopting the new identity is an
explicit, consumer-visible step (see catalog redirects below for the managed
form).

## Adding extensions: by reference

An extension is added by reference: the host project's extensions list records
where the dependency comes from, and installation fetches the extension's
source into the host project.

Reference transports:

- **Remote.** A URL to an immutable snapshot of a project repository at a
  tagged commit, served by a CDN (for example a jsDelivr URL naming a GitHub
  repository at a tag). The tag is an exact pin and a pure routing specifier:
  it names what to fetch and carries no other meaning.
- **App-embedded.** A slug resolved from content bundled with the host
  application, serving the application's shipped example extensions offline.
  Each embedded extension declares its **canonical origin** in the
  application's embed record -- normally the origin it is published under --
  so the embedded copy and the published copy are the same extension.
- **Local.** Another project in the same project store
  (`local:<project-id>`), serving the author's inner development loop: build
  an extension as an ordinary local project, add it to a host project, and
  iterate without publishing. Local extensions appear in the extension
  browser as their own grouping, surfaced at the host application's
  discretion as an advanced feature. A local dependency is **mounted, not
  installed**: it is never snapshotted, carries no pin and no update
  affordance, and always reflects the live source project -- imports resolve
  directly against its files, and edits to it stream into consuming projects
  through the same recompile pipeline as the host project's own code edits.
  Adding or removing the dependency is transactional as usual, and a change
  to the local dependency's own extensions list re-resolves through the
  normal install pipeline (it can introduce new fetched content). A local
  origin is an identity like any other: switching a dependency from a local
  origin to a published one is a change of extension. Deleting the source
  project leaves consuming projects with an unresolvable dependency,
  surfaced immediately through ordinary diagnostics; a project with local
  dependencies is not self-contained, and exporting or publishing one warns
  accordingly.

Fetched transports install identically and differ only in provenance; the
local transport mounts.

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
never depends on its origins being reachable after installation: an
unreachable origin affects only new installs and reinstalls, never an
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

Extension sources install under an extensions folder in the host project
(`.extensions/<slug>/`), each as a complete project. The installed tree is
read-only and reproducible: it can be regenerated from the manifest and the
project store. Installed extension content is built by the host project's
local compilation pipeline; there are no prebuilt artifacts.

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

Host-project code and extension code import from an extension by slug
through a dedicated specifier prefix (`@ext/<slug>`), resolved via the
importing manifest's extensions list to the installed extension's entry
module. Consumers import the published surface only; there are no deep
module imports into an extension. A project's own modules keep ordinary
relative imports.

## Content kinds, targets, and host-app surfacing

A project's content declares its kind. Core defines the manifest schema,
resolution, installation, compilation, and namespacing for all kinds; each
host application chooses which kinds it surfaces and where. Code content --
the TypeScript payload that produces tiles, types, Systems, and conversions
-- is the foundational kind, and extension tile catalogs appear in the host
application's tile picker. Content kinds a host application does not
recognize are ignored gracefully.

Compatibility between an extension and a host project is determined by the
project `targets` section: an extension is compatible when it declares a
target the host project's platform satisfies, and the extension browser
filters what it offers accordingly. Every extension declares at least one
target; an extension usable on several platforms enumerates each of them --
there is no universal wildcard.

## Catalog and approved extensions

A host application may consume a catalog: a curated document, injected from
the application's service and verified against the application's trust root,
listing approved extensions with their origins, versions, targets, and
redirects. The catalog is a trust authority:

- Catalog entries may pin content hashes for approved versions, giving
  integrity beyond the tag pin.
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

Publishing a new version of an extension is a repository operation on the
author's own repository, performed from the Mindcraft VS Code extension on
desktop or web. The publish command owns the whole sequence: it bumps the
manifest version (patch, minor, or major), verifies the working tree is
otherwise clean, commits, creates the tag `v<version>` matching the new
manifest version, and pushes the branch and the tag. Every publish bumps the
version. When the project's extensions list contains local origins, the
publish command asks for confirmation first -- a project with local
dependencies may not work for anyone else -- and proceeds only on explicit
consent. On the web, the command authenticates through the editor's built-in
GitHub authentication provider and performs the repository operations through
the GitHub REST API; on desktop it uses git directly. Published extension
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
