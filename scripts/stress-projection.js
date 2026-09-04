const WebSocket = require("ws");

const DEBUG_PORT = process.env.PROJECTION_DEBUG_PORT || "10001";
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
let commandId = 0;

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function command(socket, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    const onMessage = (raw) => {
      const message = JSON.parse(raw);
      if (message.id !== id) return;
      socket.off("message", onMessage);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }
      resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
}

async function evaluate(socket, sessionId, expression) {
  const result = await command(
    socket,
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(JSON.stringify(result));
  return result.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDiagnostic(result, requestedDisplayId, instanceId) {
  const { diagnostic } = result;
  assert(
    result.placement.ok,
    `Operation ${result.placement.operationId} failed: ${JSON.stringify({ placement: result.placement, diagnostic })}`,
  );
  assert(
    String(result.placement.matchedDisplayId) === String(requestedDisplayId),
    `Operation ${result.placement.operationId} matched the wrong display`,
  );
  assert(
    diagnostic.projectionWindowCount === 1,
    "Expected exactly one projection window",
  );
  assert(
    diagnostic.activeProjectionInstanceId === instanceId,
    "Projection BrowserWindow instance changed during movement",
  );
  assert(
    String(diagnostic.actualDisplayId) === String(requestedDisplayId),
    "Native projection window is on the wrong display",
  );
  assert(
    diagnostic.renderer?.rendererInstances === 1,
    "Expected one renderer instance",
  );
  assert(
    diagnostic.renderer?.animationLoops === 1,
    "Expected one animation loop",
  );
  assert(
    diagnostic.renderer?.resizeListeners === 1,
    "Expected one resize listener",
  );
  assert(
    diagnostic.renderer?.canvasCount === 1,
    "Expected one projection canvas",
  );
}

async function main() {
  const browser = await fetch(`${DEBUG_URL}/json/version`).then((response) =>
    response.json(),
  );
  const socket = await connect(browser.webSocketDebuggerUrl);
  const targets = await command(socket, "Target.getTargets");
  const controls = targets.targetInfos.find((target) =>
    target.url.endsWith("/controls/controls.html"),
  );
  assert(controls, "Controls target was not found");
  const attached = await command(socket, "Target.attachToTarget", {
    targetId: controls.targetId,
    flatten: true,
  });
  const sessionId = attached.sessionId;
  try {
    const displays = await evaluate(
      socket,
      sessionId,
      "window.op.getDisplays()",
    );
    assert(
      displays.length >= 2,
      "Projection stress test requires two displays",
    );
    const [displayA, displayB] = displays;
    const sequence = [
      displayA,
      displayB,
      displayA,
      displayB,
      displayA,
      displayB,
    ];
    const results = [];
    let instanceId;

    for (const display of sequence) {
      const result = await evaluate(
        socket,
        sessionId,
        `(async () => {
          const placement = await window.op.openProjection(${JSON.stringify(String(display.id))});
          const diagnostic = await window.op.getProjectionDiagnostics();
          return { placement, diagnostic };
        })()`,
      );
      instanceId ??= result.diagnostic.activeProjectionInstanceId;
      assertDiagnostic(result, display.id, instanceId);
      results.push({
        operationId: result.placement.operationId,
        requestedDisplayId: display.id,
        actualDisplayId: result.diagnostic.actualDisplayId,
        instanceId: result.diagnostic.activeProjectionInstanceId,
        bounds: result.diagnostic.projectionWindowInstances[0].bounds,
      });
    }

    const rapidDisplays = [displayA, displayB, displayA, displayB, displayA];
    const rapid = await evaluate(
      socket,
      sessionId,
      `Promise.all(${JSON.stringify(rapidDisplays.map((display) => String(display.id)))}.map((id) => window.op.openProjection(id))).then(async (placements) => ({ placements, diagnostic: await window.op.getProjectionDiagnostics() }))`,
    );
    const finalDisplay = rapidDisplays.at(-1);
    assert(
      rapid.placements.every((placement) => placement.ok),
      "A rapid projection request failed",
    );
    assertDiagnostic(
      { placement: rapid.placements.at(-1), diagnostic: rapid.diagnostic },
      finalDisplay.id,
      instanceId,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          sequence: results,
          rapidOperationIds: rapid.placements.map(
            (placement) => placement.operationId,
          ),
          finalDiagnostic: rapid.diagnostic,
        },
        null,
        2,
      ),
    );
  } finally {
    await command(socket, "Target.detachFromTarget", { sessionId });
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
