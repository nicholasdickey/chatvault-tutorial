/**
 * Helper utilities for starting/stopping the MCP server in tests
 */

console.log(`[DEBUG] mcp-server-helper.ts module loading, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { request as httpRequest } from "node:http";

let serverProcess: ChildProcess | null = null;
let serverPort: number = 8017;

/**
 * Kill any process using a specific port
 */
function killProcessOnPort(port: number): void {
    try {
        // Find process using the port (works on Linux/Mac)
        const result = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf-8' });
        const pids = result.trim().split('\n').filter(pid => pid);
        pids.forEach(pid => {
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
 * Clean up test port (8017)
 */
export function cleanupTestPorts(): void {
    killProcessOnPort(8017);
    // Also kill any tsx server processes as a safety net
    try {
        execSync(`pkill -f "tsx src/server.ts" 2>/dev/null || true`);
    } catch (e) {
        // Ignore errors
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
        }, 500); // Reduced timeout

        testServer.listen(port, () => {
            cleanup(true);
        });

        testServer.on("error", (err: NodeJS.ErrnoException) => {
            cleanup(false);
        });
    });
}

/**
 * Start the MCP server on a given port
 */
export async function startMcpServer(port: number = 8017): Promise<void> {
    serverPort = port;

    // Stop any existing server first
    if (serverProcess) {
        await stopMcpServer();
    }

    // Clean up any processes on the requested port first
    killProcessOnPort(port);
    // Wait a bit for port to be released
    await new Promise(resolve => setTimeout(resolve, 200));

    // Try to find an available port if the requested one is in use
    let actualPort = port;
    let portAvailable = await isPortAvailable(actualPort);

    if (!portAvailable) {
        console.log(`[MCP Server] Port ${actualPort} is in use, trying to find available port...`);
        // Try ports 8000-8020 (expanded range)
        for (let p = 8000; p <= 8020; p++) {
            // Clean up port before checking
            killProcessOnPort(p);
            await new Promise(resolve => setTimeout(resolve, 100));

            if (await isPortAvailable(p)) {
                actualPort = p;
                portAvailable = true;
                serverPort = p;
                console.log(`[MCP Server] Using port ${actualPort} instead`);
                break;
            }
        }
        if (!portAvailable) {
            throw new Error(`Could not find an available port in range 8000-8020`);
        }
    }

    return new Promise((resolve, reject) => {
        // Start the server
        const serverPath = process.cwd() + "/mcp_server";
        console.log(`[MCP Server] Starting server on port ${actualPort}...`);
        console.log(`[DEBUG] Spawning server process, port: ${actualPort}, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
        serverProcess = spawn("pnpm", ["start"], {
            cwd: serverPath,
            env: {
                ...process.env,
                PORT: String(actualPort), // Use the actual port we found
            },
            stdio: "pipe",
            shell: true,
            detached: false, // Ensure process is part of the test process group
        });

        let serverReady = false;
        let outputBuffer = "";
        let pollInterval: NodeJS.Timeout | null = null;

        const checkServerReady = (): void => {
            if (serverReady) return;

            // Try to connect to the server
            const testReq = httpRequest(
                {
                    hostname: "localhost",
                    port: actualPort,
                    path: "/mcp",
                    method: "OPTIONS",
                    timeout: 1000,
                },
                () => {
                    // Server is responding
                    if (!serverReady) {
                        serverReady = true;
                        if (pollInterval) clearInterval(pollInterval);
                        console.log(`[MCP Server] Server is ready on port ${actualPort}`);
                        console.log(`[DEBUG] Server ready, port: ${actualPort}, PID: ${process.pid}, serverPid: ${serverProcess?.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
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
            if (output.includes("listening on") || output.includes("MCP endpoint")) {
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
            if (output.includes("listening on") || output.includes("MCP endpoint")) {
                setTimeout(checkServerReady, 500);
            }
        };

        serverProcess.stdout?.on("data", stdoutHandler);
        serverProcess.stderr?.on("data", stderrHandler);

        // Poll for server readiness every 500ms (start immediately, don't wait for output)
        // This handles cases where server starts but output is buffered
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
            // Only reject if server wasn't ready yet
            // If server was ready and exits, it's likely being stopped by cleanup
            if (code !== 0 && code !== null && !serverReady) {
                reject(new Error(`Server exited with code ${code} before becoming ready`));
            }
            // If server exits after being ready, don't reject (it might be cleanup)
        });

        // Timeout after 15 seconds
        setTimeout(() => {
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
                reject(new Error(`Server failed to start within 15 seconds. Last output: ${outputBuffer.slice(-500)}`));
            }
        }, 15000);
    });
}

/**
 * Stop the MCP server
 */
export async function stopMcpServer(): Promise<void> {
    console.log(`[DEBUG] stopMcpServer() called, PID: ${process.pid}, serverProcess: ${serverProcess ? serverProcess.pid : 'null'}, Memory: ${JSON.stringify(process.memoryUsage())}`);
    if (serverProcess) {
        return new Promise((resolve) => {
            const proc = serverProcess;
            serverProcess = null;

            if (proc) {
                console.log(`[DEBUG] stopMcpServer: Removing listeners, Memory: ${JSON.stringify(process.memoryUsage())}`);
                // Remove all listeners immediately to prevent logging after test completion
                proc.stdout?.removeAllListeners();
                proc.stderr?.removeAllListeners();
                proc.removeAllListeners();
                console.log(`[DEBUG] stopMcpServer: Listeners removed, Memory: ${JSON.stringify(process.memoryUsage())}`);

                console.log(`[DEBUG] stopMcpServer: Destroying streams, Memory: ${JSON.stringify(process.memoryUsage())}`);
                // Destroy streams to prevent further I/O
                proc.stdout?.destroy();
                proc.stderr?.destroy();
                console.log(`[DEBUG] stopMcpServer: Streams destroyed, Memory: ${JSON.stringify(process.memoryUsage())}`);

                // Kill the process
                let resolved = false;
                const cleanup = () => {
                    console.log(`[DEBUG] stopMcpServer: cleanup() called, Memory: ${JSON.stringify(process.memoryUsage())}`);
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                };

                try {
                    console.log(`[DEBUG] stopMcpServer: About to kill process with SIGTERM, Memory: ${JSON.stringify(process.memoryUsage())}`);
                    proc.kill("SIGTERM");
                    console.log(`[DEBUG] stopMcpServer: SIGTERM sent, Memory: ${JSON.stringify(process.memoryUsage())}`);
                } catch (e) {
                    console.log(`[DEBUG] stopMcpServer: Error killing process: ${e}, Memory: ${JSON.stringify(process.memoryUsage())}`);
                    // Process may already be dead
                    cleanup();
                    return;
                }

                console.log(`[DEBUG] stopMcpServer: Setting up exit listener, Memory: ${JSON.stringify(process.memoryUsage())}`);
                // Wait for exit
                proc.once("exit", cleanup);
                console.log(`[DEBUG] stopMcpServer: Exit listener set, Memory: ${JSON.stringify(process.memoryUsage())}`);

                // Force kill after 500ms if still running
                setTimeout(() => {
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

