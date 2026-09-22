#!/usr/bin/env python3
"""
Strip superseded stock content out of an OggDude dataset export before importing
it into Foundry.

The problem this solves: OggDude will not let you delete a stock specialization
or Force power, only shadow it with a new one. A dataset that has been "respec'd"
therefore exports both copies, and the Foundry importer faithfully imports both.

The discriminator is OggDude's own <Custom> element, which it writes into every
record in a DataCustom export:

    AddedItem   - a record you created. Always kept.
    CustomItem  - a stock record you edited.
    DescOnly    - a stock record where only the description was edited.

"Stock" alone is not enough to drop something, because plenty of stock specs have
no replacement yet. So a specialization is dropped only when all three hold:

    1. <Custom> is CustomItem or DescOnly (it is stock), and
    2. no Career in the dataset still lists its <Key> (the career has been
       repointed at your replacement), and
    3. it is not <Universal>true</Universal> (universal specs belong to no career,
       so rule 2 can never clear them).

Force powers are attached to no career, so they are matched by name instead: a
stock power is dropped when an AddedItem power exists whose name is the same once
"(Respec)" and whitespace are removed.

Talents and signature abilities are never touched - they are not duplicated, and
the surviving trees reference them by key.

Usage:
    python tools/oggdude-strip-originals.py INPUT.zip [OUTPUT.zip] [--dry-run]

With no OUTPUT, writes alongside INPUT as "<name> (filtered).zip".
"""

import argparse
import collections
import re
import sys
import zipfile

STOCK = {"CustomItem", "DescOnly"}

# Keys dropped regardless of the rules above, for replacements that were renamed rather than
# suffixed, so no name match can find them. Keep in sync with ALWAYS_DROP in
# modules/importer/oggdude/superseded-filter.js.
ALWAYS_DROP = {
    "WARFOR",  # Warde's Foresight -> replaced by Insight (Respec)
    "IMBUE",   # Imbue -> merged into Imbue/Exhaust (Respec), so the names no longer match
}


def text(zf, name):
    return zf.read(name).decode("utf-8-sig", errors="replace")


def tag(xml, name):
    m = re.search(r"<%s>(.*?)</%s>" % (name, name), xml, re.S)
    return m.group(1).strip() if m else None


def first_key(xml):
    """The record's own <Key>, which is always the first one in the file."""
    m = re.search(r"<Key>(.*?)</Key>", xml)
    return m.group(1).strip() if m else None


def normalize(name):
    """'Ebb / Flow (Respec)' and 'Ebb/Flow' both collapse to 'ebb/flow'."""
    name = re.sub(r"\(respec[^)]*\)", "", name, flags=re.I)
    return re.sub(r"\s+", "", name).lower()


def career_spec_keys(zf):
    keys = set()
    for entry in zf.namelist():
        if "/Careers/" not in entry or not entry.lower().endswith(".xml"):
            continue
        block = re.search(r"<Specializations>(.*?)</Specializations>", text(zf, entry), re.S)
        if block:
            keys.update(k.strip() for k in re.findall(r"<Key>(.*?)</Key>", block.group(1)))
    return keys


def plan(zf):
    """Return {entry name: reason} for every file that should be dropped."""
    referenced = career_spec_keys(zf)
    drops = {}
    kept = collections.Counter()

    for entry in zf.namelist():
        if "/Specializations/" not in entry or not entry.lower().endswith(".xml"):
            continue
        xml = text(zf, entry)
        custom, name, key = tag(xml, "Custom"), tag(xml, "Name"), first_key(xml)
        if key in ALWAYS_DROP:
            drops[entry] = ("specialization", name, key, custom)
        elif custom not in STOCK:
            kept["authored"] += 1
        elif key in referenced:
            kept["still on a career"] += 1
        elif tag(xml, "Universal") == "true":
            kept["universal"] += 1
        else:
            drops[entry] = ("specialization", name, key, custom)

    powers = {}
    for entry in zf.namelist():
        if "/Force Powers/" not in entry or not entry.lower().endswith(".xml"):
            continue
        xml = text(zf, entry)
        powers[entry] = (tag(xml, "Custom"), tag(xml, "Name"), first_key(xml))

    replaced = {normalize(n) for c, n, _ in powers.values() if c not in STOCK and n}
    for entry, (custom, name, key) in powers.items():
        if key in ALWAYS_DROP or (custom in STOCK and name and normalize(name) in replaced):
            drops[entry] = ("force power", name, key, custom)
        else:
            kept["authored" if custom not in STOCK else "no replacement"] += 1

    return drops, kept


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output", nargs="?")
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would be dropped and write nothing")
    args = ap.parse_args(argv)

    out = args.output
    if not out:
        out = re.sub(r"\.zip$", "", args.input, flags=re.I) + " (filtered).zip"

    with zipfile.ZipFile(args.input) as zf:
        drops, kept = plan(zf)

        for kind in ("specialization", "force power"):
            rows = sorted((v[1] or "?", v[3], v[2]) for v in drops.values() if v[0] == kind)
            print("\nDropping %d %s%s:" % (len(rows), kind, "" if len(rows) == 1 else "s"))
            for name, custom, key in rows:
                print("  %-34s %-11s %s" % (name, custom, key))

        print("\nKept: " + ", ".join("%d %s" % (n, r) for r, n in sorted(kept.items())))

        if args.dry_run:
            print("\nDry run - nothing written.")
            return 0

        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as of:
            for info in zf.infolist():
                if info.filename in drops:
                    continue
                of.writestr(info, zf.read(info.filename))

    print("\nWrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
