import { Buffer } from "node:buffer";
import { createConnection } from "node:net";

import type { ClamAvConfig, VirusScanInput, VirusScanResult, VirusScanner } from "../types.js";

const CHUNK_SIZE = 64 * 1024;

export function createClamAvScanner(config: ClamAvConfig): VirusScanner {
  return {
    scan(input: VirusScanInput): Promise<VirusScanResult> {
      return new Promise((resolve) => {
        const socket = createConnection({ host: config.host, port: config.port });
        const response: Buffer[] = [];
        let settled = false;
        const finish = (result: VirusScanResult) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };
        socket.setTimeout(config.timeoutMs, () =>
          finish({ status: "unavailable", detail: "clamav_timeout" })
        );
        socket.on("error", (error) =>
          finish({ status: "unavailable", detail: `clamav_${error.message}` })
        );
        socket.on("data", (chunk) => response.push(Buffer.from(chunk)));
        socket.on("end", () =>
          finish(parseClamAvResponse(Buffer.concat(response).toString("utf8")))
        );
        socket.on("connect", () => {
          socket.write("zINSTREAM\0");
          const data = Buffer.from(input.data);
          for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
            const chunk = data.subarray(offset, Math.min(offset + CHUNK_SIZE, data.length));
            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(chunk.length, 0);
            socket.write(length);
            socket.write(chunk);
          }
          socket.write(Buffer.alloc(4));
        });
      });
    }
  };
}

function parseClamAvResponse(raw: string): VirusScanResult {
  const response = raw.replace(/\0+$/u, "").trim();
  if (response.endsWith(" OK")) {
    return { status: "clean" };
  }
  const found = response.match(/^.*?:\s*(.+)\s+FOUND$/u);
  if (found) {
    return { status: "infected", detail: found[1] };
  }
  return { status: "unavailable", detail: response || "clamav_empty_response" };
}
