# Changelog

## 2026.9.0

Initial release.

### Added

- **Short.io node** — 45 actions across 8 resources:
  - Domain (4): Create, Get, Get Many, Update Settings
  - Folder (3): Create, Get, Get Many
  - Link (16): Archive, Archive Many, Create, Create Many, Delete, Delete Many, Generate QR Code,
    Generate QR Codes (Many), Get, Get by Original URL, Get by Path, Get Many, Tag Many,
    Unarchive, Unarchive Many, Update
  - Link Country Targeting (4): Create, Create Many, Delete, Get Many
  - Link OpenGraph (2): Get, Set
  - Link Permission (3): Add, Delete, Get Many
  - Link Region Targeting (5): Create, Create Many, Delete, Get Many, Get Regions for Country
  - Statistic (8): Get Domain Statistics, Get Domain Statistics by Interval, Get Domain Top
    Values, Get Link Clicks, Get Link Statistics, Get Link Statistics by Interval, Get Link Top
    Values, Get Raw Clicks
- **Short.io Trigger** — polling trigger with New Link and New Click events.
- Bulk link operations (Create Many, Archive Many, Unarchive Many, Delete Many, Tag Many,
  Generate QR Codes (Many)) with chunking and rate-limit pacing, plus automatic retry with
  backoff on HTTP 429.
- QR code generation as binary output, single image (PNG/SVG) or ZIP for the bulk operation.
- Statistics operations honour a selectable IANA timezone instead of the deprecated `tzOffset`
  parameter.

### Not included

See the README's [Excluded](README.md#excluded) section for API features intentionally left out
of this release.
