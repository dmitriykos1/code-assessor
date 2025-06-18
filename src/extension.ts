import * as vscode from 'vscode';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as csv from 'fast-csv';

// Асинхронная версия exec
function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        childProcess.exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

// Интерфейс для результатов оценки
interface AssessmentResult {
    timestamp: Date;
    fileName: string;
    syntaxScore: number;
    similarityScore: number;
    testScore: number;
    qualityScore: number;
    finalScore: number;
    qualityReport?: string;
}

export function activate(context: vscode.ExtensionContext) {
    // Создаем выходной канал
    const outputChannel = vscode.window.createOutputChannel('Code Assessment');

    // Хранилище для истории оценок
    const assessmentHistory: AssessmentResult[] = context.globalState.get('assessmentHistory', []);

    // Команда для экспорта истории
    const exportDisposable = vscode.commands.registerCommand('code-assessor.exportHistory', async () => {
        if (assessmentHistory.length === 0) {
            vscode.window.showWarningMessage('История оценок пуста!');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const defaultPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : os.homedir();

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultPath, 'code_assessment_history.csv')),
            filters: { 'CSV Files': ['csv'] }
        });

        if (uri) {
            try {
                const ws = fs.createWriteStream(uri.fsPath);
                csv.writeToStream(ws, assessmentHistory, {
                    headers: true,
                    transform: (row: AssessmentResult) => ({
                        Timestamp: row.timestamp.toISOString(),
                        File: row.fileName,
                        Syntax: row.syntaxScore,
                        Similarity: row.similarityScore,
                        Tests: row.testScore,
                        Quality: row.qualityScore,
                        Final: row.finalScore
                    })
                }).on('finish', () => {
                    vscode.window.showInformationMessage(`История экспортирована в ${uri.fsPath}`);
                });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Ошибка экспорта: ${error.message}`);
            }
        }
    });

    // Основная команда оценки
    const disposable = vscode.commands.registerCommand('code-assessor.evaluate', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Нет активного редактора!');
            return;
        }

        const document = editor.document;
        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        if (path.extname(filePath) !== '.py') {
            vscode.window.showErrorMessage('Расширение работает только с Python файлами!');
            return;
        }

        // Показываем прогресс-бар
        let assessmentResult: AssessmentResult | null = null;
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Оценка файла: ${fileName}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Подготовка..." });

                // Получаем конфигурацию весов
                const config = vscode.workspace.getConfiguration('codeAssessor.weights');
                const weights = {
                    syntax: config.get<number>('syntax') || 0.2,
                    similarity: config.get<number>('similarity') || 0.2,
                    tests: config.get<number>('tests') || 0.3,
                    quality: config.get<number>('quality') || 0.3
                };

                const extensionPath = context.extensionPath;
                const refPath = path.join(extensionPath, 'references', 'sum.py');
                const testPath = path.join(extensionPath, 'tests', 'test_sum.py');
                const evaluatorPath = path.join(extensionPath, 'evaluator.py');

                // Проверка файлов
                const files = [
                    { name: 'evaluator.py', path: evaluatorPath },
                    { name: 'reference solution', path: refPath },
                    { name: 'test file', path: testPath }
                ];

                for (const file of files) {
                    if (!fs.existsSync(file.path)) {
                        throw new Error(`Файл не найден: ${file.name} (${file.path})`);
                    }
                }

                progress.report({ message: "Запуск оценки..." });
                const command = `python "${evaluatorPath}" --generated "${filePath}" --reference "${refPath}" --tests "${testPath}" --weights ${weights.syntax},${weights.similarity},${weights.tests},${weights.quality}`;
                const { stdout, stderr } = await execAsync(command);

                if (stderr) {
                    throw new Error(stderr);
                }

                // Парсим результаты
                const syntaxMatch = stdout.match(/Syntax Score:\s+([\d.]+)/);
                const similarityMatch = stdout.match(/Similarity Score:\s+([\d.]+)/);
                const testMatch = stdout.match(/Test Score:\s+([\d.]+)/);
                const qualityMatch = stdout.match(/Quality Score:\s+([\d.]+)/);
                const finalMatch = stdout.match(/FINAL SCORE:\s+([\d.]+)/);
                const qualityReportMatch = stdout.match(/QUALITY REPORT START:(.+?)QUALITY REPORT END/s);

                if (!syntaxMatch || !similarityMatch || !testMatch || !qualityMatch || !finalMatch) {
                    throw new Error('Не удалось распознать результаты оценки');
                }

                assessmentResult = {
                    timestamp: new Date(),
                    fileName,
                    syntaxScore: parseFloat(syntaxMatch[1]),
                    similarityScore: parseFloat(similarityMatch[1]),
                    testScore: parseFloat(testMatch[1]),
                    qualityScore: parseFloat(qualityMatch[1]),
                    finalScore: parseFloat(finalMatch[1]),
                    qualityReport: qualityReportMatch ? qualityReportMatch[1].trim() : undefined
                };

                // Добавляем в историю (максимум 15 записей)
                assessmentHistory.unshift(assessmentResult);
                if (assessmentHistory.length > 15) {
                    assessmentHistory.pop();
                }
                context.globalState.update('assessmentHistory', assessmentHistory);

                progress.report({ message: "Форматирование результатов..." });

                // Очищаем и показываем канал с результатами
                outputChannel.clear();
                outputChannel.show(true);

                outputChannel.appendLine('РЕЗУЛЬТАТЫ ОЦЕНКИ');
                outputChannel.appendLine('================================');
                outputChannel.appendLine(`Файл: ${fileName}`);
                outputChannel.appendLine(`Время: ${assessmentResult.timestamp.toLocaleString()}`);
                outputChannel.appendLine('');

                outputChannel.appendLine(`Синтаксическая корректность: ${assessmentResult.syntaxScore.toFixed(2)}/1.0`);
                outputChannel.appendLine(`Сходство с эталоном: ${assessmentResult.similarityScore.toFixed(2)}/1.0`);
                outputChannel.appendLine(`Прохождение тестов: ${assessmentResult.testScore.toFixed(2)}/1.0`);
                outputChannel.appendLine(`Качество кода: ${assessmentResult.qualityScore.toFixed(2)}/1.0`);
                outputChannel.appendLine('--------------------------------');
                outputChannel.appendLine(`Итоговый балл: ${assessmentResult.finalScore.toFixed(2)}/1.0`);
                outputChannel.appendLine('================================');

                // Показываем отчет о качестве
                if (assessmentResult.qualityReport) {
                    outputChannel.appendLine('\nОТЧЕТ О КАЧЕСТВЕ КОДА:');
                    outputChannel.appendLine('--------------------------------');
                    outputChannel.appendLine(assessmentResult.qualityReport);
                    outputChannel.appendLine('--------------------------------');
                }
            });

            // Показываем уведомление с кнопками
            const choice = await vscode.window.showInformationMessage(
                'Оценка завершена успешно!',
                'Повторить оценку', 'Экспорт истории', 'Просмотр истории'
            );

            if (choice === 'Повторить оценку') {
                vscode.commands.executeCommand('code-assessor.evaluate');
            } else if (choice === 'Экспорт истории') {
                vscode.commands.executeCommand('code-assessor.exportHistory');
            } else if (choice === 'Просмотр истории') {
                showAssessmentHistory(context, assessmentHistory);
            }

        } catch (error: any) {
            let errorMessage = 'Неизвестная ошибка';

            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            vscode.window.showErrorMessage(`Ошибка оценки: ${errorMessage}`);
        }
    });

    // Команда для просмотра истории
    const historyDisposable = vscode.commands.registerCommand('code-assessor.viewHistory', () => {
        showAssessmentHistory(context, assessmentHistory);
    });

    context.subscriptions.push(disposable, exportDisposable, historyDisposable, outputChannel);
}

// Функция для показа истории оценок
function showAssessmentHistory(context: vscode.ExtensionContext, history: AssessmentResult[]) {
    if (history.length === 0) {
        vscode.window.showInformationMessage('История оценок пуста!');
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'assessmentHistory',
        'История оценок',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    // Генерируем HTML с историей
    let html = `<html><head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; }
            .good { color: green; }
            .medium { color: orange; }
            .bad { color: red; }
            button { padding: 8px 16px; background: #0078d4; color: white; border: none; cursor: pointer; }
            button:hover { background: #106ebe; }
            .details { display: none; margin-top: 5px; padding: 10px; background: #f9f9f9; border-left: 3px solid #0078d4; }
        </style>
    </head><body>
        <h1>История оценок</h1>
        <table>
            <tr>
                <th>Дата</th>
                <th>Файл</th>
                <th>Синтаксис</th>
                <th>Сходство</th>
                <th>Тесты</th>
                <th>Качество</th>
                <th>Итог</th>
                <th>Действия</th>
            </tr>`;

    history.forEach((result, index) => {
        const getScoreClass = (score: number) =>
            score > 0.8 ? 'good' : score > 0.5 ? 'medium' : 'bad';

        html += `<tr>
            <td>${result.timestamp.toLocaleString()}</td>
            <td>${result.fileName}</td>
            <td class="${getScoreClass(result.syntaxScore)}">${result.syntaxScore.toFixed(2)}</td>
            <td class="${getScoreClass(result.similarityScore)}">${result.similarityScore.toFixed(2)}</td>
            <td class="${getScoreClass(result.testScore)}">${result.testScore.toFixed(2)}</td>
            <td class="${getScoreClass(result.qualityScore)}">${result.qualityScore.toFixed(2)}</td>
            <td class="${getScoreClass(result.finalScore)}"><b>${result.finalScore.toFixed(2)}</b></td>
            <td>
                <button onclick="showDetails(${index})">Подробности</button>
                <div id="details-${index}" class="details">
                    ${result.qualityReport ? result.qualityReport.replace(/\n/g, '<br>') : 'Нет данных'}
                </div>
            </td>
        </tr>`;
    });

    html += `</table>
        <p><button onclick="exportHistory()">Экспорт в CSV</button></p>
        <script>
            function showDetails(index) {
                const details = document.getElementById('details-' + index);
                details.style.display = details.style.display === 'block' ? 'none' : 'block';
            }
            
            function exportHistory() {
                vscode.postMessage({ command: 'export' });
            }
            
            const vscode = acquireVsCodeApi();
        </script>
        </body></html>`;

    panel.webview.html = html;

    // Обработка сообщений из WebView
    panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'export') {
            vscode.commands.executeCommand('code-assessor.exportHistory');
            panel.dispose();
        }
    });
}

export function deactivate() { }