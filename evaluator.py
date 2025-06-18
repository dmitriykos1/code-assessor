import argparse
import ast
import json
import os
import re
import subprocess
import sys
from difflib import SequenceMatcher


def calculate_syntax_score(file_path):
    """Проверка синтаксической корректности кода"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ast.parse(f.read())
        return 1.0
    except SyntaxError as e:
        return 0.0
    except Exception as e:
        print(f"Ошибка синтаксического анализа: {str(e)}")
        return 0.0


def calculate_similarity(generated_path, reference_path):
    """Вычисление сходства с эталонным решением"""
    try:
        with open(generated_path, "r", encoding="utf-8") as gen_file, open(
            reference_path, "r", encoding="utf-8"
        ) as ref_file:

            gen_code = gen_file.read()
            ref_code = ref_file.read()

            # Нормализация кода для сравнения
            gen_clean = " ".join(gen_code.split())
            ref_clean = " ".join(ref_code.split())

            return SequenceMatcher(None, gen_clean, ref_clean).ratio()
    except Exception as e:
        print(f"Ошибка сравнения кода: {str(e)}")
        return 0.0


def run_tests(test_path, generated_path):
    """Запуск тестов и расчет процента прохождения"""
    try:
        # Копирование решения во временный файл
        test_dir = os.path.dirname(test_path)
        solution_path = os.path.join(test_dir, "temp_solution.py")

        with open(generated_path, "r", encoding="utf-8") as src, open(
            solution_path, "w", encoding="utf-8"
        ) as dest:
            dest.write(src.read())

        # Запуск pytest
        result = subprocess.run(
            ["pytest", test_path], capture_output=True, text=True, timeout=30
        )

        # Удаление временного файла
        if os.path.exists(solution_path):
            os.remove(solution_path)

        # Анализ результатов
        if "passed" in result.stdout:
            passed = 0
            total = 0
            for line in result.stdout.split("\n"):
                if "passed" in line and "failed" in line:
                    parts = re.findall(r"\d+", line)
                    if len(parts) >= 2:
                        passed = int(parts[0])
                        failed = int(parts[1])
                        total = passed + failed
                        break

            return passed / total if total > 0 else 0.0
        return 0.0
    except subprocess.TimeoutExpired:
        print("Тесты не завершились вовремя")
        return 0.0
    except Exception as e:
        print(f"Ошибка выполнения тестов: {str(e)}")
        return 0.0


def calculate_code_quality(file_path):
    """Оценка качества кода с помощью Flake8 и Pylint"""
    try:
        # Проверка Flake8
        flake8_result = subprocess.run(
            ["flake8", "--format=%(row)d:%(col)d:%(code)s:%(text)s", file_path],
            capture_output=True,
            text=True,
            timeout=20,
        )

        flake8_errors = []
        if flake8_result.stdout:
            flake8_errors = [
                line.strip()
                for line in flake8_result.stdout.split("\n")
                if line.strip()
            ]

        # Проверка Pylint
        pylint_result = subprocess.run(
            ["pylint", "--output-format=json", file_path],
            capture_output=True,
            text=True,
            timeout=30,
        )

        pylint_errors = []
        if pylint_result.stdout:
            try:
                pylint_data = json.loads(pylint_result.stdout)
                pylint_errors = [
                    f"{item['line']}:{item['column']}: {item['symbol']}: {item['message']}"
                    for item in pylint_data
                    if item["type"] in ["error", "warning", "convention", "refactor"]
                ]
            except json.JSONDecodeError:
                pass

        # Подсчет ошибок
        total_errors = len(flake8_errors) + len(pylint_errors)

        # Генерация отчета
        report_lines = []
        report_lines.append("=== Flake8 Issues ===")
        report_lines.extend(flake8_errors or ["Нет проблем"])

        report_lines.append("\n=== Pylint Issues ===")
        report_lines.extend(pylint_errors or ["Нет проблем"])

        quality_report = "\n".join(report_lines)

        # Расчет оценки качества (чем меньше ошибок, тем выше оценка)
        if total_errors == 0:
            return 1.0, quality_report
        elif total_errors <= 5:
            return 0.8, quality_report
        elif total_errors <= 10:
            return 0.6, quality_report
        elif total_errors <= 20:
            return 0.4, quality_report
        else:
            return 0.2, quality_report

    except Exception as e:
        print(f"Ошибка оценки качества: {str(e)}")
        return 0.5, "Не удалось выполнить оценку качества"


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
        default="0.2,0.2,0.3,0.3",
        help="Comma-separated weights for syntax, similarity, tests, quality",
    )
    args = parser.parse_args()

    try:
        # Проверка существования файлов
        for file_path in [args.generated, args.reference, args.tests]:
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"Файл не найден: {file_path}")

        # Парсинг весов
        weights = [float(w) for w in args.weights.split(",")]
        if len(weights) != 4 or abs(sum(weights) - 1.0) > 0.01:
            weights = [0.2, 0.2, 0.3, 0.3]
            print("Используются веса по умолчанию: 0.2, 0.2, 0.3, 0.3")

        # Расчет метрик
        syntax_score = calculate_syntax_score(args.generated)
        similarity_score = calculate_similarity(args.generated, args.reference)
        test_score = run_tests(args.tests, args.generated)
        quality_score, quality_report = calculate_code_quality(args.generated)

        # Расчет итоговой оценки
        final_score = (
            weights[0] * syntax_score
            + weights[1] * similarity_score
            + weights[2] * test_score
            + weights[3] * quality_score
        )

        # Форматирование результатов
        results = [
            f"Syntax Score: {syntax_score:.4f}",
            f"Similarity Score: {similarity_score:.4f}",
            f"Test Score: {test_score:.4f}",
            f"Quality Score: {quality_score:.4f}",
            "--------------------------------",
            f"FINAL SCORE: {final_score:.4f}",
            "",
            "QUALITY REPORT START:",
            quality_report,
            "QUALITY REPORT END",
        ]

        print("\n".join(results))
    except Exception as e:
        print(f"Оценка не удалась: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
