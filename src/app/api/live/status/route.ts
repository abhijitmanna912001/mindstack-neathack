import { createLiveHandlers } from "../../../../server/live/handlers";
import { runtime as liveRuntime } from "../_lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createLiveHandlers(liveRuntime);
export const GET = handlers.GET;
