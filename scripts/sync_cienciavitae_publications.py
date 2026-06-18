#!/usr/bin/env python3
"""Sync publications from public Ciencia Vitae and ORCID records into site-data.json.

The script updates only the publications items array. Existing manual entries are
preserved unless they match a Ciencia Vitae DOI/title, in which case status,
year, DOI link, and source metadata are refreshed from the CV data.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path


DEFAULT_CV_URL = "https://www.cienciavitae.pt//F712-C83E-0EXX"
DEFAULT_ORCID_ID = "0000-0003-0001-18XX"
ORCID_API_BASE = "https://pub.orcid.org/v3.0"
DEFAULT_DATA_PATH = Path("assets/data/site-data.json")
SOURCE = "cienciavitae"
ORCID_SOURCE = "orcid"
PHYSIO_TWIN_TITLE = "Physio-Digital Twin for Human-Centered IoT Mobility: A Proof-of-Concept Implementation on the MariaBike Platform"
PHYSIO_TWIN_DOI = "10.1145/3803291.3803295"
PHYSIO_TWIN_VENUE = "2026 The 9th International Conference on Information and Computer Technologies (ICICT 2026), Honolulu-Hawaii"
PHYSIO_TWIN_AUTHORS = "Syed Tahir Ali Shah, J.P. Santos, Gabriel Constantinescu, Jos\u00e9 M. Fernandes, A.B. Pereira."
PHYSIO_TWIN_NOTE = "Best Paper Award; corresponding author: Syed Tahir Ali Shah."
PHYSIO_TWIN_CERTIFICATE_ID = "best-paper-jps-2026"
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data)

    def text(self) -> str:
        text = html.unescape(" ".join(self.parts))
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r"\n\s+", "\n", text)
        return text


def fetch_url(url: str, accept: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 publication-sync/1.0",
        "Accept": accept,
    }

    response = None
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = urllib.request.urlopen(
                urllib.request.Request(url, headers=headers),
                timeout=40,
            )
            break
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, ssl.SSLCertVerificationError):
                print(
                    "Warning: certificate verification failed, retrying with an unverified SSL context.",
                    file=sys.stderr,
                )
                try:
                    response = urllib.request.urlopen(
                        urllib.request.Request(url, headers=headers),
                        timeout=40,
                        context=ssl._create_unverified_context(),
                    )
                    break
                except urllib.error.URLError as retry_exc:
                    last_error = retry_exc
            else:
                last_error = exc

            if attempt < 2:
                time.sleep(2 * (attempt + 1))

    if response is None:
        if last_error:
            raise last_error
        raise RuntimeError(f"Unable to fetch {url}")

    with response:
        content = response.read()
        charset = response.headers.get_content_charset() or "utf-8"

    return content.decode(charset, errors="replace")


def fetch_html(url: str) -> str:
    return fetch_url(url, "text/html,application/xhtml+xml")


def fetch_json(url: str) -> dict:
    return json.loads(fetch_url(url, "application/json"))


def fragment_text(fragment: str) -> str:
    parser = TextExtractor()
    parser.feed(fragment)
    return parser.text()


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" .\n\t")


def extract_year(text: str) -> int:
    years = [int(value) for value in re.findall(r"\b(19\d{2}|20\d{2})\b", text)]
    return max(years) if years else 0


def doi_url(doi: str | None) -> str | None:
    if not doi:
        return None
    return f"https://doi.org/{doi}"


def doi_from_text(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"(10\.\d{4,9}/[^\s\"'<>}]+)", text, flags=re.I)
    if not match:
        return None
    return clean(match.group(1).rstrip(" ."))


def normalize_key(value: str) -> str:
    value = re.sub(r"https?://(?:dx\.)?doi\.org/", "", value, flags=re.I)
    value = re.sub(r"https?://zenodo\.org/doi/", "", value, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def canonical_title(title: str) -> str:
    title = clean(title)
    key = normalize_key(title)
    is_physio_twin = (
        "physiodigitaltwinforhumancenterediotmobility" in key
        and "proofofconceptimplementation" in key
        and ("mariabikeplatform" in key or "ebikeplatform" in key or key.endswith("ontheebike"))
    )
    return PHYSIO_TWIN_TITLE if is_physio_twin else title


def apply_publication_overrides(publication: dict) -> dict:
    if canonical_title(publication.get("title", "")) != PHYSIO_TWIN_TITLE:
        return publication

    updated = publication.copy()
    updated.update(
        {
            "category": "conference",
            "year": 2026,
            "status": "Published (2026)",
            "statusType": "published",
            "title": PHYSIO_TWIN_TITLE,
            "venue": PHYSIO_TWIN_VENUE,
            "authors": PHYSIO_TWIN_AUTHORS,
            "doi": PHYSIO_TWIN_DOI,
            "url": doi_url(PHYSIO_TWIN_DOI),
            "linkLabel": "Read Article",
            "note": PHYSIO_TWIN_NOTE,
            "certificateId": PHYSIO_TWIN_CERTIFICATE_ID,
        }
    )
    return updated


def publication_doi_keys(item: dict) -> list[str]:
    keys: list[str] = []
    doi = item.get("doi") or ""
    if doi:
        keys.append(normalize_key(str(doi)))
    url = item.get("url") or ""
    doi_match = re.search(r"(10\.\d{4,9}/\S+)", url, flags=re.I)
    if doi_match:
        keys.append(normalize_key(doi_match.group(1)))
    return [key for key in keys if key]


def publication_title_key(item: dict) -> str:
    title = canonical_title(item.get("title") or "")
    return normalize_key(title) if title else ""


def publication_keys(item: dict) -> list[str]:
    keys = publication_doi_keys(item)
    title_key = publication_title_key(item)
    if title_key:
        keys.append(title_key)
    return keys


def section_items(page_html: str, label: str) -> list[str]:
    pattern = re.compile(
        rf"<td>\s*{re.escape(label)}\s*</td>\s*<td[^>]*>(?P<section>.*?)</td>\s*</tr>",
        flags=re.I | re.S,
    )
    match = pattern.search(page_html)
    if not match:
        return []
    return re.findall(r"<li[^>]*>(.*?)</li>", match.group("section"), flags=re.I | re.S)


def div_texts(fragment: str) -> list[str]:
    return [
        clean(fragment_text(value))
        for value in re.findall(r"<div[^>]*>(.*?)</div>", fragment, flags=re.I | re.S)
    ]


def extract_doi(fragment: str) -> str | None:
    hrefs = re.findall(r'href=["\']([^"\']+)["\']', fragment, flags=re.I)
    for href in hrefs:
        doi = doi_from_text(href)
        if doi:
            return doi

    for value in div_texts(fragment) + [fragment_text(fragment)]:
        doi = doi_from_text(value)
        if doi:
            return doi

    return None


def status_from_text(value: str, year: int) -> tuple[str, str]:
    lowered = value.lower()
    if "submetido" in lowered:
        prefix = "Submitted - Open Access" if "acesso aberto" in lowered else "Submitted"
        return f"{prefix} ({year})" if year else prefix, "submitted"
    if "aceite" in lowered:
        return f"Accepted ({year})" if year else "Accepted", "accepted"
    return f"Published ({year})" if year else "Published", "published"


def parse_publications(page_html: str) -> list[dict]:
    publications: list[dict] = []

    for fragment in section_items(page_html, "Artigo em revista"):
        entry = clean(fragment_text(fragment))
        first_quote = entry.find('"')
        title_end = entry.rfind('".')
        if first_quote == -1 or title_end <= first_quote:
            continue

        authors = clean(entry[:first_quote].replace(";", ","))
        title = clean(entry[first_quote + 1 : title_end])
        nested_title = re.search(r'"([^"]+)"$', title)
        if nested_title:
            title = clean(nested_title.group(1))

        tail = entry[title_end + 2 :]
        doi = extract_doi(fragment)
        status_values = [
            value
            for value in div_texts(fragment)
            if re.search(r"submetido|aceite|publicado|acesso", value, flags=re.I)
        ]
        status_text = status_values[-1] if status_values else ""

        venue = tail
        for value in div_texts(fragment):
            venue = venue.replace(value, " ")
        venue = re.sub(r"https?://\S+", " ", venue)
        venue = re.sub(r"10\.\d{4,9}/\S+", " ", venue, flags=re.I)
        venue = clean(venue).strip(":")
        year = extract_year(venue) or extract_year(entry)
        status, status_type = status_from_text(status_text, year)

        publication = {
            "category": "journal",
            "year": year,
            "status": status,
            "statusType": status_type,
            "title": title,
            "venue": venue,
            "authors": authors,
            "url": doi_url(doi),
        }
        if doi:
            publication["doi"] = doi
        if publication["url"]:
            publication["linkLabel"] = "Read Article"
        publication["source"] = SOURCE
        publications.append(apply_publication_overrides(publication))

    return dedupe_publications(publications)


def dict_value(value: dict | None) -> str:
    if not isinstance(value, dict):
        return ""
    return clean(str(value.get("value") or ""))


def nested_value(data: dict, *keys: str) -> str:
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return ""
        current = current.get(key)
    return dict_value(current) if isinstance(current, dict) else clean(str(current or ""))


def clean_title(title: str) -> str:
    title = clean(title)
    nested_title = re.search(r'"([^"]+)"$', title)
    if nested_title:
        return canonical_title(nested_title.group(1))
    return canonical_title(title)


def orcid_work_type_category(work_type: str) -> str:
    if work_type.startswith("conference"):
        return "conference"
    return "journal"


def label_from_type(work_type: str) -> str:
    labels = {
        "journal-article": "Journal Article",
        "conference-paper": "Conference Paper",
        "conference-abstract": "Conference Abstract",
    }
    return labels.get(work_type, clean(work_type.replace("-", " ").title()))


def orcid_publication_year(work: dict) -> int:
    year = nested_value(work, "publication-date", "year")
    return int(year) if year.isdigit() else 0


def orcid_doi(work: dict) -> str | None:
    external_ids = ((work.get("external-ids") or {}).get("external-id")) or []
    for external_id in external_ids:
        if (external_id.get("external-id-type") or "").lower() != "doi":
            continue
        normalized = nested_value(external_id, "external-id-normalized")
        raw_value = clean(external_id.get("external-id-value") or "")
        href = nested_value(external_id, "external-id-url")
        doi = doi_from_text(normalized) or doi_from_text(raw_value) or doi_from_text(href)
        if doi:
            return doi

    citation = (work.get("citation") or {}).get("citation-value")
    return doi_from_text(citation)


def orcid_work_url(work: dict) -> str | None:
    url = nested_value(work, "url")
    if url:
        return url
    return doi_url(orcid_doi(work))


def orcid_authors(work: dict) -> str:
    contributors = ((work.get("contributors") or {}).get("contributor")) or []
    names: list[str] = []
    for contributor in contributors:
        name = nested_value(contributor, "credit-name")
        name = re.sub(r"\s*Corresponding author:.*$", "", name, flags=re.I).strip(" .")
        if name:
            names.append(name)
    return ", ".join(names)


def orcid_publication_from_work(work: dict) -> dict | None:
    title = clean_title(nested_value(work, "title", "title"))
    if not title:
        return None

    work_type = clean(work.get("type") or "")
    year = orcid_publication_year(work)
    venue = nested_value(work, "journal-title") or label_from_type(work_type)
    publication = {
        "category": orcid_work_type_category(work_type),
        "year": year,
        "title": title,
        "venue": venue,
        "authors": orcid_authors(work),
    }
    doi = orcid_doi(work)
    if doi:
        publication["doi"] = doi
    url = orcid_work_url(work)
    if url:
        publication["url"] = url
        publication["linkLabel"] = "Read Article"
    publication["source"] = ORCID_SOURCE
    return apply_publication_overrides(publication)


def preferred_orcid_summary(group: dict) -> dict | None:
    summaries = group.get("work-summary") or []
    if not summaries:
        return None
    return max(summaries, key=lambda summary: int(summary.get("display-index") or 0))


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def parse_orcid_publications(orcid_id: str) -> list[dict]:
    summary = fetch_json(f"{ORCID_API_BASE}/{orcid_id}/works")
    put_codes = [
        str(work_summary.get("put-code"))
        for group in summary.get("group", [])
        if (work_summary := preferred_orcid_summary(group)) and work_summary.get("put-code")
    ]
    publications: list[dict] = []

    for put_code_group in chunks(put_codes, 100):
        details = fetch_json(f"{ORCID_API_BASE}/{orcid_id}/works/{','.join(put_code_group)}")
        for item in details.get("bulk", []):
            work = item.get("work")
            if not work:
                continue
            publication = orcid_publication_from_work(work)
            if publication:
                publications.append(publication)

    return dedupe_publications(publications)


def dedupe_publications(items: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: dict[str, int] = {}

    for item in items:
        item = apply_publication_overrides(item)
        key = publication_title_key(item)
        if key in seen:
            existing = deduped[seen[key]]
            if not existing.get("url") and item.get("url"):
                deduped[seen[key]] = item
            continue
        seen[key] = len(deduped)
        deduped.append(item)

    return deduped


def merge_item(existing: dict, synced: dict) -> dict:
    merged = existing.copy()
    for field in ("year", "status", "statusType", "source"):
        value = synced.get(field)
        if value not in (None, ""):
            if field == "source":
                merged[field] = combine_sources(merged.get(field), value)
            else:
                merged[field] = value

    for field in ("category", "doi", "url", "linkLabel", "certificateId"):
        value = synced.get(field)
        if not merged.get(field) and value not in (None, ""):
            merged[field] = value

    for field in ("title", "venue", "authors"):
        if not merged.get(field) and synced.get(field):
            merged[field] = synced[field]

    return apply_publication_overrides(merged)


def combine_sources(existing_source: str | None, new_source: str) -> str:
    sources: list[str] = []
    for source in [existing_source, new_source]:
        if not source:
            continue
        for value in str(source).split(","):
            value = value.strip()
            if value and value not in sources:
                sources.append(value)
    return ", ".join(sources)


def merge_publications(existing: list[dict], synced: list[dict]) -> list[dict]:
    synced_by_doi: dict[str, dict] = {}
    synced_by_category_title: dict[tuple[str, str], dict] = {}
    for item in synced:
        for key in publication_doi_keys(item):
            synced_by_doi.setdefault(key, item)
        title_key = publication_title_key(item)
        if title_key:
            synced_by_category_title.setdefault((item.get("category", ""), title_key), item)

    merged: list[dict] = []
    used_items: set[int] = set()

    for item in existing:
        matched = next((synced_by_doi[key] for key in publication_doi_keys(item) if key in synced_by_doi), None)
        if not matched:
            matched = synced_by_category_title.get((item.get("category", ""), publication_title_key(item)))
        if matched:
            merged.append(merge_item(item, matched))
            used_items.add(id(matched))
        else:
            merged.append(item)

    for item in [item for item in synced if id(item) not in used_items]:
        merged.insert(publication_insert_index(merged, item), item)

    return merged


def dedupe_merged_publications(items: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: dict[tuple[str, str], int] = {}

    for item in items:
        item = apply_publication_overrides(item)
        key = (item.get("category", ""), publication_title_key(item))
        if not key[1]:
            deduped.append(item)
            continue
        if key in seen:
            deduped[seen[key]] = merge_item(deduped[seen[key]], item)
            continue
        seen[key] = len(deduped)
        deduped.append(item)

    return deduped


def publication_insert_index(items: list[dict], new_item: dict) -> int:
    new_category = new_item.get("category")
    new_year = int(new_item.get("year") or 0)
    for index, item in enumerate(items):
        if item.get("category") != new_category:
            continue
        item_year = int(item.get("year") or 0)
        if item_year < new_year:
            return index
    if new_category == "journal":
        return next((index for index, item in enumerate(items) if item.get("category") != "journal"), len(items))
    return len(items)


def find_publications_items_span(raw: str) -> tuple[int, int]:
    publications_at = raw.find('"publications"')
    if publications_at == -1:
        raise ValueError("Could not find publications section.")
    items_at = raw.find('"items"', publications_at)
    if items_at == -1:
        raise ValueError("Could not find publications items.")
    start = raw.find("[", items_at)
    if start == -1:
        raise ValueError("Could not find publications items array.")

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(raw)):
        char = raw[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return start, index + 1

    raise ValueError("Could not parse publications items array.")


def dump_items(items: list[dict]) -> str:
    lines = json.dumps(items, indent=2, ensure_ascii=True).splitlines()
    return "\n".join([lines[0], *[f"    {line}" for line in lines[1:]]])


def formatted_update_date(today: date | None = None) -> str:
    today = today or date.today()
    return f"Updated: {MONTHS[today.month - 1]} {today.day}, {today.year}"


def update_publications_date(raw: str, last_updated: str) -> str:
    publications_at = raw.find('"publications"')
    if publications_at == -1:
        raise ValueError("Could not find publications section.")
    items_at = raw.find('"items"', publications_at)
    if items_at == -1:
        raise ValueError("Could not find publications items.")

    search_span = raw[publications_at:items_at]
    replacement = f'"lastUpdated": {json.dumps(last_updated)},'
    current = re.search(r'"lastUpdated"\s*:\s*"[^"]*"\s*,', search_span)
    if current:
        start = publications_at + current.start()
        end = publications_at + current.end()
        return raw[:start] + replacement + raw[end:]

    title_line = re.search(r'(^\s*"title"\s*:\s*"[^"]*"\s*,\n)', raw[publications_at:], flags=re.M)
    if not title_line:
        raise ValueError("Could not find publications title line.")
    insert_at = publications_at + title_line.end()
    return raw[:insert_at] + f'    {replacement}\n' + raw[insert_at:]


def write_publications_data(data_path: Path, items: list[dict], last_updated: str) -> None:
    raw = data_path.read_text(encoding="utf-8")
    raw = update_publications_date(raw, last_updated)
    start, end = find_publications_items_span(raw)
    data_path.write_text(raw[:start] + dump_items(items) + raw[end:], encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cv-url", default=DEFAULT_CV_URL)
    parser.add_argument("--orcid-id", default=DEFAULT_ORCID_ID)
    parser.add_argument("--skip-orcid", action="store_true")
    parser.add_argument("--data-path", type=Path, default=DEFAULT_DATA_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    page_html = fetch_html(args.cv_url)
    cv_synced = parse_publications(page_html)
    if not cv_synced:
        print("No journal publications found in Ciencia Vitae CV.", file=sys.stderr)
        return 1

    orcid_synced: list[dict] = []
    if not args.skip_orcid:
        orcid_synced = parse_orcid_publications(args.orcid_id)
        if not orcid_synced:
            print("No public works found in ORCID record.", file=sys.stderr)

    data = json.loads(args.data_path.read_text(encoding="utf-8"))
    existing = data["publications"]["items"]
    merged = merge_publications(existing, cv_synced)
    if orcid_synced:
        merged = merge_publications(merged, orcid_synced)
    data["publications"]["items"] = dedupe_merged_publications(merged)
    data["publications"]["lastUpdated"] = formatted_update_date()

    if args.dry_run:
        print(f"Found {len(cv_synced)} Ciencia Vitae journal publications.")
        print(f"Found {len(orcid_synced)} ORCID public works.")
        return 0

    write_publications_data(
        args.data_path,
        data["publications"]["items"],
        data["publications"]["lastUpdated"],
    )
    print(f"Synced {len(cv_synced)} Ciencia Vitae journal publications.")
    print(f"Synced {len(orcid_synced)} ORCID public works.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
