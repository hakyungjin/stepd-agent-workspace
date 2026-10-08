import "server-only";
import { MockStepDGateway } from "./mock-gateway";
import { McpStepDGateway } from "./mcp-gateway";
import type { StepDGateway } from "./gateway";
export function getGateway(): StepDGateway {
  return process.env.STEPD_GATEWAY === "mcp"
    ? new McpStepDGateway()
    : new MockStepDGateway();
}
