import argparse
import ast
from difflib import SequenceMatcher
import subprocess
import os
import sys
import re


def calculate_syntax_score(file_path):

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ast.parse(f.read())
        return 1.0
    except SyntaxError as e:
        return 0.0
    except Exception as e:
        return 0.0


def calculate_similarity(generated_path, reference_path):

    try:
        with open(generated_path, "r", encoding="utf-8") as gen_file, open(
            reference_path, "r", encoding="utf-8"
        ) as ref_file:

            gen_code = gen_file.read()
            ref_code = ref_file.read()

            gen_clean = " ".join(gen_code.split())
            ref_clean = " ".join(ref_code.split())

            return SequenceMatcher(None, gen_clean, ref_clean).ratio()
    except Exception as e:
        return 0.0


def run_tests(test_path, generated_path):

    try:

        test_dir = os.path.dirname(test_path)
        temp_solution = os.path.join(test_dir, "solution.py")

        with open(generated_path, "r", encoding="utf-8") as src, open(
            temp_solution, "w", encoding="utf-8"
        ) as dest:
            dest.write(src.read())

        result = subprocess.run(
            ["pytest", test_path],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=test_dir,
        )

        if os.path.exists(temp_solution):
            os.remove(temp_solution)

        passed_match = re.search(r"(\d+) passed", result.stdout)
        failed_match = re.search(r"(\d+) failed", result.stdout)
        error_match = re.search(r"(\d+) errors?", result.stdout, re.IGNORECASE)

        passed = int(passed_match.group(1)) if passed_match else 0
        failed = int(failed_match.group(1)) if failed_match else 0
        errors = int(error_match.group(1)) if error_match else 0

        total = passed + failed + errors

        return passed / total if total > 0 else 0.0

    except subprocess.TimeoutExpired:
        return 0.0
    except Exception as e:
        return 0.0


def main():
    parser = argparse.ArgumentParser(description="Code quality assessment tool")
    parser.add_argument(
        "--generated", required=True, help="Path to generated code file"
    )
    parser.add_argument(
        "--reference", required=True, help="Path to reference solution file"
    )
    parser.add_argument("--tests", required=True, help="Path to test file")
    parser.add_argument(
        "--weights",
        default="0.3,0.3,0.4",
        help="Comma-separated weights for syntax, similarity, tests",
    )
    args = parser.parse_args()

    try:

        weights = [float(w) for w in args.weights.split(",")]
        if len(weights) != 3 or abs(sum(weights) - 1.0) > 0.01:
            weights = [0.3, 0.3, 0.4]

        syntax_score = calculate_syntax_score(args.generated)
        similarity_score = calculate_similarity(args.generated, args.reference)
        test_score = run_tests(args.tests, args.generated)

        final_score = (
            weights[0] * syntax_score
            + weights[1] * similarity_score
            + weights[2] * test_score
        )

        results = [
            "Code Assessment Results",
            "=======================",
            f"Syntax Check:    {syntax_score:.2f}/1.0",
            f"Code Similarity: {similarity_score:.2f}/1.0",
            f"Tests Pass Rate: {test_score:.2f}/1.0",
            "-----------------------",
            f"FINAL SCORE:     {final_score:.2f}/1.0",
            "=======================",
        ]

        print("\n".join(results))
    except Exception as e:
        print("Assessment failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
