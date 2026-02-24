/**
 * Helper utilities for starting/stopping the MCP server in tests
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env file to get API key for test server
dotenv.config();

let serverProcess: ChildProcess | null = null;
let serverPort: number = 8000;

/**
 * Kill any process using a specific port
 */
export function killProcessOnPort(port: number): void {
    try {
        // Find process using the port (works on Linux/Mac)
        const result = execSync(
            `lsof -ti:${port} 2>/dev/null || true`,
            { encoding: "utf-8" }
        );
        const pids = result.trim().split("\n").filter((pid) => pid);
        pids.forEach((pid) => {
            try {
                execSync(`kill -9 ${pid} 2>/dev/null || true`);
            } catch (e) {
                // Ignore errors
            }
        });
    } catch (e) {
        // Ignore errors - port might not be in use
    }
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const testServer: Server = createServer();
        let resolved = false;

        const cleanup = (result: boolean) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                testServer.removeAllListeners();
                testServer.close(() => {
                    resolve(result);
                });
            }
        };

        const timeout = setTimeout(() => {
            cleanup(false);
        }, 500);

        testServer.listen(port, () => {
            cleanup(true);
        });

        testServer.on("error", () => {
            cleanup(false);
        });
    });
}

/**
 * Start the MCP server on a given port
 */
export async function startMcpServer(port: number = 8000): Promise<void> {
    serverPort = port;

    // Stop any existing server first
    if (serverProcess) {
        await stopMcpServer();
    }

    const portAvailable = await isPortAvailable(port);
    if (!portAvailable) {
        throw new Error(
            `[MCP Server] Port ${port} is in use. Prompt0 requires a single fixed port with no fallback.`
        );
    }

    return new Promise((resolve, reject) => {
        // Start the server (part2 server is in the root of the project)
        console.log(`[MCP Server] Starting server on port ${port}...`);
        // Ensure we have the API key from .env
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            // Try to load from .env file directly
            try {
                const envContent = readFileSync(join(process.cwd(), ".env"), "utf-8");
                const apiKeyMatch = envContent.match(/OPENAI_API_KEY=(.+)/);
                if (apiKeyMatch) {
                    process.env.OPENAI_API_KEY = apiKeyMatch[1].trim();
                }
            } catch (e) {
                console.warn("[MCP Server] Could not load .env file, API key may be missing");
            }
        }

        serverProcess = spawn("pnpm", ["start"], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                PORT_BACKEND: String(port),
                // Use test database for server in tests
                DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://testuser:testpass@localhost:5433/testdb",
                // OpenAI API key is needed for embeddings
                OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                // Unset Redis so server uses sync fallback (no worker in test env)
                UPSTASH_REDIS_REST_URL: "",
                UPSTASH_REDIS_REST_TOKEN: "",
            },
            stdio: "pipe",
            shell: true,
            detached: false,
        });

        let serverReady = false;
        let outputBuffer = "";
        let pollInterval: NodeJS.Timeout | null = null;
        let startupTimeout: NodeJS.Timeout | null = null;

        const checkServerReady = (): void => {
            if (serverReady) return;

            // Try to connect to the server
            const testReq = httpRequest(
                {
                    hostname: "localhost",
                    port: port,
                    path: "/mcp",
                    method: "OPTIONS",
                    timeout: 1000,
                },
                () => {
                    // Server is responding
                    if (!serverReady) {
                        serverReady = true;
                        if (pollInterval) clearInterval(pollInterval);
                        if (startupTimeout) {
                            clearTimeout(startupTimeout);
                            startupTimeout = null;
                        }
                        console.log(
                            `[MCP Server] Server is ready on port ${port}`
                        );
                        setTimeout(() => resolve(), 200);
                    }
                }
            );

            testReq.on("error", () => {
                // Server not ready yet, will retry
            });
            testReq.on("timeout", () => {
                testReq.destroy();
            });
            testReq.end();
        };

        const stdoutHandler = (data: Buffer) => {
            const output = data.toString();
            outputBuffer += output;
            if (!serverReady) {
                console.log(`[MCP Server] ${output}`);
            }
            // Check for server ready message
            if (
                output.includes("listening on") ||
                output.includes("MCP endpoint")
            ) {
                // Start checking if server is actually responding
                setTimeout(checkServerReady, 500);
            }
        };

        const stderrHandler = (data: Buffer) => {
            const output = data.toString();
            outputBuffer += output;
            if (!serverReady) {
                console.error(`[MCP Server Error] ${output}`);
            }
            // Also check stderr for server ready message
            if (
                output.includes("listening on") ||
                output.includes("MCP endpoint")
            ) {
                setTimeout(checkServerReady, 500);
            }
        };

        serverProcess.stdout?.on("data", stdoutHandler);
        serverProcess.stderr?.on("data", stderrHandler);

        // Poll for server readiness every 500ms
        checkServerReady(); // Try immediately
        pollInterval = setInterval(() => {
            if (!serverReady) {
                checkServerReady();
            } else {
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
            }
        }, 500);

        serverProcess.on("error", (error) => {
            reject(error);
        });

        serverProcess.on("exit", (code) => {
            if (code !== 0 && code !== null && !serverReady) {
                if (startupTimeout) {
                    clearTimeout(startupTimeout);
                    startupTimeout = null;
                }
                reject(
                    new Error(`Server exited with code ${code} before becoming ready`)
                );
            }
        });

        // Timeout after 15 seconds
        startupTimeout = setTimeout(() => {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
            if (!serverReady) {
                // Clean up before rejecting
                if (serverProcess) {
                    serverProcess.stdout?.removeAllListeners();
                    serverProcess.stderr?.removeAllListeners();
                    serverProcess.stdout?.destroy();
                    serverProcess.stderr?.destroy();
                    try {
                        serverProcess.kill("SIGKILL");
                    } catch (e) {
                        // Ignore
                    }
                    serverProcess = null;
                }
                reject(
                    new Error(
                        `Server failed to start within 15 seconds. Last output: ${outputBuffer.slice(-500)}`
                    )
                );
            }
        }, 15000);
    });
}

/**
 * Stop the MCP server
 */
export async function stopMcpServer(): Promise<void> {
    if (serverProcess) {
        return new Promise((resolve) => {
            const proc = serverProcess;
            serverProcess = null;

            if (proc) {
                // Remove all listeners immediately
                proc.stdout?.removeAllListeners();
                proc.stderr?.removeAllListeners();
                proc.removeAllListeners();

                // Destroy streams
                proc.stdout?.destroy();
                proc.stderr?.destroy();

                // Kill the process
                let resolved = false;
                let forceKillTimeout: NodeJS.Timeout | null = null;
                const cleanup = () => {
                    if (!resolved) {
                        resolved = true;
                        if (forceKillTimeout) {
                            clearTimeout(forceKillTimeout);
                            forceKillTimeout = null;
                        }
                        resolve();
                    }
                };

                try {
                    proc.kill("SIGTERM");
                } catch (e) {
                    cleanup();
                    return;
                }

                // Wait for exit
                proc.once("exit", cleanup);

                // Force kill after 500ms if still running
                forceKillTimeout = setTimeout(() => {
                    if (!resolved) {
                        try {
                            proc.kill("SIGKILL");
                        } catch (e) {
                            // Ignore errors
                        }
                        cleanup();
                    }
                }, 500);
            } else {
                resolve();
            }
        });
    }
}

/**
 * Get the server port
 */
export function getServerPort(): number {
    return serverPort;
}

