#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def main():
    parser = argparse.ArgumentParser(description="Generate Jira-importable CSV files from backlog.json")
    parser.add_argument("--in", dest="in_path", default="planning/jira/backlog.json")
    parser.add_argument("--epics-out", default="planning/jira/epics.csv")
    parser.add_argument("--tickets-out", default="planning/jira/tickets.csv")
    args = parser.parse_args()

    data = json.loads(Path(args.in_path).read_text(encoding="utf-8"))
    epics = data.get("epics", [])
    tickets = data.get("tickets", [])

    epic_fields = ["Epic Key", "Summary", "Description", "Owner", "Priority", "Labels"]
    ticket_fields = [
        "Ticket Key",
        "Epic Key",
        "Summary",
        "Description",
        "Owner",
        "Estimate",
        "Priority",
        "Sprint",
        "Dependencies",
        "Labels",
        "Acceptance Criteria"
    ]

    write_csv(Path(args.epics_out), epics, epic_fields)
    write_csv(Path(args.tickets_out), tickets, ticket_fields)


if __name__ == "__main__":
    main()
