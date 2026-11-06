# Copyright and licence

This repository is a fork of [openGym](https://github.com/DuarteSantos8/openGym)
by Duarte Santos. It is published so the HarmonyOS adaptation and its
translations can be built and reviewed in the open.

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
recipient signs it locally before installing. Each version is attached to its
own immutable GitHub Release (`harmony-vX.Y.Z`) as a binary asset, together
with SHA256 checksums; binaries are never committed to the git tree.

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
