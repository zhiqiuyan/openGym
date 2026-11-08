# Copyright and licence — HarmonyOS edition

This directory holds the HarmonyOS packaging of openGym (the ArkTS Web shell,
build configuration and tooling). It carries the same licence and notices as the
source repository, [zhiqiuyan/openGym](https://github.com/zhiqiuyan/openGym),
a fork of [openGym](https://github.com/DuarteSantos8/openGym) by Duarte Santos.
The sections below describe that source repository.

The ArkTS sources, the Capacitor-compatible shims in
`frontend/src/lib/harmony/`, the translation work and the build tooling in
`tools/` are offered under the same AGPL v3.0 licence. No copyright is claimed
over the upstream code, the openGym name or marks, or the exercise media.

The media staged under `entry/src/main/resources/rawfile/` by
`tools/sync-web.mjs` are licensed for use inside openGym only; they are build
artefacts and must not be committed to a public repository or redistributed on
their own. The compiled HAP is distributed unsigned and is not published as a
binary release.

## Upstream work

openGym — Copyright (C) 2026 Duarte Santos.

The original code is licensed under the **GNU Affero General Public License,
version 3** (see [LICENSE](LICENSE)). Third-party notices — the app-store
exception, the MuscleMap MIT notice, and the exercise-media attribution and
restrictions — are collected in [NOTICE.md](NOTICE.md).

## Changes in this fork

The changes present here (Simplified and Traditional Chinese exercise
instructions and descriptions, DeepSeek and free-form custom-model support for
the AI coach, a separate version line and update channel for the HarmonyOS
edition starting at 1.0.0, the redesigned About & updates page, and the light
theme fixes) are contributions to the same AGPL v3.0 work and are offered under
that same licence.

No copyright is claimed over the upstream code, the openGym name or marks, or
the exercise media. Attribution to the upstream author is retained in
NOTICE.md and in the app's About screen.

## HarmonyOS edition

The HarmonyOS package is a separate build of the same AGPL v3.0 application,
with its own version number and update page. It is distributed unsigned; each
recipient signs it locally before installing. The package is not published as
a binary release from this repository.

## Exercise media — important

Exercise media © Aliaksandr Makatserchyk, Gym visual, gymvisual.com.
The media are licensed for use **inside openGym only**. The licence does not
permit extracting them from the application or reusing them in other apps,
websites or products; as NOTICE.md states, a fork used for commercial purposes
needs its own licence from gymvisual.com. The files under `catalogue/media/`
are present because they are tracked by the upstream repository; they are not
re-licensed by this fork, and the HarmonyOS build's local `rawfile/` copy is
generated at build time and must not be committed or redistributed separately.

## No endorsement

This fork is not affiliated with or endorsed by Duarte Santos or Gym visual.
