"""Rehearse the legacy timeline migration from private exports, without network access."""

import argparse
import csv
import hashlib
import json
import os
import tempfile
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from zipfile import ZipFile

from openpyxl import load_workbook


PUBLIC = ("event_id", "date", "precise", "event", "people", "type", "size")
PRIVATE = (
    "hide", "source", "submitted_at", "submission_id", "contributor_name", "contributor_email",
)
SOURCES = {
    "master": ("Timeline", "legacy_master"),
    "milestones": ("Form Responses 3", "legacy_submission"),
}
NAMESPACE = uuid.UUID("a1477ba6-891a-4ec2-b945-5688ee42d2f7")


def sheet_rows(book, tab, required):
    rows = iter(book[tab].values)
    headers = [str(v or "").strip() for v in next(rows)]
    named = [name for name in headers if name]
    if not set(required).issubset(named) or len(named) != len(set(named)):
        raise ValueError(f"Review headers on {tab}.")
    for number, values in enumerate(rows, 2):
        if any(v is not None and v != "" for v in values):
            yield number, dict(zip(headers, values))


def milestone_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(value, "%m/%d/%Y").date()


def public_values(row):
    day = milestone_date(row["date"])
    precise = row.get("precise") or "Y"  # The legacy UI omits the day only for N.
    size = row.get("size") or "m"
    if day < date(1971, 1, 1) or precise not in ("Y", "N") or size not in ("s", "m", "l"):
        raise ValueError("Review date, precision, or size.")
    if row["type"] not in ("event", "intro", "move", "trip") or not row["people"] or not row["event"]:
        raise ValueError("Review type, people, or description.")
    return [day.isoformat(), precise, row["event"], row["people"], row["type"], size]


def submitted_at(value, zone):
    if value is None:
        return None
    if not isinstance(value, datetime) or value.tzinfo:
        raise ValueError("Review legacy form timestamp.")
    local = value.replace(tzinfo=zone)
    if local.utcoffset() != local.replace(fold=1).utcoffset():
        raise ValueError("Review ambiguous or missing local time.")
    utc = local.astimezone(timezone.utc)
    return (utc - datetime(1899, 12, 30, tzinfo=timezone.utc)).total_seconds() / 86400


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()


def rehearse(folder, form_zone):
    counts = Counter()
    rows, crosswalk, ids = [], [], set()
    for stem, (tab, origin) in SOURCES.items():
        path = folder / f"{stem}.xlsx"
        # The owner may hide a curated master row in the Sheet itself.
        # Read row visibility separately from cached, formula-derived milestone dates.
        book = load_workbook(path, data_only=True)
        try:
            required = ["date", "event", "people", "type", "precise", "contributor"]
            required += ["hide", "email", "Timestamp"] if stem == "milestones" else ["size"]
            expected = []
            for number, row in sheet_rows(book, tab, required):
                counts[stem] += 1
                flag = row.get("hide")
                if flag not in (None, "", "Y", "N"):
                    raise ValueError(f"Unknown visibility at {stem} row {number}.")
                if stem == "master" and (flag == "Y" or book[tab].row_dimensions[number].hidden):
                    counts["master_held_for_visibility_review"] += 1
                    continue
                if stem == "milestones" and flag == "Y":
                    counts["excluded_hidden_submissions"] += 1
                    try:
                        if milestone_date(row.get("date")) == date(1970, 5, 31):
                            counts["hidden_with_spam_date"] += 1
                    except (TypeError, ValueError):
                        pass  # An excluded response may contain an invalid date.
                    continue
                try:
                    public = public_values(row)
                    stamp = submitted_at(row.get("Timestamp"), form_zone)
                except (ValueError, TypeError):
                    raise ValueError(f"Review {stem} row {number} before migration.") from None
                # Prefer the original form response timestamp. For rows without
                # one, use the original public data. Preserve this first mapping
                # at cutover when an owner has since edited identifying fields.
                key = ["timestamp", stamp] if stamp is not None else ["snapshot", public]
                event_id = str(uuid.uuid5(NAMESPACE, origin + ":" + digest(key)))
                if event_id in ids:
                    raise ValueError(f"Ambiguous legacy identity at {stem} row {number}.")
                ids.add(event_id)
                counts[origin] += 1
                counts["approximate"] += public[1] == "N"
                counts["defaulted_precision"] += not row.get("precise")
                counts["submissions_without_timestamp"] += stem == "milestones" and stamp is None
                rows.append([event_id, *public, "N", origin, stamp, None,
                             row.get("contributor"), row.get("email")])
                crosswalk.append([origin, number, digest(public), event_id])
                expected.append(public)
            if stem == "master":
                counts["uncategorized_archived"] = sum(
                    1 for _ in sheet_rows(book, "Uncategorized", ["event"]))
        finally:
            book.close()
        with (folder / f"{stem}-published.csv").open(encoding="utf-8-sig", newline="") as f:
            published = [public_values(r) for r in csv.DictReader(f)
                         if r["date"] and r["event"] and (stem == "master" or r["hide"] != "Y")]
        if expected != published:
            raise ValueError(
                f"{stem} differs from the current feed. Review the snapshot and the "
                f"{counts['master_held_for_visibility_review']} held master row(s)."
            )
    edits = load_workbook(folder / "edits.xlsx", read_only=True, data_only=True)
    try:
        counts["edit_responses_archived"] = sum(
            1 for _ in sheet_rows(edits, "Form Responses 1", ["Timestamp", "What needs to be updated?"]))
    finally:
        edits.close()
    counts["public_rows"] = len(rows)
    counts["unique_event_ids"] = len(ids)
    counts["master_held_for_visibility_review"] += 0
    counts["repeated_public_rows"] = len(rows) - len({tuple(r[1:7]) for r in rows})
    emails = {r[12].strip().casefold() for r in rows if r[12] and "@" in r[12]}
    counts["public_rows_containing_contributor_email"] = sum(
        any(email in " ".join(r[:7]).casefold() for email in emails) for r in rows
    )
    inputs = [folder / filename for filename in (
        "master.xlsx", "milestones.xlsx", "edits.xlsx", "master-published.csv", "milestones-published.csv")]
    for p in inputs[:3]:
        with ZipFile(p) as archive:
            if archive.testzip():
                raise ValueError(f"Damaged backup: {p.name}")
    return {
        "source_headers": PUBLIC + PRIVATE, "public_headers": PUBLIC,
        "input_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
        "counts": dict(counts), "rows": rows, "crosswalk": crosswalk,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot_directory", type=Path)
    parser.add_argument("--form-time-zone", required=True, help="Time zone of the add-response Sheet")
    args = parser.parse_args()
    folder = args.snapshot_directory.resolve()
    if folder.stat().st_mode & 0o077:
        parser.error("Use an owner-only snapshot directory.")
    result = rehearse(folder, ZoneInfo(args.form_time_zone))
    # Keep the original identity crosswalk alongside its frozen inputs.
    output = folder / "rehearsal.json"
    if output.exists() and json.loads(output.read_text())["input_sha256"] != result["input_sha256"]:
        parser.error("These inputs have changed. Use a new snapshot directory and reconcile IDs.")
    f = tempfile.NamedTemporaryFile(dir=folder, mode="w", delete=False)
    try:
        with f:
            json.dump(result, f, ensure_ascii=False)
        os.replace(f.name, output)
    finally:
        Path(f.name).unlink(missing_ok=True)
    print(json.dumps(result["counts"], indent=2))


if __name__ == "__main__":
    main()
