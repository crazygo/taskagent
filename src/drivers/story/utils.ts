import path from 'path';
import { promises as fs } from 'fs';

import { buildStoryAgentsConfig, buildStorySystemPrompt } from './prompt.js';
import type { DriverPrepareResult } from '../pipeline.js';
const FEATURE_DIRECTIVE_REGEX = /^(?:feature|slug)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*(.*)$/i;

export interface StoryInputPreparation {
    featureSlug?: string;
    userPrompt: string;
    absolutePath?: string;
    relativePath?: string;
}

const sanitizeSlug = (raw?: string): string | undefined => {
    if (!raw) {
        return undefined;
    }
    const cleaned = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned.length > 0 ? cleaned : undefined;
};

const extractDirective = (
    firstLine: string
): { slug?: string; remainder: string } => {
    const match = FEATURE_DIRECTIVE_REGEX.exec(firstLine.trim());
    if (!match) {
        return { slug: undefined, remainder: firstLine };
    }
    const [, slug, trailing] = match;
    const remainder = trailing?.trim().length ? trailing.trim() : '';
    return { slug, remainder };
};

export const prepareStoryInput = async (
    rawInput: string,
    workspacePath?: string | null
): Promise<StoryInputPreparation> => {
    const trimmed = rawInput.trim();
    const [firstLine, ...rest] = trimmed.split(/\r?\n/);
    const { slug: directiveSlug, remainder } = extractDirective(firstLine ?? '');
    const featureSlug = sanitizeSlug(directiveSlug);

    const restLines: string[] = [];
    if (remainder) {
        restLines.push(remainder);
    }
    if (rest.length) {
        restLines.push(...rest);
    }
    const userPrompt = restLines.join('\n').trim();

    let relativePath: string | undefined;
    let absolutePath: string | undefined;

    if (featureSlug) {
        const baseDir =
            workspacePath && workspacePath.trim().length > 0
                ? workspacePath
                : process.cwd();
        relativePath = path.join('.askman', 'features', featureSlug, 'story.md');
        absolutePath = path.resolve(baseDir, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    return {
        featureSlug,
        userPrompt: userPrompt.length > 0 ? userPrompt : trimmed,
        absolutePath,
        relativePath,
    };
};

export const prepareStoryAgentInvocation = async (
    rawInput: string,
    workspacePath?: string | null
): Promise<DriverPrepareResult> => {
    const storyInput = await prepareStoryInput(rawInput, workspacePath);

    const overrides: DriverPrepareResult['overrides'] = {
        systemPrompt: buildStorySystemPrompt({
            featureSlug: storyInput.featureSlug,
            storyFilePath: storyInput.absolutePath,
            relativePath: storyInput.relativePath,
        }),
    };

    const agentDefinitions = buildStoryAgentsConfig({
        featureSlug: storyInput.featureSlug,
        storyFilePath: storyInput.absolutePath,
        relativePath: storyInput.relativePath,
    });

    if (storyInput.featureSlug && storyInput.absolutePath && Object.keys(agentDefinitions).length > 0) {
        overrides.agents = agentDefinitions;
    }

    const agentsState = overrides.agents ? 'enabled' : 'pending';

    return {
        prompt: storyInput.userPrompt,
        overrides,
        flowId: 'story',
        debugLog: `[StoryDriver] Prepared feature="${storyInput.featureSlug ?? '(pending)'}" path=${storyInput.relativePath ?? '(pending)'} agents=${agentsState}`,
    };
};
