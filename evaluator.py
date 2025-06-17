import argparse
import ast
from difflib import SequenceMatcher
import subprocess
import os
import sys


def calculate_syntax_score(file_path):
    """Check Python syntax validity"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ast.parse(f.read())
        return 1.0
    except SyntaxError as e:
        print(f"Syntax error: {e}")
        return 0.0
    except Exception as e:
        print(f"Error reading file: {e}")
        return 0.0


def calculate_similarity(generated_path, reference_path):
    """Calculate code similarity score"""
    try:
        with open(generated_path, "r", encoding="utf-8") as gen_file, open(
            reference_path, "r", encoding="utf-8"
        ) as ref_file:

            gen_code = gen_file.read()
            ref_code = ref_file.read()

            # Normalize code for better comparison
            gen_clean = " ".join(gen_code.split())
            ref_clean = " ".join(ref_code.split())

            return SequenceMatcher(None, gen_clean, ref_clean).ratio()
    except Exception as e:
        print(f"Similarity calculation error: {e}")
        return 0.0


def run_tests(test_path, generated_path):
    """Run tests using pytest and return pass rate"""
    try:
        # Create temp directory for testing
        test_dir = os.path.dirname(test_path)
        temp_solution = os.path.join(test_dir, "temp_solution.py")

        # Copy solution to test directory
        with open(generated_path, "r", encoding="utf-8") as src, open(
            temp_solution, "w", encoding="utf-8"
        ) as dest:
            dest.write(src.read())

        # Run tests
        result = subprocess.run(
            ["pytest", test_path], capture_output=True, text=True, timeout=30
        )

        # Clean up
        if os.path.exists(temp_solution):
            os.remove(temp_solution)

        # Parse test results
        if "passed" in result.stdout:
            passed = 0
            total = 0
            for line in result.stdout.split("\n"):
                if "passed" in line and "failed" in line:
                    parts = line.split()
                    passed = int(parts[0])
                    failed = int(parts[2]) if "failed" in parts else 0
                    total = passed + failed
                    break

            if total > 0:
                return passed / total
        return 0.0
    except subprocess.TimeoutExpired:
        print("Tests timed out after 30 seconds")
        return 0.0
    except Exception as e:
        print(f"Test execution error: {e}")
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
        # Parse weights
        weights = [float(w) for w in args.weights.split(",")]
        if len(weights) != 3 or abs(sum(weights) - 1.0) > 0.01:
            weights = [0.3, 0.3, 0.4]
            print("Invalid weights. Using defaults: 0.3, 0.3, 0.4")

        # Calculate scores
        syntax_score = calculate_syntax_score(args.generated)
        similarity_score = calculate_similarity(args.generated, args.reference)
        test_score = run_tests(args.tests, args.generated)

        # Calculate final score
        final_score = (
            weights[0] * syntax_score
            + weights[1] * similarity_score
            + weights[2] * test_score
        )

        # Format results
        results = [
            "Code Assessment Results",
            "=======================",
            f"Syntax Check:    {syntax_score:.2f}/1.0",
            f"Code Similarity: {similarity_score:.2f}/1.0",
            f"Tests Pass Rate: {test_score:.2f}/1.0",
            "-----------------------",
            f"FINAL SCORE:     {final_score:.2f}/1.0",
            "=======================",
            f"Assessment completed successfully",
        ]

        print("\n".join(results))
    except Exception as e:
        print(f"Assessment failed: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
