---
title: Publish and maintain plugins
lastVerified: 2026-10-09
---
# Publish and maintain plugins

Workshop currently has no account-based upload, payment, rating or automatic review service. Share package files, maintain a static catalog, or request official listing. Source repositories, installable packages and catalogs serve different purposes: maintenance, installation, and discovery/download respectively.

## Prepare a release

Provide the package and SHA-256, ID/version, API/SDK and tested host commit, author/license, exact dependencies, instructions/screenshots, source location, release notes and feedback route. Explain model, network, credential or local-program requirements, storage ownership and what remains after uninstall.

Verify independent installation, reload, work isolation, disabling/re-enabling, uninstall/reinstall, backup round trips, upgrades and recovery. Test dependencies, replacements, AI and external services where applicable. Exclude manuscripts, API keys, local absolute paths and private test backups from release material.

## Route one Share the package

1. Follow the [development guide](./develop) to build `.sfplugin`; retain the digest printed by `pack`.
2. Host the package at your chosen download location or share it through your chosen channel with instructions and its digest.
3. Users download the original bytes, use **从文件安装**, select a work/world and enable. Provide exact dependency packages where needed.

No catalog server is required. A source ZIP may accompany the package but must be labeled “development source, not installable”. SHA-256 verifies byte identity; it is not an author signature or security-review certificate.

## Route two Maintain a community catalog

Host `catalog.json` and package files at a static HTTPS location you control:

```text
catalog.json
packages/yourname.chapter-checklist-0.1.0.sfplugin
```

Replace fields in this template with the actual manifest values and replace `digest` with the 64-character lowercase hexadecimal hash printed by packaging. Placeholder text cannot be installed.

```json
{
  "format": 1,
  "name": "My plugin catalog",
  "entries": [{
    "id": "yourname.chapter-checklist",
    "version": "0.1.0",
    "name": "Chapter checklist notes",
    "description": "Save chapter revision notes for the current work",
    "author": "Your name",
    "kind": "feature",
    "owner": "work",
    "url": "packages/yourname.chapter-checklist-0.1.0.sfplugin",
    "digest": "REPLACE_WITH_ACTUAL_64_CHARACTER_SHA256",
    "dependencies": {}
  }]
}
```

All exact dependencies should appear in the same catalog. Package URLs may be relative to the catalog. Endpoints must return file bytes directly, without login pages or redirects. Both catalog and package hosting must permit cross-origin reads (CORS) from StoryForge. Same-origin local application catalogs may use the current HTTP address; external catalogs require HTTPS.

Enter the full JSON URL in Workshop's community catalog field, click **读取目录**, and verify download, dependency installation and enabling. Opening a URL in a separate browser tab does not prove CORS works. Catalogs are limited to 1 MB / 1,000 entries; package limits are in the contract.

## Route three Request official listing

Create a PR in the [StoryForge repository](https://github.com/yuanbw2025/storyforge), targeting `main`. First confirm your host includes [PR #113](https://github.com/yuanbw2025/storyforge/pull/113), and state the tested host commit and API/SDK versions.

Append accurate metadata to `entries` in `public/workshop/catalog.json`, preserving existing entries. Prefer an immutable HTTPS file you control. Include source, license, screenshots, tested versions, dependencies, network capabilities, migration and acceptance results. Maintainers review permission, functionality, data behavior and distribution before deciding whether to list it. A PR is an application, not an automatic publication promise.

Rebuilding official examples preserves community catalog entries. Maintainers should review the catalog diff and dependency availability before accepting a submission; the generator is not a trust or content review.

If you cannot open a PR, submit [feature feedback](/en/feedback/feature) with the purpose, source and download URL and ask for assistance. Never include credentials or private manuscripts in public feedback.

## Release an update

Keep the ID stable and increment `x.y.z`. Published bytes for an existing version must remain unchanged. Even a text-only edit requires a new version and digest. Retain old packages so older works can recover.

Data-shape changes require a higher schema version and pure-data migration. Supply successful, failing and recovery cases. Do not change a schema definition under the same version. Lock exact dependency versions and verify bundles together. Workshop does not update in the background, run migrations or enable upgrades automatically.

Explain how to disable consumers, switch the provider version and reinstall compatible consumers. Never tell users to delete browser databases to upgrade. If a release is faulty, announce affected versions and recovery steps while preserving data; do not hide the problem by replacing same-version files.
