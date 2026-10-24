"""Build the offline ECDICT lookup index used by selection translation.

Usage: python scripts/build_dictionary.py <ecdict.csv> <output.db>
ECDICT (MIT, https://github.com/skywind3000/ECDICT) ships as a ~66 MB CSV;
this keeps entries that have a Chinese translation and indexes them by
lower-cased headword so lookups are a single primary-key read.
"""
import csv
import sqlite3
import sys
from pathlib import Path


def main(source: Path, target: Path):
    csv.field_size_limit(10_000_000)
    tmp = target.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.execute("""create table words (key text primary key, word text, phonetic text, translation text,
                  tag text, collins integer, oxford integer, bnc integer, frq integer, exchange text)""")
    rows, kept = 0, {}
    with source.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            rows += 1
            word, translation = row["word"].strip(), row["translation"].strip()
            if not word or not translation:
                continue
            key = word.lower()
            # Prefer the capitalisation-exact lower-case headword over proper-noun variants.
            if key in kept and kept[key]["word"] == key:
                continue
            kept[key] = {"word": word, "phonetic": row["phonetic"], "translation": translation.replace("\\n", "\n"),
                         "tag": row["tag"], "collins": int(row["collins"] or 0), "oxford": int(row["oxford"] or 0),
                         "bnc": int(row["bnc"] or 0), "frq": int(row["frq"] or 0), "exchange": row["exchange"]}
    db.executemany("insert into words values (?,?,?,?,?,?,?,?,?,?)",
                   ((k, v["word"], v["phonetic"], v["translation"], v["tag"], v["collins"], v["oxford"],
                     v["bnc"], v["frq"], v["exchange"]) for k, v in kept.items()))
    db.commit()
    db.execute("vacuum")
    db.close()
    tmp.replace(target)
    print(f"read {rows} rows, indexed {len(kept)} headwords -> {target} ({target.stat().st_size // 1_000_000} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
