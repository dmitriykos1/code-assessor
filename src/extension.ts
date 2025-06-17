import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as util from 'util';

const exec = util.promisify(cp.exec);

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('code-assessor.evaluate', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found!');
            return;
        }

        const document = editor.document;
        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);

        // Check if it's a Python file
        if (path.extname(filePath) !== '.py') {
            vscode.window.showErrorMessage('Code Assessor currently only supports Python files.');
            return;
        }

        // Show progress
        const status = vscode.window.setStatusBarMessage(`Assessing ${fileName}...`);

        try {
            // Get configuration weights
            const config = vscode.workspace.getConfiguration('codeAssessor.weights');
            const weights = {
                syntax: config.get<number>('syntax') || 0.3,
                similarity: config.get<number>('similarity') || 0.3,
                tests: config.get<number>('tests') || 0.4
            };

            // Prepare paths
            const extensionPath = context.extensionPath;
            const refPath = path.join(extensionPath, 'references', 'sum.py');
            const testPath = path.join(extensionPath, 'tests', 'test_sum.py');
            const evaluatorPath = path.join(extensionPath, 'evaluator.py');

            // Verify files exist
            const fs = require('fs');
            const requiredFiles = [
                { path: evaluatorPath, name: 'evaluator.py' },
                { path: refPath, name: 'reference solution (sum.py)' },
                { path: testPath, name: 'test file (test_sum.py)' }
            ];

            for (const file of requiredFiles) {
                if (!fs.existsSync(file.path)) {
                    vscode.window.showErrorMessage(`Required file missing: ${file.name}`);
                    return;
                }
            }

            // Build command
            const command = [
                'python',
                `"${evaluatorPath}"`,
                `--generated "${filePath}"`,
                `--reference "${refPath}"`,
                `--tests "${testPath}"`,
                `--weights ${weights.syntax},${weights.similarity},${weights.tests}`
            ].join(' ');

            // Execute assessment
            const { stdout, stderr } = await exec(command);

            if (stderr) {
                throw new Error(stderr);
            }

            // Show results
            vscode.window.showInformationMessage('Assessment Results', {
                modal: true,
                detail: stdout
            });

        } catch (error) {
            let errorMessage = 'Unknown error occurred';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
            vscode.window.showErrorMessage(`Assessment failed: ${errorMessage}`);
        } finally {
            status.dispose();
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }