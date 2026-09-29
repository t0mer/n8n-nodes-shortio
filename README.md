# n8n-nodes-shortio

[![npm version](https://img.shields.io/npm/v/@t0mer/n8n-nodes-shortio.svg)](https://www.npmjs.com/package/@t0mer/n8n-nodes-shortio)
[![CI](https://github.com/t0mer/n8n-nodes-shortio/actions/workflows/ci.yml/badge.svg)](https://github.com/t0mer/n8n-nodes-shortio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/t0mer/n8n-nodes-shortio/blob/main/LICENSE)

An n8n community node for [Short.io](https://short.io), a branded short-link service. It covers
Short.io's server-side API: links, bulk link operations, QR codes, OpenGraph, link permissions,
country/region targeting, folders, domains, statistics, and a polling trigger for new links and
clicks.

The package contains two nodes:

- **Short.io**: 45 actions across 8 resources. It can also be used as a tool by an n8n AI Agent.
- **Short.io Trigger**: a polling trigger for new links and new clicks on a domain.

> This package is unofficial. It is not affiliated with, endorsed by, or supported by Short.io.
> "Short.io" is used only to describe what the node connects to.

> **Status:** See [Excluded](#excluded) for API features that are
> not covered, and [Version history](#version-history) for releases.

## Contents

- [Demo](#demo)
- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Example workflows](#example-workflows)
- [Bulk operations](#bulk-operations)
- [Rate limits](#rate-limits)
- [Statistics notes](#statistics-notes)
- [Output and errors](#output-and-errors)
- [Excluded](#excluded)
- [Compatibility](#compatibility)
- [Security notes](#security-notes)
- [Usage terms](#usage-terms)
- [Development](#development)
- [Contributing](#contributing)
- [Resources](#resources)
- [Version history](#version-history)
- [License](#license)

## Demo

Create a branded short link and generate its QR code:

<video src="https://github.com/t0mer/n8n-nodes-shortio/raw/main/assets/demo/shortio-demo.mp4" controls muted width="720"></video>

[![Short.io node demo: create a branded short link and generate its QR code (click to play the MP4)](https://raw.githubusercontent.com/t0mer/n8n-nodes-shortio/main/assets/demo/shortio-demo.gif)](https://github.com/t0mer/n8n-nodes-shortio/blob/main/assets/demo/shortio-demo.mp4)
<!-- TODO: verify: replace the 9.5 MB GIF preview with a still poster frame (PNG) of the MP4 -->

[Watch the full demo video (MP4, 2 minutes)](https://github.com/t0mer/n8n-nodes-shortio/blob/main/assets/demo/shortio-demo.mp4)

## Installation

### Community Nodes (recommended)

On a self-hosted n8n instance:

1. Go to **Settings → Community Nodes**.
2. Select **Install**, enter `@t0mer/n8n-nodes-shortio`, and confirm.

### Manual installation

For queue-mode setups, or instances where installing from the UI is disabled, install the package
into n8n's custom nodes folder (by default `~/.n8n/nodes`) and restart n8n:

```bash
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install @t0mer/n8n-nodes-shortio
```

In queue mode, install it on the main instance and on every worker. See the n8n guide to
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation-and-management)
for details.

## Credentials

The node authenticates with a Short.io **secret** API key. Public keys (the kind used in
client-side JavaScript) are not supported: every operation runs server-side.

1. In the Short.io dashboard, go to **Integrations & API** and create a secret key. See
   [Creating an API key](https://developers.short.io/docs/creating-an-api-key) for the walkthrough.
2. In n8n, create a **Short.io API** credential and paste the key into **Secret API Key**.

| Field | Required | Description |
|---|---|---|
| Secret API Key | Yes | Your Short.io secret key. It is stored as a password field and sent in the `Authorization` header of every request. |

The credential holds only the key. You choose the domain in each node (the **Domain** field), not
in the credential. The key's team or domain permissions limit which domains the node can see and
act on: a key scoped to one domain won't list or resolve the others. **Test** in the credential
dialog calls `GET https://api.short.io/api/domains?limit=1`.

## Operations

**Domain**, **Link** and **Folder** fields use a resource locator:

- **Domain**: **From List** (fetched via `GET /api/domains`, shown by hostname) or **By ID**
  (the numeric domain ID).
- **Link**: **By ID** (accepts both the current `link_…` and the older `lnk_…` idString format)
  or **By Short URL**, which accepts a short link (`https://host/path`; the scheme is optional)
  and resolves it through `GET /links/expand`.
- **Folder**: **From List** (`GET /links/folders/{domainId}`, needs the Domain field) or **By ID**.

### Link

| Operation | Notes |
|---|---|
| Archive | |
| Archive Many | Up to 150 links per call |
| Create | Domain and Original URL are required; every other field is optional (see [Link fields](#link-fields)) |
| Create Many | Up to 1000 links per call, paced at 5 calls / 10 s. Requests are grouped by domain and folder first, since a single call can only carry one domain and one folder. If a call fails without Continue On Fail after earlier calls already created links, the error reports how many were created; if the first call fails, its original error is thrown. |
| Delete | |
| Delete Many | Up to 150 links per call, paced at 1 call / s |
| Generate QR Code | Binary image output. The image bytes are returned directly by Short.io in the same request (no separate download, no third-party host); the MIME type and extension are detected from the returned bytes, with the Type option as the fallback. See [QR codes](#qr-codes). |
| Generate QR Codes (Many) | Up to 150 links per call; binary output, one ZIP per call, returned directly by Short.io the same way as Generate QR Code |
| Get | |
| Get by Original URL | Returns every link on the domain that redirects to that URL |
| Get by Path | Looks up a link by its Domain and Path (a leading slash is stripped) |
| Get Many | Paginated (Return All, or Limit up to 1000, default 50). Filters: After Date, Before Date, Created At, Date Sort Order (Descending when added), Folder, and ID String. Short.io ignores an ID filter server-side, so **ID String** makes the node scan pages until it finds the link; for a single known ID, **Get** is faster. |
| Tag Many | Adds the **Tag** to up to 150 links per call. Existing tags are kept. |
| Unarchive | |
| Unarchive Many | Up to 150 links per call |
| Update | Same fields as Create plus Original URL, all optional, **except Folder and Allow Duplicates**, which Short.io's update endpoint doesn't accept. At least one field is required. |

#### Link fields

Create and Create Many take these optional **Additional Fields**; Update takes the same set as
**Update Fields**:

| Field | Type | Notes |
|---|---|---|
| AdRoll / Facebook / Google Analytics / Google Tag Manager Integration | String | Pixel or tracking ID fired when the link is visited |
| Allow Duplicates | Boolean | Create only. Create a new link even if one already exists for the URL. |
| Android URL / iPhone URL | String | Device-specific destinations |
| Archived | Boolean | |
| Clicks Limit | Number | Clicks after which the link is disabled |
| Cloaking | Boolean | Mask the destination URL in the address bar |
| Created At | Date | Override the creation date |
| Expires At / Expired URL | Date / String | After Expires At, visitors go to Expired URL |
| Folder | Resource locator | Create only |
| Password / Password Contact | String / Boolean | Password-protect the link; optionally show your email on the password page |
| Path | String | The slug. Leave empty to let Short.io generate one. Same path and same URL returns the existing link; same path and a different URL returns a 409 conflict. |
| Redirect Type | Options | 301, 302 (pre-filled when added), 307 or 308 |
| Skip Query String Merging | Boolean | Don't merge the visitor's query string into the destination |
| Split URL / Split Percent | String / Number | A/B split testing (Split Percent 1–100, pre-filled with 50 when added) |
| Tags | String | Comma-separated. An expression may return an array instead. |
| Title | String | |
| TTL | Date | When the link itself is deleted (not just expired). Must be at least one week ahead; deletion may lag by 1–2 hours. |
| UTM Campaign / Content / Medium / Source / Term | String | Appended to the destination URL |

Dates without a time zone are read in the workflow's time zone.

#### QR codes

| Option | When added | Notes |
|---|---|---|
| Type | PNG | PNG or SVG |
| Size | 10 | Size of one QR module in pixels (1–99) |
| Color / Background Color | `#000000` / `#FFFFFF` | Sent to Short.io without the leading `#` |
| Use Domain Settings | true | Use the domain's configured QR style. Always sent (true unless you add it and turn it off). |
| No Excavate | false | Generate QR Codes (Many) only. Keep modules behind a center logo instead of clearing space for it. |

The "When added" values are what n8n pre-fills when you add an option. An option you don't add
isn't sent, so Short.io's default or the domain's settings apply. Generate QR Codes (Many) always
sends a Type (PNG unless you add Type).

- **Generate QR Code** writes the image to the binary property named in **Binary Property**
  (default `data`) as `qr-<linkId>.png` or `.svg`. The JSON output is `idString`, `type` (detected
  from the returned bytes) and `requestedType`.
- **Generate QR Codes (Many)** takes one **Domain** for the whole batch, reads the options from
  the first input item, and outputs one item per chunk of up to 150 links. Each item has the ZIP in
  the `data` binary property (`qr-codes-1.zip`, `qr-codes-2.zip`, …) and `linkIds`/`count` in its
  JSON.

### Link OpenGraph

Both operations need the link's **Domain** as well as the **Link**.

| Operation | Notes |
|---|---|
| Get | Returns `properties` (an object of tag → value) and `raw` (the key/value pairs as Short.io returns them) |
| Set | One or more **Key**/**Value** pairs. Keys come from a list of OpenGraph and Twitter card tags (for example `title`, `description`, `image`, `twitter:card`). |

### Link Permission

All operations need the link's **Domain** as well as the **Link**.

| Operation | Notes |
|---|---|
| Add | Grants a team member (**User ID**, the Short.io user ID) access to the link |
| Delete | Removes that user's permission |
| Get Many | |

### Link Country Targeting

Sends visitors from a country to a different destination URL.

| Operation | Notes |
|---|---|
| Create | Country (ISO 3166-1 alpha-2, picked from a list) and Original URL |
| Create Many | Multiple Country/Original URL targets for one link in a single call |
| Delete | |
| Get Many | |

### Link Region Targeting

Sends visitors from a country subdivision (state, province, …) to a different destination URL.

| Operation | Notes |
|---|---|
| Create | Country, Region and Original URL. The Region list loads the chosen country's subdivisions. |
| Create Many | Multiple targets for one link in a single call. Here Region is typed in as the bare subdivision code (e.g. `CA`, not `US-CA`). |
| Delete | |
| Get Many | |
| Get Regions for Country | Lists a country's subdivision codes |

### Folder

| Operation | Notes |
|---|---|
| Create | Domain and Name, plus optional defaults for links in the folder: integrations, QR colors/EC level/logo, Expires At Days, Icon, Prefix, Redirect Type and UTM values |
| Get | |
| Get Many | All folders on the domain |

### Domain

| Operation | Notes |
|---|---|
| Create | **Hostname** (adds a real domain to your account; a scheme or trailing slash is stripped, a path is rejected) plus optional Hide Referer and Link Type |
| Get | |
| Get Many | Return All or Limit (default 50); filters: Pattern, Team ID, Without Team |
| Update Settings | Exposes every domain setting field as optional in Update Fields. A separate **Clear Fields** option explicitly nulls out the 7 nullable settings (AdRoll/Facebook/Google Analytics/Google Tag Manager Integration, Not Found Redirect, Segment Key, Webhook URL) instead of leaving them unchanged; the 404-redirect field is labeled **Not Found Redirect**. |

### Statistic

Statistics requests go to `https://statistics.short.io`.

| Operation | Notes |
|---|---|
| Get Domain Statistics | Options: Clicks Chart Interval, Skip Tops (true when added; not sent otherwise, and then Short.io returns the top lists) |
| Get Domain Statistics by Interval | **Clicks Chart Interval**: Hour, Day (default), Week or Month |
| Get Domain Top Values | **Column**, **Limit** (default 50) and **Prefix**. See [Statistics notes](#statistics-notes) for the column list. |
| Get Link Clicks | Identify links by ID (comma-separated link IDs) or by path; takes an optional date range only (no Period, Timezone or Filters). In Path mode, Created At is required per link, and the response is keyed by the bare path the node sends (not by what you enter). |
| Get Link Statistics | Options: Clicks Chart Interval, Skip Tops (true when added; not sent otherwise, and then Short.io returns the top lists) |
| Get Link Statistics by Interval | **Clicks Chart Interval**: Hour, Day (default), Week or Month |
| Get Link Top Values | **Column** and **Limit** (default 50). Short.io's own endpoint for this doesn't work, so it's computed from Get Domain Top Values filtered to the link's path: one extra request, and no **Prefix** (it wouldn't mean anything once the query is already scoped to a single path). |
| Get Raw Clicks | Raw click log for a domain (most recent clicks; Short.io does not document the sort order). **Limit** defaults to 50. |

See [Statistics notes](#statistics-notes) for the shared Period, Timezone and Filters parameters.

## Trigger

**Short.io Trigger** is a polling trigger for one **Domain**, with two events:

- **New Link**: emits links created since the last poll, oldest first. Each poll reads up to
  1,500 links (10 pages of 150); a larger backlog is emitted over the following polls. A link
  created with a backdated **Created At** earlier than the last poll's mark is not emitted, since
  the mark only ever moves forward.
- **New Click**: emits raw clicks recorded since the last poll, up to 2,000 clicks (20 pages of
  100) per poll. A burst larger than that is capped: older clicks from the same burst are skipped
  and a warning is logged, rather than delaying the whole poll further.

On first activation, the trigger stores a high-water mark and emits nothing; later polls emit
only newer items. The mark is kept per event and is reset when the Domain changes; switching
back to an earlier domain doesn't restore its old mark. **Fetch Test Event** (manual mode) returns the most recent matching item as a
sample without changing the stored state. The poll interval is set in the node's **Poll Times**.

## Example workflows

Import any of these from
[`examples/`](https://github.com/t0mer/n8n-nodes-shortio/tree/main/examples) with
**Workflows → Import from File**. The domain ID `123456`, the spreadsheet ID, channels and email
addresses are placeholders; replace them with your own (or pick your domain from the list).

| File | What it does |
|---|---|
| [`bulk-shorten-from-google-sheets.json`](https://github.com/t0mer/n8n-nodes-shortio/blob/main/examples/bulk-shorten-from-google-sheets.json) | Reads rows from Google Sheets, shortens every URL that has no short link yet with **Create Many** (with UTM tags), and writes the short URL back to the same row. |
| [`new-link-slack-notification.json`](https://github.com/t0mer/n8n-nodes-shortio/blob/main/examples/new-link-slack-notification.json) | Trigger: posts each newly created short link to a Slack channel. A Telegram node works the same way. |
| [`weekly-click-report-email.json`](https://github.com/t0mer/n8n-nodes-shortio/blob/main/examples/weekly-click-report-email.json) | Every Monday, emails the domain's clicks and new links for the last 7 days plus its 10 most-clicked links. |
| [`ai-agent-short-link-tool.json`](https://github.com/t0mer/n8n-nodes-shortio/blob/main/examples/ai-agent-short-link-tool.json) | An AI Agent (OpenAI chat model) that uses the node as two tools: one creates short links, the other reports a link's clicks. |

## Bulk operations

| Operation | Chunk size | Pacing |
|---|---|---|
| Create Many | Up to 1000 links per call | 5 calls / 10 s |
| Archive Many / Unarchive Many / Delete Many / Generate QR Codes (Many) | Up to 150 links per call | 1 call / s. Delete Many's limit is documented; the other three hit undocumented 429s (Retry-After up to 24 s) in live testing and are paced the same way as a precaution. |
| Tag Many¹ | Up to 150 links per call | No documented limit |

¹ Short.io documents no maximum for Tag Many; 150 per call is the node's own conservative batch
size, matching the sibling bulk endpoints.

All bulk operations take every input item and split them into chunks of the sizes above. Chunks are
sent one after another, never in parallel.
**Create Many** additionally groups items by domain hostname and folder before chunking, since a
single `POST /links/bulk` call can only carry one domain and one folder: a batch that mixes
folders or domains makes more calls than the chunk size alone implies. **Tag Many** likewise
makes a separate series of calls for each distinct Tag value.

**Create Many is not transactional**: a chunk can partly succeed. With Continue On Fail turned
on, a failed link comes back as an error item mapped to its original input index. Without it, Create
Many throws and lists the failing item indexes, and reports how many links were already created
when earlier calls succeeded. The other bulk operations rethrow a failed chunk's error, tagged with
the chunk's first input index. **Generate QR Codes (Many)** returns one
ZIP file per chunk (not per link), so its output is one binary item per chunk of up to 150 links.

Archive Many, Unarchive Many, Delete Many and Tag Many output one item per input link:
`{ "idString": "…", "success": true }` (plus `tag` for Tag Many).

## Rate limits

Short.io's documented per-endpoint limits:

| Endpoint(s) | Limit |
|---|---|
| Create a link | 50 requests / s |
| Get, Update, Delete, Expand a link | 20 requests / s |
| Create Many (bulk) | 5 requests / 10 s |
| Delete Many (bulk) | 1 request / s |

Other endpoints have no documented limit. On an HTTP 429 response, the node retries automatically
up to 3 attempts in total, honoring the `Retry-After` header (capped at 30 s) when Short.io sends
one and backing off exponentially otherwise.

## Statistics notes

- **Period** accepts `today`, `yesterday`, `total` (All Time), `week`, `month`, `lastmonth`,
  `last7`, `last30` (default) or `custom`. Choosing **Custom** exposes **Start Date** and
  **End Date**.
- **Timezone** is an IANA name (for example `Europe/Berlin`), sent as `tz`. Leave it empty to use
  the workflow's time zone. Short.io's older `tzOffset` parameter is deprecated and is never sent.
  Dates are interpreted in the selected Timezone.
- **Filters** (where the operation supports them) are an include/exclude pair over columns: a
  date range, human-only, countries, browsers, browser versions, social networks, HTTP statuses,
  paths, protocols, methods, referrer hosts, and UTM sources/mediums/campaigns. List fields are
  comma-separated.
- **Column** (the Top Values operations) is one of 18 values: A/B Path, Browser, Browser Version,
  City, Country, Goal Completed, Human, Method, OS, Path (default), Path (404), Protocol,
  Referrer Host, Social, Status, UTM Campaign, UTM Medium, UTM Source.
- **Limit** on the Top Values operations and Get Raw Clicks defaults to 50, with no documented
  maximum.
- Get Raw Clicks' **After Date**/**Before Date** are pagination cursors, not a report window.
  They're ignored when **Period** is **All Time**; use **Period: Custom** (or another preset) to
  page through results.
- Charts (Get Domain/Link Statistics by Interval), the Top Values operations and Get Link Clicks
  count **human clicks only** by default; the plain click totals (`clicks`/`totalClicks` from Get
  Domain/Link Statistics) count all clicks, bots included. <!-- TODO: verify -->

## Output and errors

Each operation returns Short.io's response as JSON, one item per link, target or record. Actions
that return no body (for example Archive or Delete) output `{ "success": true, "idString": "…" }`.

Errors from Short.io are shown as `Short.io error: <message>`, with a hint for the common cases:

| Status | What the node reports |
|---|---|
| 401 / 403 | Check your API key and its domain permissions. |
| 404 | `The <resource> was not found (<message>)` |
| 409 | The requested path is already used by another link on this domain. Choose a different path, or omit it to let Short.io generate one. |
| 429 | `Short.io rate limit exceeded after 3 attempts (<message>)` |

Input problems (an invalid link ID, domain ID, country or region code, an empty tag, or an Update
with no fields) are caught before any request is sent. With **Continue On Fail**, a failed item is
returned as `{ "error": "…" }`, linked to its input item, with `statusCode` added when the
failure was an HTTP error.

## Excluded

These Short.io endpoints and features are intentionally not implemented:

| Item | Reason |
|---|---|
| `POST /links/public` | Public-key endpoint for client-side (browser/mobile) use only |
| `GET /links/tweetbot` | GET-based duplicate of Create that puts the secret key in the query string |
| `GET /links/by-original-url` | Deprecated; replaced by Get by Original URL (`GET /links/multiple-by-url`) |
| Legacy `*.short.cm` hosts and numeric link IDs | Superseded by `*.short.io` hosts and `lnk_…`/`link_…` idStrings |
| `GET /statistics/domain/{id}/paths` (Get Popular Links) | Deprecated; use **Get Domain Top Values** with **Column = Path** for the same data |
| Conversion tracking | Short.io sends conversions with a browser-only `navigator.sendBeacon()` call to your own branded domain; there is no secret-key API endpoint for it |
| Clear Domain Statistics (`DELETE /statistics/domain/{id}/statistics`) | Documented by Short.io but not available on the live API (returns 404 Route not found) |
| Get Domain Top Values by Interval (`POST /statistics/domain/{id}/top_by_interval`) | Documented by Short.io but not available on the live API (returns 404 Route not found) |

## Compatibility

Requires a recent n8n 1.x or later with community nodes enabled. <!-- TODO: verify minimum n8n version -->
Built and tested with Node.js 24. The package has no runtime dependencies.

## Security notes

- Use a secret key with the narrowest team/domain scope your workflows need, and keep it in the
  n8n credential store rather than in node parameters or expressions.
- Delete and Delete Many remove links permanently. Test bulk workflows on a small set of links, or
  a test domain, before running them on production data.
- Trigger and statistics output can contain visitor data such as IP addresses and user agents.
  Handle it according to your privacy obligations.

## Usage terms

Use of this node is subject to [Short.io's Terms of Service](https://short.io/terms) and the
limits of your [Short.io plan](https://short.io/pricing) (for example link, domain and API quotas,
and which features such as targeting or permissions your plan includes). See the
[Short.io API documentation](https://developers.short.io/) for the full reference this node is
built against.

This is an unofficial community project. It is not affiliated with, endorsed by, or supported by
Short.io. Report problems with the node on
[GitHub](https://github.com/t0mer/n8n-nodes-shortio/issues), not to Short.io support.

## Development

Requires Node.js 24.

```bash
git clone https://github.com/t0mer/n8n-nodes-shortio.git
cd n8n-nodes-shortio
npm ci
npm run lint    # n8n-node lint
npm run build   # compile to dist/
npm test        # vitest unit tests (no live API calls)
npm run dev     # start a local n8n with the node loaded
```

Project layout:

| Path | Contents |
|---|---|
| `credentials/` | The Short.io API credential |
| `nodes/ShortIo/` | The action node: one folder per resource under `resources/` |
| `nodes/ShortIoTrigger/` | The polling trigger |
| `shared/` | HTTP transport and retries, bulk chunking, pagination, locators, field builders |
| `tests/` | Unit tests |
| `examples/` | Importable example workflows |

Releases are published to npm from a `YYYY.M.PATCH` git tag by the
[publish workflow](https://github.com/t0mer/n8n-nodes-shortio/blob/main/.github/workflows/publish.yml),
with npm provenance.

## Contributing

Issues and pull requests are welcome on
[GitHub](https://github.com/t0mer/n8n-nodes-shortio). Please run `npm run lint`, `npm run build`
and `npm test` before opening a pull request.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Short.io API documentation](https://developers.short.io/)
- [Short.io API key setup](https://developers.short.io/docs/creating-an-api-key)
- [Changelog](https://github.com/t0mer/n8n-nodes-shortio/blob/main/CHANGELOG.md)

## Version history

Versions follow `YYYY.M.PATCH`, set from the git tag at publish time.

- **2026.9.1**: No functional changes; release-pipeline update only.
- **2026.9.0**: Initial release: the Short.io node (Domain, Folder, Link, Link Country
  Targeting, Link OpenGraph, Link Permission, Link Region Targeting, Statistic) and the Short.io
  Trigger (New Link, New Click).

## License

[MIT](https://github.com/t0mer/n8n-nodes-shortio/blob/main/LICENSE)
