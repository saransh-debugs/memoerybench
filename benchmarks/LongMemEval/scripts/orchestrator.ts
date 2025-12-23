#!/usr/bin/env bun
/**
 * LongMemEval Orchestrator
 * 
 * Coordinates execution of the LongMemEval pipeline phases:
 * - Setup: Generate question files from dataset
 * - Ingest: Ingest sessions into memory system
 * - Search: Search for answers
 * - Evaluate: Evaluate results with LLM judge
 * 
 * Usage:
 *   bun run scripts/orchestrator.ts [options]
 * 
 * Options:
 *   --phase=<setup|ingest|search|evaluate|all>
 *   --mode=<single|batch>
 *   --runId=<runId>
 *   --questionId=<questionId>
 *   --questionType=<type>
 *   --startPosition=<n>
 *   --endPosition=<n>
 *   --answeringModel=<model>
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const ROOT_DIR = join(__dirname, '..');
const SCRIPTS_DIR = join(__dirname);
const DATASETS_DIR = join(ROOT_DIR, 'datasets');
const QUESTIONS_DIR = join(DATASETS_DIR, 'questions');
const DATASET_FILE = join(DATASETS_DIR, 'longmemeval_s_cleaned.json');

const QUESTION_TYPES = [
    'single-session-user',
    'single-session-assistant',
    'single-session-preference',
    'knowledge-update',
    'temporal-reasoning',
    'multi-session',
] as const;

const VALID_MODELS = ['gpt-4o', 'gpt-5', 'gemini-3-pro-preview'] as const;

type Phase = 'setup' | 'ingest' | 'search' | 'evaluate' | 'all';
type Mode = 'single' | 'batch';
type QuestionType = typeof QUESTION_TYPES[number];

interface OrchestratorOptions {
    phase: Phase;
    mode?: Mode;
    runId?: string;
    questionId?: string;
    questionType?: QuestionType | 'all';
    startPosition?: number;
    endPosition?: number;
    answeringModel?: string;
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(): Partial<OrchestratorOptions> {
    const args = process.argv.slice(2);
    const options: Partial<OrchestratorOptions> = {};

    for (const arg of args) {
        if (arg.startsWith('--phase=')) {
            const phase = arg.split('=')[1] as Phase;
            if (['setup', 'ingest', 'search', 'evaluate', 'all'].includes(phase)) {
                options.phase = phase;
            }
        } else if (arg.startsWith('--mode=')) {
            const mode = arg.split('=')[1] as Mode;
            if (['single', 'batch'].includes(mode)) {
                options.mode = mode;
            }
        } else if (arg.startsWith('--runId=')) {
            options.runId = arg.split('=')[1];
        } else if (arg.startsWith('--questionId=')) {
            options.questionId = arg.split('=')[1];
        } else if (arg.startsWith('--questionType=')) {
            options.questionType = arg.split('=')[1] as QuestionType | 'all';
        } else if (arg.startsWith('--startPosition=')) {
            options.startPosition = parseInt(arg.split('=')[1], 10);
        } else if (arg.startsWith('--endPosition=')) {
            options.endPosition = parseInt(arg.split('=')[1], 10);
        } else if (arg.startsWith('--answeringModel=')) {
            options.answeringModel = arg.split('=')[1];
        }
    }

    return options;
}

// =============================================================================
// Interactive Prompts
// =============================================================================

async function prompt(question: string): Promise<string> {
    process.stdout.write(question);
    
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        stdin.setEncoding('utf8');
        stdin.resume();
        
        let input = '';
        
        const cleanup = () => {
            stdin.removeListener('data', onData);
            stdin.removeListener('error', onError);
            stdin.pause();
        };
        
        const onData = (chunk: Buffer | string) => {
            const text = chunk.toString();
            input += text;
            const lines = input.split(/\r?\n/);
            if (lines.length > 1) {
                cleanup();
                resolve(lines[0].trim());
            }
        };
        
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };
        
        stdin.on('data', onData);
        stdin.on('error', onError);
        
        // Handle Ctrl+C
        const sigintHandler = () => {
            cleanup();
            console.log('\n\nExiting...');
            process.exit(0);
        };
        process.once('SIGINT', sigintHandler);
    });
}

async function promptChoice<T extends string>(
    question: string,
    choices: readonly T[],
    defaultChoice?: T
): Promise<T> {
    const choicesStr = choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
    const defaultStr = defaultChoice ? ` (default: ${defaultChoice})` : '';
    const fullQuestion = `${question}\n${choicesStr}${defaultStr}\n> `;

    while (true) {
        const answer = await prompt(fullQuestion);
        const choice = answer || defaultChoice;
        
        if (choice && choices.includes(choice as T)) {
            return choice as T;
        }
        
        // Try numeric selection
        const num = parseInt(answer, 10);
        if (num >= 1 && num <= choices.length) {
            return choices[num - 1];
        }
        
        console.log(`Invalid choice. Please select from: ${choices.join(', ')}`);
    }
}

async function promptNumber(question: string, min?: number, max?: number): Promise<number> {
    while (true) {
        const answer = await prompt(question);
        const num = parseInt(answer, 10);
        
        if (isNaN(num)) {
            console.log('Please enter a valid number.');
            continue;
        }
        
        if (min !== undefined && num < min) {
            console.log(`Number must be at least ${min}.`);
            continue;
        }
        
        if (max !== undefined && num > max) {
            console.log(`Number must be at most ${max}.`);
            continue;
        }
        
        return num;
    }
}

async function promptMissing(options: Partial<OrchestratorOptions>): Promise<OrchestratorOptions> {
    const result: OrchestratorOptions = {
        phase: options.phase || await promptChoice('Select phase:', ['setup', 'ingest', 'search', 'evaluate', 'all'] as const, 'all'),
    };

    // Only prompt for mode if phase requires it
    if (result.phase !== 'setup' && result.phase !== 'all') {
        result.mode = options.mode || await promptChoice('Select mode:', ['single', 'batch'] as const);
    } else if (result.phase === 'all') {
        result.mode = options.mode || await promptChoice('Select mode:', ['single', 'batch'] as const);
    }

    // Prompt for runId if needed
    if (result.phase !== 'setup') {
        result.runId = options.runId || await prompt('Enter runId: ');
    }

    // Prompt for questionId if single mode
    if (result.mode === 'single' && (result.phase === 'ingest' || result.phase === 'search' || result.phase === 'all')) {
        result.questionId = options.questionId || await prompt('Enter questionId: ');
    }

    // Prompt for batch parameters if batch mode
    if (result.mode === 'batch' && (result.phase === 'ingest' || result.phase === 'search' || result.phase === 'all')) {
        result.questionType = options.questionType || await promptChoice(
            'Select question type:',
            ['all', ...QUESTION_TYPES] as const,
            'all'
        );
        
        // Get available question count for validation
        // Skip if setup will run first (questions don't exist yet)
        const willRunSetup = result.phase === 'all' || result.phase === 'setup';
        let questionCount = 0;
        
        if (!willRunSetup) {
            questionCount = getQuestionCount(result.questionType === 'all' ? undefined : result.questionType);
            console.log(`\nFound ${questionCount} questions of this type.`);
            
            if (questionCount === 0) {
                console.log('⚠️  No questions found. Make sure setup phase has been run first.');
                process.exit(1);
            }
        } else {
            console.log(`\nℹ️  Questions will be generated during setup phase.`);
            console.log(`   Batch parameters will be validated after setup completes.`);
            questionCount = 1000; // Use a large number as placeholder for validation
        }
        
        result.startPosition = options.startPosition || await promptNumber(
            `Enter start position${willRunSetup ? ' (will validate after setup)' : ` (1-${questionCount})`}: `,
            1,
            willRunSetup ? undefined : questionCount
        );
        
        result.endPosition = options.endPosition || await promptNumber(
            `Enter end position${willRunSetup ? ' (will validate after setup)' : ` (${result.startPosition}-${questionCount})`}: `,
            result.startPosition,
            willRunSetup ? undefined : questionCount
        );
    }

    // Prompt for answering model if evaluate phase
    if (result.phase === 'evaluate' || result.phase === 'all') {
        result.answeringModel = options.answeringModel || await promptChoice(
            'Select answering model:',
            VALID_MODELS,
            'gpt-4o'
        );
    }

    return result;
}

// =============================================================================
// Validation
// =============================================================================

function getQuestionCount(questionType?: QuestionType): number {
    if (!existsSync(QUESTIONS_DIR)) {
        return 0;
    }

    const files = readdirSync(QUESTIONS_DIR).filter(f => f.endsWith('.json'));
    
    if (!questionType || questionType === 'all') {
        return files.length;
    }

    let count = 0;
    for (const file of files) {
        try {
            const data = JSON.parse(readFileSync(join(QUESTIONS_DIR, file), 'utf8'));
            if (data.question_type === questionType) {
                count++;
            }
        } catch {
            // Skip invalid files
        }
    }
    
    return count;
}

function validateOptions(options: OrchestratorOptions): void {
    // Validate phase
    if (!['setup', 'ingest', 'search', 'evaluate', 'all'].includes(options.phase)) {
        throw new Error(`Invalid phase: ${options.phase}`);
    }

    // Validate mode (required for non-setup phases)
    if (options.phase !== 'setup') {
        if (!options.mode) {
            throw new Error('Mode is required for non-setup phases');
        }
        if (!['single', 'batch'].includes(options.mode)) {
            throw new Error(`Invalid mode: ${options.mode}`);
        }
    }

    // Validate runId (required for non-setup phases)
    if (options.phase !== 'setup' && !options.runId) {
        throw new Error('runId is required for non-setup phases');
    }

    // Validate questionId (required for single mode)
    if (options.mode === 'single' && (options.phase === 'ingest' || options.phase === 'search' || options.phase === 'all')) {
        if (!options.questionId) {
            throw new Error('questionId is required for single mode');
        }
        // Check if question file exists
        const questionFile = join(QUESTIONS_DIR, `${options.questionId}.json`);
        if (!existsSync(questionFile)) {
            throw new Error(`Question file not found: ${questionFile}`);
        }
    }

    // Validate batch parameters
    if (options.mode === 'batch' && (options.phase === 'ingest' || options.phase === 'search' || options.phase === 'all')) {
        if (options.questionType && options.questionType !== 'all' && !QUESTION_TYPES.includes(options.questionType as QuestionType)) {
            throw new Error(`Invalid question type: ${options.questionType}`);
        }
        
        if (options.startPosition === undefined || options.endPosition === undefined) {
            throw new Error('startPosition and endPosition are required for batch mode');
        }
        
        // Skip question count validation if setup phase will run first (questions don't exist yet)
        const willRunSetup = options.phase === 'all' || options.phase === 'setup';
        if (!willRunSetup) {
            const questionCount = getQuestionCount(options.questionType === 'all' ? undefined : options.questionType);
            if (questionCount === 0) {
                throw new Error(`No questions found for type: ${options.questionType || 'all'}. Run setup phase first to generate questions.`);
            }
            
            if (options.startPosition < 1 || options.startPosition > questionCount) {
                throw new Error(`startPosition must be between 1 and ${questionCount}`);
            }
            
            if (options.endPosition < options.startPosition || options.endPosition > questionCount) {
                throw new Error(`endPosition must be between ${options.startPosition} and ${questionCount}`);
            }
        }
    }

    // Validate answering model
    if ((options.phase === 'evaluate' || options.phase === 'all') && options.answeringModel) {
        if (!VALID_MODELS.includes(options.answeringModel as typeof VALID_MODELS[number])) {
            throw new Error(`Invalid answering model: ${options.answeringModel}. Valid models: ${VALID_MODELS.join(', ')}`);
        }
    }

    // Validate dataset exists for setup phase
    if (options.phase === 'setup' || options.phase === 'all') {
        if (!existsSync(DATASET_FILE)) {
            throw new Error(`Dataset file not found: ${DATASET_FILE}\nPlease download longmemeval_s_cleaned.json from HuggingFace and place it in ${DATASETS_DIR}`);
        }
    }
}

// =============================================================================
// Script Execution
// =============================================================================

async function executeScript(command: string[], cwd: string = ROOT_DIR): Promise<boolean> {
    console.log(`\nExecuting: ${command.join(' ')}`);
    console.log('─'.repeat(60));
    
    try {
        const proc = Bun.spawn(command, {
            cwd,
            stdout: 'inherit',
            stderr: 'inherit',
        });

        const exitCode = await proc.exited;
        
        if (exitCode === 0) {
            console.log('─'.repeat(60));
            console.log('✓ Success\n');
            return true;
        } else {
            console.log('─'.repeat(60));
            console.log(`✗ Failed with exit code ${exitCode}\n`);
            return false;
        }
    } catch (error) {
        console.log('─'.repeat(60));
        console.error(`✗ Error executing command: ${error}\n`);
        return false;
    }
}

// =============================================================================
// Phase Execution Functions
// =============================================================================

async function runSetup(): Promise<boolean> {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('PHASE: Setup');
    console.log('═══════════════════════════════════════════════════════════');
    
    return await executeScript([
        'bun',
        'run',
        join(SCRIPTS_DIR, 'setup', 'split_questions.ts')
    ]);
}

async function runIngest(options: OrchestratorOptions): Promise<boolean> {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('PHASE: Ingest');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (options.mode === 'single') {
        if (!options.questionId || !options.runId) {
            throw new Error('questionId and runId are required for single ingest');
        }
        return await executeScript([
            'bun',
            'run',
            join(SCRIPTS_DIR, 'ingest', 'ingest.ts'),
            options.questionId,
            options.runId
        ]);
    } else {
        // Batch mode
        if (!options.runId || !options.questionType || options.startPosition === undefined || options.endPosition === undefined) {
            throw new Error('runId, questionType, startPosition, and endPosition are required for batch ingest');
        }
        
        const scriptPath = join(SCRIPTS_DIR, 'ingest', 'ingest-batch.sh');
        return await executeScript([
            'bash',
            scriptPath,
            `--runId=${options.runId}`,
            `--questionType=${options.questionType}`,
            `--startPosition=${options.startPosition}`,
            `--endPosition=${options.endPosition}`
        ]);
    }
}

async function runSearch(options: OrchestratorOptions): Promise<boolean> {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('PHASE: Search');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (options.mode === 'single') {
        if (!options.questionId || !options.runId) {
            throw new Error('questionId and runId are required for single search');
        }
        return await executeScript([
            'bun',
            'run',
            join(SCRIPTS_DIR, 'search', 'search.ts'),
            options.questionId,
            options.runId
        ]);
    } else {
        // Batch mode
        if (!options.runId || options.startPosition === undefined || options.endPosition === undefined) {
            throw new Error('runId, startPosition, and endPosition are required for batch search');
        }
        
        const scriptPath = join(SCRIPTS_DIR, 'search', 'search-batch.sh');
        const args = [
            'bash',
            scriptPath,
            `--runId=${options.runId}`,
            `--startPosition=${options.startPosition}`,
            `--endPosition=${options.endPosition}`
        ];
        
        if (options.questionType) {
            args.push(`--questionType=${options.questionType}`);
        }
        
        return await executeScript(args);
    }
}

async function runEvaluate(options: OrchestratorOptions): Promise<boolean> {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('PHASE: Evaluate');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (!options.runId) {
        throw new Error('runId is required for evaluation');
    }
    
    const answeringModel = options.answeringModel || 'gpt-4o';
    
    // Use batch script if we have batch parameters, otherwise use direct evaluate.ts
    const hasBatchParams = options.questionType || 
                           (options.startPosition !== undefined && options.endPosition !== undefined);
    
    if (hasBatchParams && options.mode === 'batch') {
        // Batch evaluation - use evaluate-batch.sh
        const scriptPath = join(SCRIPTS_DIR, 'evaluate', 'evaluate-batch.sh');
        const args = [
            'bash',
            scriptPath,
            `--runId=${options.runId}`,
            `--answeringModel=${answeringModel}`
        ];
        
        if (options.questionType) {
            args.push(`--questionType=${options.questionType}`);
        }
        
        if (options.startPosition !== undefined && options.endPosition !== undefined) {
            args.push(`--startPosition=${options.startPosition}`);
            args.push(`--endPosition=${options.endPosition}`);
        }
        
        return await executeScript(args);
    } else {
        // Single evaluation - use evaluate.ts directly
        // evaluate.ts supports optional questionType, startPosition, endPosition
        const args = [
            'bun',
            'run',
            join(SCRIPTS_DIR, 'evaluate', 'evaluate.ts'),
            options.runId,
            answeringModel
        ];
        
        if (options.questionType && options.questionType !== 'all') {
            args.push(options.questionType);
        }
        
        if (options.startPosition !== undefined && options.endPosition !== undefined) {
            args.push(options.startPosition.toString());
            args.push(options.endPosition.toString());
        }
        
        return await executeScript(args);
    }
}

async function runPipeline(options: OrchestratorOptions): Promise<boolean> {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║          LongMemEval Pipeline Orchestrator                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`\nConfiguration:`);
    console.log(`  Phase: ${options.phase}`);
    console.log(`  Mode: ${options.mode || 'N/A'}`);
    console.log(`  Run ID: ${options.runId || 'N/A'}`);
    if (options.questionId) console.log(`  Question ID: ${options.questionId}`);
    if (options.questionType) console.log(`  Question Type: ${options.questionType}`);
    if (options.startPosition !== undefined) console.log(`  Start Position: ${options.startPosition}`);
    if (options.endPosition !== undefined) console.log(`  End Position: ${options.endPosition}`);
    if (options.answeringModel) console.log(`  Answering Model: ${options.answeringModel}`);
    console.log('');

    const phases: Phase[] = options.phase === 'all' 
        ? ['setup', 'ingest', 'search', 'evaluate']
        : [options.phase];

    for (const phase of phases) {
        let success = false;
        
        try {
            switch (phase) {
                case 'setup':
                    success = await runSetup();
                    // After setup, validate batch parameters if needed
                    if (success && options.mode === 'batch' && (options.phase === 'all' || options.phase === 'ingest' || options.phase === 'search')) {
                        const questionCount = getQuestionCount(options.questionType === 'all' ? undefined : options.questionType);
                        if (questionCount === 0) {
                            throw new Error(`No questions found for type: ${options.questionType || 'all'} after setup. Check dataset file.`);
                        }
                        if (options.startPosition !== undefined && options.endPosition !== undefined) {
                            if (options.startPosition < 1 || options.startPosition > questionCount) {
                                throw new Error(`startPosition ${options.startPosition} must be between 1 and ${questionCount}`);
                            }
                            if (options.endPosition < options.startPosition || options.endPosition > questionCount) {
                                throw new Error(`endPosition ${options.endPosition} must be between ${options.startPosition} and ${questionCount}`);
                            }
                        }
                    }
                    break;
                case 'ingest':
                    success = await runIngest(options);
                    break;
                case 'search':
                    success = await runSearch(options);
                    break;
                case 'evaluate':
                    success = await runEvaluate(options);
                    break;
            }
            
            if (!success) {
                console.error(`\n✗ Pipeline failed at phase: ${phase}`);
                return false;
            }
        } catch (error) {
            console.error(`\n✗ Error in phase ${phase}:`, error);
            return false;
        }
    }

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║              Pipeline Completed Successfully               ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    return true;
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
    try {
        // Parse CLI arguments
        const cliOptions = parseArgs();
        
        // Prompt for missing options if needed
        const options = await promptMissing(cliOptions);
        
        // Validate options
        validateOptions(options);
        
        // Run pipeline
        const success = await runPipeline(options);
        
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('\n✗ Orchestrator Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Run if executed directly
if (import.meta.main) {
    main();
}

