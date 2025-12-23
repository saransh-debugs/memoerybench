
export interface Config {
    apiKey: string;
    baseUrl: string;
    googleVertexProjectId: string;
}

export const config: Config = {
    apiKey: process.env.SUPERMEMORY_API_KEY || "",
    baseUrl: process.env.SUPERMEMORY_API_URL || "https://api.supermemory.ai",
    googleVertexProjectId: process.env.GOOGLE_VERTEX_PROJECT_ID || "",
};

const ENV_VAR_MAP: Record<keyof Config, string> = {
    apiKey: 'SUPERMEMORY_API_KEY',
    baseUrl: 'SUPERMEMORY_API_URL',
    googleVertexProjectId: 'GOOGLE_VERTEX_PROJECT_ID',
};

export function validateConfig(required: (keyof Config)[]) {
    const missing = required.filter(key => !config[key]);
    if (missing.length > 0) {
        const envVars = missing.map(key => ENV_VAR_MAP[key]).join(', ');
        console.error(`Missing required environment variables: ${envVars}`);
        console.error(`Please set these environment variables before running the script.`);
        process.exit(1);
    }
}

