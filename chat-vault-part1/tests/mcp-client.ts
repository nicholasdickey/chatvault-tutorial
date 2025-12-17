/**
 * MCP Client utility for testing
 * Simulates how the Apps SDK would call the MCP server
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { URL } from "node:url";

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: string;
    params?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: string | number | null;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export class McpTestClient {
    private baseUrl: string;
    private sessionId: string | null = null;

    constructor(baseUrl: string = "http://localhost:8000") {
        this.baseUrl = baseUrl;
    }

    /**
     * Send a JSON-RPC request to the MCP server
     */
    async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
        const id = Date.now() + Math.random();
        const request: JsonRpcRequest = {
            jsonrpc: "2.0",
            id,
            method,
            params: params || {},
        };

        const url = new URL(`${this.baseUrl}/mcp`);
        const body = JSON.stringify(request);

        return new Promise((resolve, reject) => {
            const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
            const apiKey = process.env.API_KEY;
            const req = httpRequest(
                {
                    hostname: url.hostname,
                    port: port,
                    path: url.pathname,
                    method: "POST",
                    // Avoid keeping sockets open across tests (Jest open handle / TCPWRAP)
                    agent: false,
                    headers: {
                        Connection: "close",
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(body),
                        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
                        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    },
                },
                (res: IncomingMessage) => {
                    let responseData = "";

                    res.on("data", (chunk) => {
                        responseData += chunk.toString();
                    });

                    res.on("end", () => {
                        if (res.statusCode === 204) {
                            // Notification response
                            const sessionIdHeader = res.headers["mcp-session-id"];
                            if (sessionIdHeader && typeof sessionIdHeader === "string") {
                                this.sessionId = sessionIdHeader;
                            }
                            resolve({
                                jsonrpc: "2.0",
                                id: null,
                            });
                            return;
                        }

                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            const sessionIdHeader = res.headers["mcp-session-id"];
                            if (sessionIdHeader && typeof sessionIdHeader === "string") {
                                this.sessionId = sessionIdHeader;
                            }

                            try {
                                const response: JsonRpcResponse = JSON.parse(responseData);
                                resolve(response);
                            } catch (error) {
                                reject(
                                    new Error(
                                        `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`
                                    )
                                );
                            }
                        } else {
                            reject(
                                new Error(
                                    `Request failed with status ${res.statusCode}: ${responseData}`
                                )
                            );
                        }
                    });
                }
            );

            req.on("error", reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Initialize the MCP session
     */
    async initialize(): Promise<JsonRpcResponse> {
        const response = await this.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
                name: "jest-test-client",
                version: "1.0.0",
            },
        });

        // Send initialized notification (without id)
        if (this.sessionId) {
            await this.sendNotification("notifications/initialized", {});
        }

        return response;
    }

    /**
     * Send a notification (request without id)
     */
    async sendNotification(method: string, params?: unknown): Promise<void> {
        const url = new URL(`${this.baseUrl}/mcp`);
        const request = {
            jsonrpc: "2.0",
            method,
            params: params || {},
            // No id field for notifications
        };
        const body = JSON.stringify(request);

        return new Promise((resolve, reject) => {
            const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
            const apiKey = process.env.API_KEY;
            const req = httpRequest(
                {
                    hostname: url.hostname,
                    port: port,
                    path: url.pathname,
                    method: "POST",
                    // Avoid keeping sockets open across tests (Jest open handle / TCPWRAP)
                    agent: false,
                    headers: {
                        Connection: "close",
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(body),
                        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
                        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    },
                },
                (res: IncomingMessage) => {
                    // Notifications return 204 No Content
                    if (res.statusCode === 204) {
                        const sessionIdHeader = res.headers["mcp-session-id"];
                        if (sessionIdHeader && typeof sessionIdHeader === "string") {
                            this.sessionId = sessionIdHeader;
                        }
                        resolve();
                    } else {
                        let responseData = "";
                        res.on("data", (chunk) => {
                            responseData += chunk.toString();
                        });
                        res.on("end", () => {
                            reject(new Error(`Notification failed with status ${res.statusCode}: ${responseData}`));
                        });
                    }
                }
            );

            req.on("error", reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * List available tools
     */
    async listTools(): Promise<JsonRpcResponse> {
        return this.request("tools/list");
    }

    /**
     * Call a tool
     */
    async callTool(name: string, arguments_: unknown): Promise<JsonRpcResponse> {
        return this.request("tools/call", {
            name,
            arguments: arguments_,
        });
    }

    /**
     * List available resources
     */
    async listResources(): Promise<JsonRpcResponse> {
        return this.request("resources/list");
    }

    /**
     * Read a resource
     */
    async readResource(uri: string): Promise<JsonRpcResponse> {
        return this.request("resources/read", { uri });
    }

    /**
     * List resource templates
     */
    async listResourceTemplates(): Promise<JsonRpcResponse> {
        return this.request("resources/listTemplates");
    }

    getSessionId(): string | null {
        return this.sessionId;
    }
}

