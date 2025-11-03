import path from 'path';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const AgentMdFrontMatterSchema = z.object({
    name: z.string().min(1, 'Agent name is required.'),
    description: z.string().min(1, 'Agent description is required.'),
    tools: z
        .union([
            z.array(z.string()),
            z.string().transform(s => s.split(',').map(t => t.trim()).filter(Boolean)),
            z.null(),
        ])
        .optional()
        .transform(value => {
            if (value == null) {
                return [];
            }
            return value;
        }),
    model: z.string().optional(),
    sub_agents: z.string().optional(),
});

type AgentMdFrontMatter = z.infer<typeof AgentMdFrontMatterSchema>;

interface AgentMdFile {
    name: string;
    description: string;
    tools?: string[];
    model?: string;
    sub_agents?: string;
    prompt: string;
}

export async function parseAgentMdFile(filePath: string): Promise<AgentMdFile | null> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parts = content.split('---');
        if (parts.length < 3) {
            console.error(`[Agent Loader] Invalid .agent.md format (missing front matter): ${filePath}`);
            return null;
        }
        const frontMatterSource = parts[1]!;
        const frontMatter = yaml.load(frontMatterSource) ?? {};
        const parsedFrontMatter = AgentMdFrontMatterSchema.parse(frontMatter);
        const prompt = parts.slice(2).join('---').trim();

        if (!prompt) {
            console.error(`[Agent Loader] Missing prompt content in ${filePath}`);
            return null;
        }

        const toolsFromFrontMatter = parsedFrontMatter.tools;
        let normalizedTools: string[] | undefined;
        if (toolsFromFrontMatter && toolsFromFrontMatter.length > 0) {
            const trimmedTools = toolsFromFrontMatter
                .map(tool => tool.trim())
                .filter((tool): tool is string => tool.length > 0);
            if (trimmedTools.length > 0) {
                normalizedTools = Array.from(new Set(trimmedTools));
            }
        }

        return {
            name: parsedFrontMatter.name,
            description: parsedFrontMatter.description,
            tools: normalizedTools,
            model: parsedFrontMatter.model,
            sub_agents: parsedFrontMatter.sub_agents,
            prompt,
        };
    } catch (error) {
        console.error(`[Agent Loader] Failed to parse or validate ${filePath}:`, error);
        return null;
    }
}

interface LoadAgentPipelineConfigOptions {
    coordinatorFileName?: string; // e.g., 'coordinator.agent.md'
    systemPrompt?: string;
    systemPromptFactory?: () => string;
    allowedTools?: string[];
    disallowedTools?: string[];
}

export async function loadAgentPipelineConfig(
    driverDir: string,
    options?: LoadAgentPipelineConfigOptions
): Promise<{
    systemPrompt: string;
    agents?: Record<string, AgentDefinition>;
    allowedTools?: string[];
    disallowedTools?: string[];
}> {
    let systemPrompt: string = options?.systemPrompt || '';
    let agents: Record<string, AgentDefinition> | undefined;
    let allowedTools: string[] | undefined = options?.allowedTools;
    let disallowedTools: string[] | undefined = options?.disallowedTools;

    if (options?.systemPromptFactory) {
        systemPrompt = options.systemPromptFactory();
    }

    if (options?.coordinatorFileName) {
        const coordinatorPath = path.join(driverDir, options.coordinatorFileName);
        const coordinatorConfig = await parseAgentMdFile(coordinatorPath);

        if (!coordinatorConfig) {
            throw new Error(`Could not load or parse ${options.coordinatorFileName} in ${driverDir}`);
        }

        systemPrompt = coordinatorConfig.prompt;
        const coordinatorTools = coordinatorConfig.tools;
        if (coordinatorTools && coordinatorTools.length > 0) {
            const merged = new Set<string>(allowedTools ?? []);
            for (const tool of coordinatorTools) {
                if (tool) {
                    merged.add(tool);
                }
            }
            allowedTools = Array.from(merged);
        }

        if (coordinatorConfig.sub_agents) {
            const subAgentGlob = path.join(driverDir, coordinatorConfig.sub_agents);
            const subAgentFiles = await glob(subAgentGlob);

            agents = {};
            for (const file of subAgentFiles) {
                const agentConfig = await parseAgentMdFile(file);
                if (agentConfig) {
                    const definition: AgentDefinition = {
                        description: agentConfig.description,
                        prompt: agentConfig.prompt,
                    };
                    if (agentConfig.tools && agentConfig.tools.length > 0) {
                        definition.tools = agentConfig.tools;
                    }
                    if (agentConfig.model) {
                        definition.model = agentConfig.model as any;
                    }
                    agents[agentConfig.name] = definition;
                }
            }
        }
    }

    return {
        systemPrompt,
        agents,
        allowedTools,
        disallowedTools,
    };
}
