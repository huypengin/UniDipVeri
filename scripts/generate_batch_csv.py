#!/usr/bin/env python3
"""
University SIS Batch Graduation Records Generator.

Simulates an export from a University Student Information System (SIS / ERP)
for graduation credentials conforming dynamically to a credential schema YAML file.
Outputs standard RFC 4180 CSV with dot-notation headers and embedded JSON arrays.

Usage:
    python scripts/generate_batch_csv.py [--schema schemas/graduation-record.v1.yaml] [--count N] [--output filename.csv]
"""

import argparse
import csv
import json
import random
import sys
from pathlib import Path

import yaml

# Academic programs and majors
PROGRAMS = [
    {
        "degreeName": "Bachelor of Science in Computer Science",
        "degreeType": "Bachelor of Science",
        "programName": "Computer Science and Engineering",
        "major": "Computer Science",
        "minors": ["Data Science", "Artificial Intelligence", "Information Security", ""],
        "courses": [
            ("CS101", "Introduction to Computing", 3),
            ("CS102", "Object-Oriented Programming", 4),
            ("CS201", "Data Structures and Algorithms", 4),
            ("CS202", "Computer Organization & Architecture", 3),
            ("CS301", "Operating Systems", 4),
            ("CS302", "Database Systems", 3),
            ("CS303", "Software Engineering", 3),
            ("CS401", "Computer Networks", 3),
            ("CS402", "Artificial Intelligence", 3),
            ("CS499", "Capstone Graduation Project", 4),
        ],
    },
    {
        "degreeName": "Bachelor of Science in Electrical Engineering",
        "degreeType": "Bachelor of Science",
        "programName": "Electrical and Electronics Engineering",
        "major": "Electrical Engineering",
        "minors": ["Telecommunications", "Embedded Systems", ""],
        "courses": [
            ("EE101", "Circuits and Analysis", 4),
            ("EE102", "Digital Logic Design", 3),
            ("EE201", "Signals and Systems", 4),
            ("EE202", "Electromagnetic Fields", 3),
            ("EE301", "Microprocessor Systems", 4),
            ("EE302", "Power Electronics", 3),
            ("EE499", "Engineering Senior Thesis", 4),
        ],
    },
    {
        "degreeName": "Bachelor of Business Administration in Finance",
        "degreeType": "Bachelor of Business Administration",
        "programName": "School of Business",
        "major": "Finance and Banking",
        "minors": ["International Business", "Financial Analytics", ""],
        "courses": [
            ("BA101", "Principles of Management", 3),
            ("BA102", "Financial Accounting", 3),
            ("BA201", "Corporate Finance", 4),
            ("BA202", "Business Statistics", 3),
            ("BA301", "Investment Analysis", 4),
            ("BA302", "International Financial Markets", 3),
            ("BA499", "Business Capstone Strategy", 4),
        ],
    },
    {
        "degreeName": "Bachelor of Science in Data Science",
        "degreeType": "Bachelor of Science",
        "programName": "School of Computing",
        "major": "Data Science",
        "minors": ["Computational Statistics", "Business Intelligence", ""],
        "courses": [
            ("DS101", "Foundations of Data Science", 3),
            ("DS102", "Statistical Modeling", 4),
            ("DS201", "Machine Learning Fundamentals", 4),
            ("DS202", "Big Data Analytics", 3),
            ("DS301", "Deep Learning & Neural Networks", 4),
            ("DS499", "Data Science Thesis Project", 4),
        ],
    },
]

FIRST_NAMES = [
    "Van", "Thi", "Hoang", "Minh", "Quoc", "Thanh", "Duc", "Phuong", "Gia", "Bao",
    "Hai", "Ngoc", "Tuan", "Anh", "Hung", "Khoa", "Trang", "Linh", "Dung", "Huong"
]

LAST_NAMES = [
    "Nguyen", "Tran", "Le", "Pham", "Hoang", "Huynh", "Phan", "Vu", "Vo", "Dang",
    "Bui", "Do", "Ho", "Ngo", "Duong", "Ly", "Mai", "Ha", "Trinh", "Dinh"
]

HONOURS = ["First Class Honours", "Second Class Honours (Upper)", "Second Class Honours (Lower)", ""]

def grade_to_letter(score: float) -> str:
    """Converts a 0-100 numerical score into a standard letter grade."""
    if score >= 90:
        return "A+"
    if score >= 85:
        return "A"
    if score >= 80:
        return "B+"
    if score >= 75:
        return "B"
    if score >= 70:
        return "C+"
    if score >= 65:
        return "C"
    if score >= 60:
        return "D+"
    if score >= 50:
        return "D"
    return "F"

def letter_to_gpa_points(letter: str) -> float:
    """Converts a letter grade into 4.0 scale GPA grade points."""
    mapping = {
        "A+": 4.0, "A": 4.0, "B+": 3.5, "B": 3.0,
        "C+": 2.5, "C": 2.0, "D+": 1.5, "D": 1.0, "F": 0.0
    }
    return mapping.get(letter, 0.0)

class StudentAcademicContext:
    """Context holding generated academic data for a single student."""

    def __init__(self, index: int, cohort_year: int = 2026):
        self.program = random.choice(PROGRAMS)
        self.last_name = random.choice(LAST_NAMES)
        middle_first = f"{random.choice(FIRST_NAMES)} {random.choice(FIRST_NAMES)}"
        self.full_name = f"{self.last_name} {middle_first}"

        major_prefix = {
            "Computer Science": "IT",
            "Electrical Engineering": "EE",
            "Finance and Banking": "BA",
            "Data Science": "DS",
        }.get(self.program["major"], "UN")

        self.student_id = f"{major_prefix}IU{cohort_year - 4 % 100}{index + 1001:04d}"
        birth_year = cohort_year - 22
        birth_month = random.randint(1, 12)
        birth_day = random.randint(1, 28)
        self.dob = f"{birth_year}-{birth_month:02d}-{birth_day:02d}"
        self.national_id = f"079{birth_year % 100:02d}{random.randint(1000000, 9999999):07d}"

        self.minor = random.choice(self.program["minors"])
        self.honours = random.choice(HONOURS)
        self.grad_date = f"{cohort_year}-06-30"
        self.transcript_id = f"TR-{cohort_year}-{index + 1001:05d}"

        # Generate courses conforming to program
        self.courses_data = []
        total_grade_points = 0.0
        total_credits = 0

        for code, title, credits in self.program["courses"]:
            numerical_grade = round(min(100.0, max(60.0, random.gauss(82.0, 7.5))), 1)
            letter = grade_to_letter(numerical_grade)
            self.courses_data.append({
                "code": code,
                "title": title,
                "credits": credits,
                "grade": numerical_grade,
                "letterGrade": letter,
            })
            total_grade_points += letter_to_gpa_points(letter) * credits
            total_credits += credits

        self.cumulative_gpa = round(total_grade_points / max(1, total_credits), 2)
        self.total_credits = total_credits + random.choice([100, 105, 110])

def load_schema(schema_input: str) -> dict:
    """
    Loads and parses the credential schema YAML file.
    Resolves path against cwd or the project repository root.
    """
    path = Path(schema_input)
    if not path.is_file():
        repo_root = Path(__file__).resolve().parent.parent
        candidate = repo_root / schema_input
        if candidate.is_file():
            path = candidate
        else:
            raise FileNotFoundError(f"Credential schema file not found at '{schema_input}' or '{candidate}'")

    with open(path, "r", encoding="utf-8") as f:
        schema_data = yaml.safe_load(f)

    if not isinstance(schema_data, dict) or "claims" not in schema_data:
        raise ValueError(f"Schema at '{path}' is invalid: missing top-level 'claims' mapping")

    return schema_data

def extract_schema_columns(claims: dict, prefix: str = "") -> list[tuple[str, dict]]:
    """
    Recursively extracts dot-notation column paths and their claim definitions from schema claims.
    Returns a list of (column_path, claim_def) tuples preserving schema declaration order.
    """
    columns: list[tuple[str, dict]] = []
    for claim_name, claim_def in claims.items():
        field_path = f"{prefix}.{claim_name}" if prefix else claim_name
        claim_type = claim_def.get("type") if isinstance(claim_def, dict) else None

        if claim_type == "object" and "properties" in claim_def and isinstance(claim_def["properties"], dict):
            columns.extend(extract_schema_columns(claim_def["properties"], prefix=field_path))
        else:
            columns.append((field_path, claim_def if isinstance(claim_def, dict) else {}))

    return columns

def resolve_claim_value(col_path: str, claim_def: dict, ctx: StudentAcademicContext) -> str | int | float | bool:
    """
    Resolves the value for a given schema column path using the student's academic context,
    falling back to schema-guided generation for unmapped properties.
    """
    leaf_name = col_path.split(".")[-1].lower()
    claim_type = claim_def.get("type", "string")

    # Handle array claims (e.g. papers.transcript.courses)
    if claim_type == "array" or leaf_name == "courses":
        item_props = claim_def.get("items", {}).get("properties") if isinstance(claim_def.get("items"), dict) else None
        if item_props and isinstance(item_props, dict):
            serialized_courses = []
            for course in ctx.courses_data:
                item_dict = {}
                for prop_name, prop_def in item_props.items():
                    prop_key = prop_name.lower()
                    if prop_name in course:
                        item_dict[prop_name] = course[prop_name]
                    elif prop_key == "code":
                        item_dict[prop_name] = course["code"]
                    elif prop_key == "title":
                        item_dict[prop_name] = course["title"]
                    elif prop_key == "credits":
                        item_dict[prop_name] = course["credits"]
                    elif prop_key == "grade":
                        item_dict[prop_name] = course["grade"]
                    elif prop_key in ("lettergrade", "letter"):
                        item_dict[prop_name] = course["letterGrade"]
                    else:
                        item_dict[prop_name] = generate_generic_value(prop_name, prop_def, ctx)
                serialized_courses.append(item_dict)
            return json.dumps(serialized_courses)
        else:
            return json.dumps(ctx.courses_data)

    # Standard academic fields mapping
    field_mappings = {
        "studentid": ctx.student_id,
        "id": ctx.student_id,
        "fullname": ctx.full_name,
        "name": ctx.full_name,
        "dateofbirth": ctx.dob,
        "birthdate": ctx.dob,
        "dob": ctx.dob,
        "nationalid": ctx.national_id,
        "citizenid": ctx.national_id,
        "degreename": ctx.program["degreeName"],
        "degreetype": ctx.program["degreeType"],
        "programname": ctx.program["programName"],
        "major": ctx.program["major"],
        "minor": ctx.minor,
        "graduationdate": ctx.grad_date,
        "graddate": ctx.grad_date,
        "honours": ctx.honours,
        "honor": ctx.honours,
        "transcriptid": ctx.transcript_id,
        "cumulativegpa": ctx.cumulative_gpa,
        "gpa": ctx.cumulative_gpa,
        "totalcredits": ctx.total_credits,
        "credits": ctx.total_credits,
    }

    if leaf_name in field_mappings:
        return field_mappings[leaf_name]

    # Fallback generation for non-academic or custom fields based on schema types
    return generate_generic_value(col_path, claim_def, ctx)

def generate_generic_value(field_name: str, claim_def: dict, ctx: StudentAcademicContext) -> str | int | float | bool:
    """Generates synthetic values for claims not covered by the default academic context."""
    claim_type = claim_def.get("type", "string")
    fmt = claim_def.get("format")

    if claim_type == "string":
        if fmt == "date":
            return ctx.grad_date
        if fmt == "email":
            return f"{ctx.student_id.lower()}@student.university.edu"
        if fmt == "uri":
            return f"https://credentials.university.edu/verify/{ctx.student_id}"
        return f"Val-{field_name.split('.')[-1]}"

    if claim_type == "number":
        return random.randint(30, 100)

    if claim_type == "boolean":
        return True

    return ""

def write_records(out_file, columns: list[tuple[str, dict]], count: int, cohort_year: int) -> None:
    """Writes synthetic student records conforming to schema columns to an output stream."""
    fieldnames = [col for col, _ in columns]
    writer = csv.DictWriter(out_file, fieldnames=fieldnames, quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()

    for i in range(count):
        ctx = StudentAcademicContext(i, cohort_year=cohort_year)
        row = {col: resolve_claim_value(col, defn, ctx) for col, defn in columns}
        writer.writerow(row)

def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic University SIS graduation records CSV from a credential schema."
    )
    parser.add_argument(
        "--schema", "-s",
        type=str,
        default="schemas/graduation-record.v1.yaml",
        help="Path to credential schema YAML file (default: schemas/graduation-record.v1.yaml)."
    )
    parser.add_argument(
        "--count", "-n",
        type=int,
        default=10,
        help="Number of student records to generate (default: 10)."
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Output CSV file path. If omitted, writes to stdout."
    )
    parser.add_argument(
        "--year", "-y",
        type=int,
        default=2026,
        help="Graduation cohort year (default: 2026)."
    )
    args = parser.parse_args()

    try:
        schema = load_schema(args.schema)
        columns = extract_schema_columns(schema["claims"])
    except (OSError, yaml.YAMLError, ValueError, KeyError, TypeError) as err:
        print(f"Error loading schema: {err}", file=sys.stderr)
        sys.exit(1)

    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8") as out_file:
            write_records(out_file, columns, args.count, args.year)
        print(f"Generated {args.count} records conforming to '{args.schema}' in '{args.output}'.", file=sys.stderr)
    else:
        write_records(sys.stdout, columns, args.count, args.year)

if __name__ == "__main__":
    main()
