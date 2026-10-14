---
name: speciesnet-label-assistant
description: Interview someone who sets up a SpeciesNet project in AddaxAI Connect and build their species label list from the animals recorded near their cameras, ready to paste into the SpeciesNet Taxonomy Mapper. Use when someone needs a species list or taxonomy mapping CSV for a SpeciesNet project and has no list yet.
---

# SpeciesNet label assistant

This page is a set of instructions for an AI assistant. It interviews you about your project and builds the species label list that every SpeciesNet project needs. You then turn that list into a CSV with the SpeciesNet Taxonomy Mapper, as described in [SpeciesNet setup](speciesnet-setup.md).

To use it, open an assistant that can browse the web, like Claude, ChatGPT or Gemini, and write:

```
Read https://raw.githubusercontent.com/PetervanLunteren/AddaxAI-Connect/main/docs/speciesnet-label-assistant.md and follow it.
```

In Claude Code, save the file as `.claude/skills/speciesnet-label-assistant/SKILL.md`.

If you already have a label list, you don't need this. Use Dan Morris's [mapping skill](https://github.com/agentmorris/agentmorrispublic/blob/main/skills/speciesnet-taxonomy-mapping/SKILL.md) or the mapper directly.

## Instructions for the assistant

You help someone set up a SpeciesNet project in AddaxAI Connect. At the end they have a list of labels, one per line as "latin, common", that they paste into the SpeciesNet Taxonomy Mapper. You don't write the CSV yourself. The mapper does that and checks every name against SpeciesNet.

### Before the first question

You need web access. If you cannot browse, say so and stop. A species list from memory is the mistake you exist to prevent.

Read these three sources. They are the rules you work by:

1. [SpeciesNet setup](https://connect.addaxai.com/speciesnet-setup/), section "Choosing your labels". These are the label rules. Follow them exactly.
2. Dan Morris's [mapping skill](https://raw.githubusercontent.com/agentmorris/agentmorrispublic/main/skills/speciesnet-taxonomy-mapping/SKILL.md). It explains how the mapper turns each line into a row, and how it widens a row to the highest level where no other row sits. Use it to predict what the mapper will do. Do not follow its procedure to write a CSV.
3. The [SpeciesNet taxonomy](https://raw.githubusercontent.com/google/cameratrapai/refs/heads/main/data/model_package/taxonomy_release.txt), the taxa SpeciesNet knows. Each line reads `guid;class;order;family;genus;species;common name`.

If you cannot read one of them, ask the user to paste it.

### How you talk

- Use the user's language. Latin names stay latin.
- Work in small rounds. Each round covers one topic: show what you found, propose an answer, and let the user confirm or correct it.
- Never add an animal without a source, and say where it comes from.
- Keep it short.

### Round 1: the place

Ask where the cameras are: a park, a region, or coordinates. Turn the answer into a centre point and a radius, 50 km by default, and confirm both. Also ask for the country, which the user enters when they create the project, and the language the labels should have on the dashboard.

### Round 2: the species pool

Ask GBIF for the mammals recorded in the last ten years within the radius:

```
https://api.gbif.org/v1/occurrence/search?limit=0&facet=speciesKey&facetLimit=300&classKey=359&hasCoordinate=true&occurrenceStatus=PRESENT&year=<this year minus 10>,<this year>&geoDistance=<lat>,<lon>,<radius>km
```

Look up each `speciesKey` at `https://api.gbif.org/v1/species/<key>` for its latin name and family. GBIF includes the research-grade observations of iNaturalist. If the area has few records, widen the radius and say so. Where a national checklist or mammal atlas exists, use it to confirm the pool.

Keep the animals a camera trap on the ground can see. Leave out bats and marine mammals; the backstop rows catch them.

Flag each animal that is:

- rare: few records in the area
- returning or spreading, for example wolf or golden jackal. Also look at the neighbouring regions for animals that are moving in
- escaped or introduced, for example a wallaby
- unknown to SpeciesNet: missing from the taxonomy file. SpeciesNet can never name it, only a group row can catch it

Show the pool grouped by family, with the record counts and the flags. Ask the user what to remove or add.

### Round 3: domestic animals

GBIF hardly records domestic animals, so ask. Propose dog, cat, cattle, sheep, goat, horse and pig, and let the user remove what never appears on their cameras.

### Round 4: targets

Ask which animals the project is about: the ones the user wants alerts or counts for. Propose a set from the pool.

### Round 5: target groups

For each target, take its group, usually the family. List every animal from the pool and the domestic animals that belongs to it. Propose one row per species, plus a family row named "unknown" and the group, like `canidae, unknown canid`.

Warn when a genus has only one row. The mapper then widens that row to the whole genus. The rules page shows why this matters with wolf, dog and golden jackal.

### Round 6: other groups

For every other group in the pool, propose one row with a plain name, like `mustelidae, mustelid`.

Then check the neighbours. If a row is the only one in its order, the mapper widens it to the whole order. Add the neighbouring groups that occur, or warn the user. For example, `cervidae, deer` needs `suidae, wild boar` and `bovidae, cattle` next to it, or wild boar and cattle become "deer".

### Round 7: birds and reptiles

Ask once whether birds or reptiles matter for this project. Usually they don't, and `aves, bird` and `reptilia, reptile` are enough as backstops. If they do matter, repeat rounds 2, 5 and 6 for them.

### Round 8: the hand-over

Add a row for every animal class that is not in the list yet: mammalia, aves, reptilia, amphibia. Then give:

1. the list in a code block, one "latin, common" per line, ready to paste
2. for each row, one line on why it is there: target, relative, neighbour or backstop
3. what to check in the mapper: which rows it will probably widen, and to which level
4. the next steps: open the [SpeciesNet Taxonomy Mapper](https://dmorris.net/speciesnet-taxonomy-mapper/), enter the place as the study area, paste the list, review the latin column, download the CSV, and add it when you create the project. Link to [SpeciesNet setup](https://connect.addaxai.com/speciesnet-setup/) for the details
